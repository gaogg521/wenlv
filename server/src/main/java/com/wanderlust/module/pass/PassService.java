package com.wanderlust.module.pass;

import com.wanderlust.infra.config.ConfigService;
import com.wanderlust.infra.db.Db;
import com.wanderlust.module.order.OrderEvent;
import com.wanderlust.module.order.OrderService;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;

/**
 * 凭证与核销域（业务心脏）：
 *  - 确认出票：支付确认时建 travel_pass(kind=1)；
 *  - 动态核销码：HMAC(60s 窗口)，pass_code(pass_id, window) 唯一约束防重放；
 *  - 全部核销完 → 订单 30→40 → 观察期后 50（由 completeTask 驱动）。
 */
public class PassService {

    private final Db db;
    private final OrderService orders;
    private final PassCodeUtil codeUtil;
    private final ConfigService cfg;

    public PassService(Db db, OrderService orders, PassCodeUtil codeUtil, ConfigService cfg) {
        this.db = db;
        this.orders = orders;
        this.codeUtil = codeUtil;
        this.cfg = cfg;
    }

    /** 出票：为订单每个出行名额建一张服务使用权 pass（在 CONFIRM 的 listener 里调用） */
    public long issueForOrder(String orderNo) {
        Map<String, Object> o = orders.byNo(orderNo);
        if (o == null) throw new IllegalStateException("订单不存在");
        long passId = db.tx(c -> {
            long id = db.insertReturnId(c,
                    "INSERT INTO travel_pass (user_id, order_id, kind, name, product_id, status) "
                            + "VALUES (?,?,1,?,?,1)",
                    o.get("user_id"), o.get("id"),
                    "主题游通行凭证·" + orderNo, o.get("product_id"));
            return id;
        });
        return passId;
    }

    /** 取当前窗口动态码（C 端 60s 轮换调用；同时落 pass_code 占位，商户核销即消费） */
    public String currentQrPayload(long passId) {
        long window = PassCodeUtil.windowOf(System.currentTimeMillis() / 1000, cfg.getInt("pass.code_window"));
        String sig = codeUtil.sign(passId, window);
        db.update("INSERT IGNORE INTO pass_code (pass_id, window_no, code_hash) VALUES (?,?,?)",
                passId, window, sig);
        return codeUtil.qrPayload(passId, window);
    }

    public static final class VerifyResult {
        public final boolean ok;
        public final String reason; // ok / 已核销(重复) / 过期 / 无效码 / 凭证状态异常
        public VerifyResult(boolean ok, String reason) { this.ok = ok; this.reason = reason; }
    }

    /** 商户扫码核销：窗口校验(±1) → HMAC 校验 → 唯一约束消费 → 全单核销完推订单 40 */
    public VerifyResult verifyScan(long merchantId, long staffUserId, String qrPayload, String cityCode) {
        // wl://v/{passId}/{windowNo}/{sig} → split("/") = ["wl:", "", "v", passId, window, sig] 共 6 段（双斜杠产生空段）
        String[] parts = qrPayload.split("/");
        if (parts.length != 6 || !"wl:".equals(parts[0]) || !"v".equals(parts[2]))
            return log(merchantId, staffUserId, 0, 4, cityCode, "无效码（格式）", false);
        long passId = Long.parseLong(parts[3]);
        long window = Long.parseLong(parts[4]);
        long hit = codeUtil.verify(passId, window, parts[5]);
        if (hit < 0) return log(merchantId, staffUserId, passId, 4, cityCode, "无效码（签名/窗口）", false);

        Map<String, Object> pass = db.queryOne("SELECT id, status, order_id FROM travel_pass WHERE id = ?", passId);
        if (pass == null) return log(merchantId, staffUserId, passId, 4, cityCode, "凭证不存在", false);
        int pstat = ((Number) pass.get("status")).intValue();
        if (pstat != 1) return log(merchantId, staffUserId, passId, 2, cityCode,
                pstat == 2 ? "已核销(重复)·" + pass.get("id") : "凭证状态异常", false);

        // 消费唯一约束：同一(pass, window) 只允许一行被置为已消费 —— 并发双扫只有一个成功
        boolean consumed = db.tx(c -> {
            int n = db.update(c,
                    "UPDATE pass_code SET consumed_at = NOW(3), consumed_by = ? "
                            + "WHERE pass_id = ? AND window_no = ? AND consumed_at IS NULL",
                    staffUserId, passId, hit);
            if (n != 1) return false;
            db.update(c, "UPDATE travel_pass SET status = 2 WHERE id = ?", passId);
            db.update(c, "INSERT INTO verification_log (pass_id, merchant_id, staff_id, method, result, city_code) "
                            + "VALUES (?,?,?,1,1,?)", passId, merchantId, staffUserId, cityCode);
            return true;
        });
        if (!consumed) return log(merchantId, staffUserId, passId, 2, cityCode, "已核销(重复·并发拦截)", false);

        // 该订单全部 pass 核销完 → 订单 30→40
        long orderId = ((Number) pass.get("order_id")).longValue();
        long remaining = db.count(
                "SELECT COUNT(*) c FROM travel_pass WHERE order_id = ? AND status = 1", orderId);
        if (remaining == 0) {
            String orderNo = (String) db.queryOne("SELECT order_no FROM orders WHERE id = ?", orderId).get("order_no");
            orders.fire(orderNo, OrderEvent.VERIFY_ALL, "merchant:" + merchantId,
                    (no, from, to, actor) -> "全部核销完成");
        }
        return new VerifyResult(true, "核销成功");
    }

    private VerifyResult log(long mid, long staff, long passId, int result, String city, String reason, boolean ok) {
        if (passId > 0) {
            db.update("INSERT INTO verification_log (pass_id, merchant_id, staff_id, method, result, city_code) "
                    + "VALUES (?,?,?,1,?,?)", passId, mid, staff, result, city);
        }
        return new VerifyResult(ok, reason);
    }

    /** 观察期结束：40→50（定时任务扫描 refund_deadline；本方法供 E2E 显式驱动） */
    public void completeIfObserved(String orderNo) {
        orders.fire(orderNo, OrderEvent.OBSERVE_END, "system", (no, from, to, actor) -> {
            db.update("UPDATE orders SET completed_at = NOW(3) WHERE order_no = ?", no);
            return "观察期结束·触发返豆与佣金";
        });
    }

    /** 退款冲正：凭证置 4 */
    public void revokePasses(String orderNo) {
        Map<String, Object> o = orders.byNo(orderNo);
        db.update("UPDATE travel_pass SET status = 4 WHERE order_id = ?", o.get("id"));
    }

    /** 存证哈希（canonical payload SHA-256；attest_event 入队） */
    public String hashOf(String bizType, String bizRef, String canonicalJson) {
        try {
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            byte[] out = md.digest((bizType + "|" + bizRef + "|" + canonicalJson)
                    .getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(64);
            for (byte b : out) sb.append(String.format("%02x", b));
            return sb.toString();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    public void attest(String bizType, String bizRef, String payloadHash) {
        db.update("INSERT IGNORE INTO attest_event (biz_type, biz_ref, payload_hash) VALUES (?,?,?)",
                bizType, bizRef, payloadHash);
    }
}
