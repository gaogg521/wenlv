package com.wanderlust.module.bean;

import com.wanderlust.infra.config.ConfigService;
import com.wanderlust.infra.db.Db;

import java.util.List;
import java.util.Map;

/**
 * 旅豆域落库实现（总方案 §7.5 发豆链路 / §6 双分录表）。
 * 铁律落地：
 *  - 发放（1/2/3）必须过批次预算 + 全局总量双重校验（严禁超发）；
 *  - 冲正退回（5）不占预算与总量（豆此前已发行）；
 *  - 每笔事务两行分录，Σ贷=Σ借（trialBalance 日终对账）；
 *  - biz_type 无『购买』。
 */
public class BeanService {

    /** 虚拟科目哨兵 user_id（远离真实用户自增段；首次使用时自动建行，避免与真实账户自增 id 撞号） */
    public static final long SENTINEL_PLATFORM = 999_999_000_001L;
    public static final long SENTINEL_BUDGET   = 999_999_000_009L;

    private final Db db;
    private final ConfigService cfg;

    public BeanService(Db db, ConfigService cfg) {
        this.db = db;
        this.cfg = cfg;
    }

    public long balance(long userId) {
        Map<String, Object> m = db.queryOne(
                "SELECT balance FROM bean_account WHERE user_id = ?", userId);
        return m == null ? 0 : ((Number) m.get("balance")).longValue();
    }

    /** 虚拟科目 id 解析（不存在则建行） */
    private long virtualAccountId(long sentinelUserId) {
        Map<String, Object> m = db.queryOne("SELECT id FROM bean_account WHERE user_id = ?", sentinelUserId);
        if (m == null) {
            db.update("INSERT INTO bean_account (user_id) VALUES (?)", sentinelUserId);
            m = db.queryOne("SELECT id FROM bean_account WHERE user_id = ?", sentinelUserId);
        }
        return ((Number) m.get("id")).longValue();
    }

    private long accountId(long userId) {
        Map<String, Object> m = db.queryOne("SELECT id FROM bean_account WHERE user_id = ?", userId);
        if (m == null) {
            db.update("INSERT INTO bean_account (user_id) VALUES (?)", userId);
            m = db.queryOne("SELECT id FROM bean_account WHERE user_id = ?", userId);
        }
        return ((Number) m.get("id")).longValue();
    }

    /** 消费返豆计算：实付（分）× 返豆率（元/10 豆口径） */
    public long computeRebate(long payAmountFen) {
        // rate=0.10 → 每实付 1 元返 10 豆 → 豆 = payAmountFen/100 * (100*rate) / 10 ... 直接按锚定换算：
        // 100 豆 = 10 元 = 1000 分 → 豆 = payAmountFen / 10 × rate
        double rate = cfg.getDecimal("bean.order_rate").doubleValue();
        return Math.round(payAmountFen / 10.0 * rate);
    }

    /** 抵扣豆数换算金额（分）：按锚定 100 豆=1000 分 */
    public long deductAmountFen(long beans) {
        return beans * 10;
    }

    /** 单笔抵扣上限校验：抵扣金额 ≤ 订单额 × deduct_max_pct */
    public long clampDeduct(long wantedBeans, long orderAmountFen) {
        long maxFen = Math.round(orderAmountFen * cfg.getDecimal("bean.deduct_max_pct").doubleValue());
        long cap = maxFen / 10; // 反算最大豆数
        return Math.min(wantedBeans, cap);
    }

    /** 发放（消费返豆/任务/内容）：预算池 + 全局总量双闸，同事务双分录 */
    public void grant(long userId, long amount, int bizType, String bizRef, long budgetId) {
        db.tx(c -> {
            long acct = accountId(userId);
            long balBefore = ((Number) db.queryOne(c,
                    "SELECT balance FROM bean_account WHERE id = ? FOR UPDATE", acct).get("balance")).longValue();

            // 闸 1：批次预算
            Map<String, Object> budget = db.queryOne(c,
                    "SELECT total, granted, returned FROM bean_budget WHERE id = ? FOR UPDATE", budgetId);
            long total = ((Number) budget.get("total")).longValue();
            long granted = ((Number) budget.get("granted")).longValue();
            long returned = ((Number) budget.get("returned")).longValue();
            if (granted + amount > total + returned)
                throw new BeanLedger.BudgetExceededException(
                        "批次预算超限: " + (granted + amount) + " > " + (total + returned));

            // 闸 2：全局发行总量（严禁超发红线）
            Map<String, Object> cap = db.queryOne(c,
                    "SELECT cap_total, issued_sum FROM bean_global_cap WHERE id = 1 FOR UPDATE");
            long capTotal = ((Number) cap.get("cap_total")).longValue();
            long issued = ((Number) cap.get("issued_sum")).longValue();
            if (issued + amount > capTotal)
                throw new BeanLedger.BudgetExceededException(
                        "全局总量触顶(严禁超发): " + (issued + amount) + " > " + capTotal);

            String txNo = "BT" + System.nanoTime();
            long newBal = balBefore + amount;
            db.update(c, "INSERT INTO bean_ledger (tx_no, account_id, direction, amount, after_bal, biz_type, biz_ref, budget_id) "
                            + "VALUES (?,?,1,?,?,?,?,?)",
                    txNo, acct, amount, newBal, bizType, bizRef, budgetId);
            db.update(c, "INSERT INTO bean_ledger (tx_no, account_id, direction, amount, after_bal, biz_type, biz_ref, budget_id) "
                            + "VALUES (?,?,2,?,?,?,?,?)",
                    txNo, virtualAccountId(SENTINEL_BUDGET), amount, granted + amount, bizType, bizRef, budgetId);
            db.update(c, "UPDATE bean_account SET balance = ?, lifetime = lifetime + ?, version = version + 1 WHERE id = ?",
                    newBal, amount, acct);
            db.update(c, "UPDATE bean_budget SET granted = granted + ? WHERE id = ?", amount, budgetId);
            db.update(c, "UPDATE bean_global_cap SET issued_sum = issued_sum + ? WHERE id = 1", amount);
            return null;
        });
    }

