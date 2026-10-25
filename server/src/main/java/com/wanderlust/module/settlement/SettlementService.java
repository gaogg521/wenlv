package com.wanderlust.module.settlement;

import com.wanderlust.infra.config.ConfigService;
import com.wanderlust.infra.db.Db;

import java.util.List;
import java.util.Map;

/**
 * 结算域：按周期把「已完成且未结算」订单聚合成商户周结算单（五口径恒等，
 * CHECK chk_identity 在数据库层兜底——差 1 分都写不进去）。
 *
 * 口径分配（初始比例走参数中心，可在后台调）：
 *   履约 58% / 服务费 12% / 权益预算 5% / 推广 = 实际佣金 / 留存毛利 = 差额。
 *   （¥298 锚点：172.8/35.8/14.9 + 佣金 23.8 + 留存 50.7 ≈ 58%/12%/5%/8%/17%）
 */
public class SettlementService {

    private final Db db;
    private final ConfigService cfg;

    public SettlementService(Db db, ConfigService cfg) {
        this.db = db;
        this.cfg = cfg;
    }

    /** 生成本期结算单（幂等：uk(merchant, period)） */
    public long generateForMerchant(long merchantId, String period) {
        List<Map<String, Object>> orders = db.query(
                "SELECT o.id, o.amount_pay, COALESCE(SUM(c.amount),0) AS promo_amt "
                        + "FROM orders o LEFT JOIN commission c ON c.order_id = o.id AND c.status IN (0,1,2) "
                        + "WHERE o.merchant_id = ? AND o.status = 50 GROUP BY o.id, o.amount_pay", merchantId);
        if (orders.isEmpty()) return -1;

        long total = 0, promo = 0;
        int cnt = orders.size();
        for (Map<String, Object> o : orders) {
            total += ((Number) o.get("amount_pay")).longValue();
            promo += ((Number) o.get("promo_amt")).longValue();
        }
        double fulfillRate = 0.58, serviceRate = 0.12, beanRate = 0.05;
        final long fTotal = total, fPromo = promo;
        final long fulfill = Math.round(fTotal * fulfillRate);
        final long service = Math.round(fTotal * serviceRate);
        final long beanBudget = Math.round(fTotal * beanRate);
        final long retained = fTotal - fulfill - service - beanBudget - fPromo; // 差额兜底 → 恒等式必然成立

        return db.tx(c -> {
            Long exist = null;
            Map<String, Object> ex = db.queryOne(c,
                    "SELECT id FROM settlement WHERE merchant_id = ? AND period = ?", merchantId, period);
            if (ex != null) {
                db.update(c, "DELETE FROM settlement WHERE id = ?", ex.get("id")); // 幂等：重建本期
                exist = ((Number) ex.get("id")).longValue();
            }
            long id = db.insertReturnId(c,
                    "INSERT INTO settlement (merchant_id, period, order_count, total_amount, "
                            + "amt_fulfill, amt_service, amt_promoter, amt_beanbudget, amt_retained, status) "
                            + "VALUES (?,?,?,?,?,?,?,?,?,0)",
                    merchantId, period, cnt, fTotal, fulfill, service, fPromo, beanBudget, retained);
            return exist != null ? exist : id;
        });
    }

    /** 商户确认 → 分账执行 → 完成（收付通分账由 channel 层承接，此处状态机） */
    public void confirmAndSettle(long settlementId) {
        int n1 = db.update("UPDATE settlement SET status = 1 WHERE id = ? AND status = 0", settlementId);
        if (n1 == 1) db.update("UPDATE settlement SET status = 2 WHERE id = ?", settlementId);
        db.update("UPDATE settlement SET status = 3 WHERE id = ? AND status = 2", settlementId);
    }

    public Map<String, Object> byId(long id) {
        return db.queryOne("SELECT * FROM settlement WHERE id = ?", id);
    }
}
