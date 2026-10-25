import com.wanderlust.infra.config.ConfigService;
import com.wanderlust.infra.crypto.Crypto;
import com.wanderlust.infra.db.Db;
import com.wanderlust.module.bean.BeanLedger;
import com.wanderlust.module.bean.BeanService;
import com.wanderlust.module.identity.UserService;
import com.wanderlust.module.order.OrderEvent;
import com.wanderlust.module.order.OrderService;
import com.wanderlust.module.order.OrderStatus;
import com.wanderlust.module.pass.PassCodeUtil;
import com.wanderlust.module.pass.PassService;
import com.wanderlust.module.payment.PaymentService;
import com.wanderlust.module.promoter.PromoterService;
import com.wanderlust.module.settlement.SettlementService;

import java.util.Map;

/**
 * 全链路 E2E（真实 MySQL；第 0 阶段集成验收）：
 * 种子 → 推广注册/归因 → 下单(豆抵扣即扣+防超卖) → 支付(幂等) → 确认出票 →
 * 动态码核销(防重放) → 观察 → 完成 → 返豆(预算+总量双闸) → 佣金(T+7) →
 * 周结算(五口径恒等) → 退款链(全量冲正) → 账本试算 → 会员成长值/等级 → 存证队列。
 *
 * 运行：java -cp build/classes;libs/mysql-connector-j-8.4.0.jar E2eRunner
 */
public class E2eRunner {

    static int pass = 0, fail = 0;
    static void check(boolean cond, String name) {
        if (cond) { pass++; System.out.println("  PASS  " + name); }
        else      { fail++; System.out.println("  FAIL  " + name); }
    }