    /** 抵扣/过期/风控（借用户）：余额不足即拒 */
    public void deduct(long userId, long amount, int bizType, String bizRef) {
        db.tx(c -> {
            long acct = accountId(userId);
            long balBefore = ((Number) db.queryOne(c,
                    "SELECT balance FROM bean_account WHERE id = ? FOR UPDATE", acct).get("balance")).longValue();
            if (amount > balBefore)
                throw new IllegalStateException("旅豆余额不足: " + balBefore + " < " + amount);
            String txNo = "BT" + System.nanoTime();
            db.update(c, "INSERT INTO bean_ledger (tx_no, account_id, direction, amount, after_bal, biz_type, biz_ref) "
                            + "VALUES (?,?,2,?,?,?,?)",
                    txNo, acct, amount, balBefore - amount, bizType, bizRef);
            db.update(c, "INSERT INTO bean_ledger (tx_no, account_id, direction, amount, after_bal, biz_type, biz_ref) "
                            + "VALUES (?,?,1,?,?,?,?)",
                    txNo, virtualAccountId(SENTINEL_PLATFORM), amount, amount, bizType, bizRef);
            db.update(c, "UPDATE bean_account SET balance = ?, version = version + 1 WHERE id = ?",
                    balBefore - amount, acct);
            return null;
        });
    }

    /** 退款冲正退回（贷用户）：不占预算与总量 */
    public void reverse(long userId, long amount, String bizRef) {
        db.tx(c -> {
            long acct = accountId(userId);
            long balBefore = ((Number) db.queryOne(c,
                    "SELECT balance FROM bean_account WHERE id = ? FOR UPDATE", acct).get("balance")).longValue();
            String txNo = "BT" + System.nanoTime();
            db.update(c, "INSERT INTO bean_ledger (tx_no, account_id, direction, amount, after_bal, biz_type, biz_ref) "
                            + "VALUES (?,?,1,?,?,5,?)", txNo, acct, amount, balBefore + amount, bizRef);
            db.update(c, "INSERT INTO bean_ledger (tx_no, account_id, direction, amount, after_bal, biz_type, biz_ref) "
                            + "VALUES (?,?,2,?,?,5,?)", txNo, virtualAccountId(SENTINEL_PLATFORM), amount, 0, bizRef);
            db.update(c, "UPDATE bean_account SET balance = ?, version = version + 1 WHERE id = ?",
                    balBefore + amount, acct);
            return null;
        });
    }

    /** 已返豆回收（退款时若已发放过返豆）：借用户，biz=7 风控回收口径 */
    public void clawback(long userId, long amount, String bizRef) {
        deduct(userId, amount, BeanLedger.BIZ_RISK, bizRef);
    }

    /** 日终试算（对账 Job 核心）：每个用户户 balance == Σcredit-Σdebit；全账本 Σcredit==Σdebit */
    public TrialBalance trialBalance() {
        // 仅核对真实用户户（虚拟科目只记流向、不核算余额）
        List<Map<String, Object>> rows = db.query(
                "SELECT a.id, a.balance, COALESCE(SUM(CASE WHEN l.direction=1 THEN l.amount ELSE -l.amount END),0) AS derived "
                        + "FROM bean_account a JOIN user_account u ON u.id = a.user_id "
                        + "LEFT JOIN bean_ledger l ON l.account_id = a.id "
                        + "GROUP BY a.id, a.balance");
        long mismatches = rows.stream()
                .filter(r -> ((Number) r.get("balance")).longValue() != ((Number) r.get("derived")).longValue())
                .count();
        Map<String, Object> total = db.queryOne(
                "SELECT SUM(CASE WHEN direction=1 THEN amount ELSE 0 END) cr, "
                        + "SUM(CASE WHEN direction=2 THEN amount ELSE 0 END) dr FROM bean_ledger");
        long cr = total.get("cr") == null ? 0 : ((Number) total.get("cr")).longValue();
        long dr = total.get("dr") == null ? 0 : ((Number) total.get("dr")).longValue();
        return new TrialBalance(mismatches == 0, cr == dr, cr, dr, rows.size());
    }

    public record TrialBalance(boolean perAccountOk, boolean globalOk, long sumCredit, long sumDebit, int accounts) { }
}
