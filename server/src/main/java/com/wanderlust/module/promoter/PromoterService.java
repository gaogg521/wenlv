package com.wanderlust.module.promoter;

import com.wanderlust.infra.config.ConfigService;
import com.wanderlust.infra.db.Db;

import java.util.Map;

/**
 * 推广域（总方案 D2：一级 CPS 三档 5%/8%/12% 封顶，无层级）：
 *  - 归因：扫码首触（attribution_hit 唯一）；
 *  - 佣金：订单观察期结束（50）后创建，基数=实付-豆抵扣，T+7 结算；
 *  - 定档：滚动 90 天有效成交额（生产由日任务重算，此处按单累加演示）。
 */
public class PromoterService {

    private final Db db;
    private final ConfigService cfg;

    public PromoterService(Db db, ConfigService cfg) {
        this.db = db;
        this.cfg = cfg;
    }

    /** 推广员注册（签协议后生效）；费率按档位写入（DDL CHECK 保证 ∈{500,800,1200}） */
    public long register(long userId, int tier) {
        int rate = rateOfTier(tier);
        db.update("INSERT INTO promoter (user_id, tier, rate_bp, status) VALUES (?,?,?,1) "
                + "ON DUPLICATE KEY UPDATE tier = VALUES(tier), rate_bp = VALUES(rate_bp)", userId, tier, rate);
        return userId;
    }

    private int rateOfTier(int tier) {
        int[] rates = cfg.getIntArray("promoter.rate_bp");
        return rates[Math.max(1, Math.min(tier, rates.length)) - 1];
    }

    /** 建推广码（scene ≤ 32 字符，getUnlimited 语义） */
    public String createScene(long promoterId, String channel) {
        String scene = "p" + Long.toString(promoterId, 36) + (channel == null ? "" : "-" + channel);
        db.update("INSERT IGNORE INTO attribution (promoter_id, scene, channel) VALUES (?,?,?)",
                promoterId, scene, channel);
        return scene;
    }

    /** 归因命中：首触唯一（一人一码只记第一次） */
    public boolean hit(String scene, long userId) {
        Map<String, Object> attr = db.queryOne("SELECT promoter_id FROM attribution WHERE scene = ?", scene);
        if (attr == null) return false;
        return db.tx(c -> db.tryInsert(c,
                "INSERT INTO attribution_hit (scene, user_id) VALUES (?,?)", scene, userId));
    }

    /** 订单 50 后计佣（幂等：uk(order,promoter)） */
    public boolean createCommission(String orderNo) {
        Map<String, Object> o = db.queryOne(
                "SELECT id, promo_scene, amount_pay, bean_deducted FROM orders WHERE order_no = ?", orderNo);
        if (o == null || o.get("promo_scene") == null) return false;
        Map<String, Object> attr = db.queryOne(
                "SELECT promoter_id FROM attribution WHERE scene = ?", o.get("promo_scene"));
        if (attr == null) return false;
        long promoterId = ((Number) attr.get("promoter_id")).longValue();

        Map<String, Object> p = db.queryOne(
                "SELECT rate_bp, status FROM promoter WHERE user_id = ? AND status = 1", promoterId);
        if (p == null) return false;
        int rate = ((Number) p.get("rate_bp")).intValue();
        long base = ((Number) o.get("amount_pay")).longValue()
                  - ((Number) o.get("bean_deducted")).longValue() * 10; // 佣金基数=实付-豆抵扣金额
        long amount = base * rate / 10000;

        return db.tx(c -> db.tryInsert(c,
                "INSERT INTO commission (order_id, promoter_id, base_amount, rate_bp, amount, status, payable_at) "
                        + "VALUES (?,?,?,?,?,0, DATE_ADD(NOW(3), INTERVAL ? DAY))",
                o.get("id"), promoterId, base, rate, amount, cfg.getInt("commission.settle_delay_days")));
    }

    /** 退款冲正：佣金置无效(4)/已冲正(3) */
    public void invalidateCommission(String orderNo) {
        Map<String, Object> o = db.queryOne("SELECT id FROM orders WHERE order_no = ?", orderNo);
        if (o != null) {
            db.update("UPDATE commission SET status = CASE WHEN status = 2 THEN 3 ELSE 4 END WHERE order_id = ?",
                    o.get("id"));
        }
    }

    /** T+7 到期佣金入结算（每日 02:00 任务）；返回笔数 */
    public int settleDue() {
        return db.update(
                "UPDATE commission SET status = 1 WHERE status = 0 AND payable_at <= NOW(3)");
    }

    public long validGmv(long promoterId) {
        Map<String, Object> m = db.queryOne("SELECT valid_gmv_90d v FROM promoter WHERE user_id = ?", promoterId);
        return m == null ? 0 : ((Number) m.get("v")).longValue();
    }

    public void addValidGmv(long promoterId, long amountFen) {
        db.update("UPDATE promoter SET valid_gmv_90d = valid_gmv_90d + ? WHERE user_id = ?", amountFen, promoterId);
    }
}