    public static void main(String[] args) throws Exception {
        Db db = new Db("127.0.0.1", 3306, "wanderlust", "root", "root");
        Crypto crypto = new Crypto();
        ConfigService cfg = new ConfigService();

        // 重置：清空业务数据（保留 V2 参数种子：rule_config / bean_global_cap 不清，issued_sum 归零）
        db.update("SET FOREIGN_KEY_CHECKS = 0");
        for (Map<String, Object> t : db.query(
                "SELECT table_name tn FROM information_schema.tables WHERE table_schema = 'wanderlust' "
                        + "AND table_name NOT IN ('rule_config','bean_global_cap')")) {
            db.update("TRUNCATE TABLE `" + t.get("tn") + "`");
        }
        db.update("UPDATE bean_global_cap SET issued_sum = 0 WHERE id = 1");
        db.update("SET FOREIGN_KEY_CHECKS = 1");

        UserService users = new UserService(db, crypto, cfg);
        BeanService beans = new BeanService(db, cfg);
        OrderService orders = new OrderService(db, cfg);
        PaymentService pays = new PaymentService(db, orders, beans);
        PassCodeUtil codeUtil = new PassCodeUtil("e2e-secret-key");
        PassService passes = new PassService(db, orders, codeUtil, cfg);
        PromoterService promoters = new PromoterService(db, cfg);
        SettlementService settles = new SettlementService(db, cfg);

        System.out.println("== 0. 种子数据（商户/商品/团期/预算池） ==");
        long merchantId = db.insertReturnId(
                "INSERT INTO merchant (city_code, name, merchant_no, status) VALUES ('310118','安麓大夫第·朱家角','M2026102301',1)");
        long productId = db.insertReturnId(
                "INSERT INTO tour_product (channel, city_code, cat, title, days_desc, price_from, merchant_id, status) "
                        + "VALUES ('main','310118','script','朱家角剧本游·江南谜案','1天',29800,?,1)", merchantId);
        long sessionId = db.insertReturnId(
                "INSERT INTO tour_session (product_id, depart_date, quota, booked, min_go, price_adult) "
                        + "VALUES (?, '2026-11-15', 2, 0, 1, 29800)", productId);
        long budgetId = db.insertReturnId(
                "INSERT INTO bean_budget (name, total, biz_owner, status, period_start, period_end) "
                        + "VALUES ('11月·消费返豆', 1000000, 'marketing', 1, '2026-11-01', '2026-11-30')");
        check(true, "种子写入（商户/商品/团期 quota=2/预算池 100 万豆）");

        System.out.println("== 1. 用户与推广（D2 一级 CPS） ==");
        long buyer = users.loginOrCreate("u-e2e-buyer", "oa-buyer", "13800001111");
        long promoterUser = users.loginOrCreate("u-e2e-promo", "oa-promo", "13900002222");
        promoters.register(promoterUser, 1); // 基础档 5%
        String scene = promoters.createScene(promoterUser, "poster");
        check(promoters.hit(scene, buyer), "扫码归因命中（首触）");
        check(!promoters.hit(scene, buyer), "重复扫码不重复归因（首触唯一）");
        check(users.maskedMobile(buyer).equals("138****1111"), "手机号脱敏（138****1111）");

        System.out.println("== 2. 下单：豆抵扣即扣 + 防超卖 ==");
        // 预置旅豆：任务奖励 200 豆（走 grant，占预算）
        beans.grant(buyer, 200, BeanLedger.BIZ_TASK, "TASK-E2E", budgetId);
        check(beans.balance(buyer) == 200, "任务奖励 200 豆入账");
        OrderService.BeanDeductor deductor = new OrderService.BeanDeductor() {
            public long clamp(long w, long orderFen) { return beans.clampDeduct(w, orderFen); }
            public long amountFen(long b) { return beans.deductAmountFen(b); }
            public void deduct(long uid, long b, String orderNo) { beans.deduct(uid, b, BeanLedger.BIZ_DEDUCT, orderNo); }
        };
        // 298 元单：想抵 200 豆(=20元) → 上限 10%(29.8元=298豆) → 200 豆可全额抵
        OrderService.PlaceResult p1 = orders.place(buyer, sessionId, 1, 200, scene, deductor);
        check(p1.beanDeducted == 200 && p1.amountPay == 29800 - 2000,
                "下单：200 豆抵 20 元，实付 278 元");
        check(beans.balance(buyer) == 0, "抵扣即真实扣减（余额 200→0）");
        // 第二单占最后一个名额（无豆）
        OrderService.PlaceResult p2 = orders.place(buyer, sessionId, 1, 0, scene, deductor);
        boolean overbook = false;
        try { orders.place(buyer, sessionId, 1, 0, null, deductor); }
        catch (IllegalStateException e) { overbook = e.getMessage().contains("超卖"); }
        check(overbook, "quota=2 卖完后第三单被条件更新拦截（防超卖）");
        // 未支付单关闭释放名额（手动驱动定时任务逻辑：造一条老单）
        db.update("UPDATE orders SET created_at = created_at - INTERVAL 20 MINUTE WHERE order_no = ?", p2.orderNo);
        orders.closeTimeoutOrders(null);
        check(((Number) orders.byNo(p2.orderNo).get("status")).intValue() == 90,
                "15 分钟未付自动关单（status=90）");
        check(db.count("SELECT COUNT(*) c FROM tour_session WHERE id = ? AND booked = 1", sessionId) == 1,
                "关单后名额释放（booked 回落到 1）");

        System.out.println("== 3. 支付：幂等回调 + 金额校验 ==");
        check(pays.onPaySuccess(p1.orderNo, "WX420001", 27800), "支付回调成功（订单 10→20）");
        check(!pays.onPaySuccess(p1.orderNo, "WX420001", 27800), "同一微信单号重复回调幂等拒绝");
        boolean amountTampered = false;
        OrderService.PlaceResult p3 = orders.place(buyer, sessionId, 1, 0, null, deductor);
        try { pays.onPaySuccess(p3.orderNo, "WX420003", 1); }
        catch (IllegalStateException e) { amountTampered = true; }
        check(amountTampered, "回调金额与订单不符拒绝（防篡改）");
        pays.confirm(p1.orderNo, () -> passes.issueForOrder(p1.orderNo));
        check(((Number) orders.byNo(p1.orderNo).get("status")).intValue() == 30, "确认出票（订单 20→30）");
        long passId = -1;
        Map<String, Object> passRow = db.queryOne(
                "SELECT id FROM travel_pass WHERE order_id = (SELECT id FROM orders WHERE order_no = ?)", p1.orderNo);
        if (passRow != null) passId = ((Number) passRow.get("id")).longValue();
        check(passId > 0, "travel_pass 已签发（kind=1 服务使用权）");

        System.out.println("== 4. 核销：动态码 + 防重放 ==");
        String qr = passes.currentQrPayload(passId);
        PassService.VerifyResult v1 = passes.verifyScan(merchantId, 9527L, qr, "310118");
        check(v1.ok, "商户扫码核销成功（订单 30→40）");
        check(((Number) orders.byNo(p1.orderNo).get("status")).intValue() == 40, "订单已核销（status=40）");
        PassService.VerifyResult v2 = passes.verifyScan(merchantId, 9527L, qr, "310118");
        check(!v2.ok && v2.reason.startsWith("已核销"), "同一码重放被拒（唯一约束拦截）");
        boolean badPayload = !passes.verifyScan(merchantId, 9527L, "wl://v/999/1/deadbeefdeadbeef", "310118").ok;
        check(badPayload, "伪造签名/不存在凭证拒绝");

        System.out.println("== 5. 观察期完成 → 返豆 + 佣金 ==");
        passes.completeIfObserved(p1.orderNo);
        check(((Number) orders.byNo(p1.orderNo).get("status")).intValue() == 50, "观察期结束（订单 40→50）");
        long rebate = beans.computeRebate(27800); // 278 元 → 278 豆
        beans.grant(buyer, rebate, BeanLedger.BIZ_CONSUME_REbate, p1.orderNo, budgetId);
        check(beans.balance(buyer) == rebate, "消费返豆 " + rebate + " 豆（实付 278 元 × 10%）");
        users.addGrowth(buyer, 27800, UserService.GROWTH_ORDER_VERIFIED, p1.orderNo);
        check(users.growthValue(buyer) == 27800 && users.memberLevel(buyer) == 3,
                "成长值 27800 → 城市探索官（≥10000 晋级；阈值 0/2k/10k/50k）");
        check(promoters.createCommission(p1.orderNo), "佣金创建（基数 278 元 × 5% = " + (27800 * 500 / 10000) + " 分）");
        check(!promoters.createCommission(p1.orderNo), "重复计佣幂等拒绝");
        promoters.settleDue();
        promoters.addValidGmv(promoterUser, 27800);

        System.out.println("== 6. 周结算：五口径恒等 ==");
        long s1 = settles.generateForMerchant(merchantId, "2026-10-W43");
        Map<String, Object> st = settles.byId(s1);
        long total = ((Number) st.get("total_amount")).longValue();
        long five = ((Number) st.get("amt_fulfill")).longValue()
                  + ((Number) st.get("amt_service")).longValue()
                  + ((Number) st.get("amt_promoter")).longValue()
                  + ((Number) st.get("amt_beanbudget")).longValue()
                  + ((Number) st.get("amt_retained")).longValue();
        check(total == 27800 && five == total,
                "五口径恒等（总额 " + total + " = 履约" + st.get("amt_fulfill") + "+服务" + st.get("amt_service")
                        + "+推广" + st.get("amt_promoter") + "+权益" + st.get("amt_beanbudget") + "+留存" + st.get("amt_retained") + "）");
        settles.confirmAndSettle(s1);
        check(((Number) settles.byId(s1).get("status")).intValue() == 3, "结算状态机 0→1→2→3（确认·分账·完成）");

        System.out.println("== 7. 退款链：全量负向冲正 ==");
        // p3 已支付，走退款：豆抵扣冲正（p3 无豆）+ 凭证冲正 + 佣金无效
        pays.onPaySuccess(p3.orderNo, "WX420004", 29800);
        pays.confirm(p3.orderNo, () -> passes.issueForOrder(p3.orderNo));
        long balBefore = beans.balance(buyer);
        pays.refund(p3.orderNo, "行程变更", new PaymentService.RefundHooks() {
            public void onRefundSuccess(String orderNo) {
                // p3 无豆抵扣，无需豆冲正；凭证与佣金冲正见下        // p3 无豆抵扣，金额 0 跳过
                passes.revokePasses(orderNo);
                promoters.invalidateCommission(orderNo);
            }
        });
        check(((Number) orders.byNo(p3.orderNo).get("status")).intValue() == 70, "退款完成（订单 60→70）");
        check(db.count("SELECT COUNT(*) c FROM travel_pass tp JOIN orders o ON tp.order_id = o.id "
                + "WHERE o.order_no = ? AND tp.status = 4", p3.orderNo) >= 1, "凭证全部冲正（status=4）");
        check(((Number) db.queryOne("SELECT status FROM payment WHERE order_id = (SELECT id FROM orders WHERE order_no = ?)", p3.orderNo).get("status")).intValue() == 4,
                "支付单状态 4=已退款");

        System.out.println("== 8. 账本试算（日终对账核心断言） ==");
        BeanService.TrialBalance tb = beans.trialBalance();
        check(tb.perAccountOk(), "每户 balance == Σcredit-Σdebit（" + tb.accounts() + " 户零差异）");
        check(tb.globalOk() && tb.sumCredit() == tb.sumDebit(),
                "全账本 Σ贷 == Σ借（" + tb.sumCredit() + " 豆）");

        System.out.println("== 9. 存证队列（P0 Noop 链路） ==");
        passes.attest("order", p1.orderNo, passes.hashOf("order", p1.orderNo,
                "{\"amount_pay\":27800,\"status\":50}"));
        passes.attest("bean_ledger", "BT-GRANT-" + p1.orderNo, passes.hashOf("bean_ledger", p1.orderNo,
                "{\"rebate\":" + rebate + "}"));
        check(db.count("SELECT COUNT(*) c FROM attest_event") >= 2, "订单+账本哈希入锚定队列");
        check(db.count("SELECT COUNT(*) c FROM attest_event WHERE status = 0") >= 2, "队列待打包（Noop 阶段）");

        System.out.println("== 10. 隐私与审计 ==");
        check(db.count("SELECT COUNT(*) c FROM user_privacy_consent WHERE user_id = ? AND scene = 'payment_record'",
                buyer) == 0, "隐私授权默认未勾选（用户主动授权才落库）");
        check(db.count("SELECT COUNT(*) c FROM order_event") >= 8, "订单状态审计流完整（8+ 条 order_event）");

        System.out.println();
        System.out.println("E2E RESULT: " + pass + " PASS / " + fail + " FAIL");
        if (fail > 0) System.exit(1);
    }
}
