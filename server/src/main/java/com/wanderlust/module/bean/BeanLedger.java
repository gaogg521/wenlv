package com.wanderlust.module.bean;

import java.util.ArrayList;
import java.util.List;

/**
 * 旅豆双分录账本（总方案 §6 / §7.5）。
 *
 * 铁律：
 *  1. 每笔事务 tx_no 恰好两行方向相反的分录，Σ贷 = Σ借；
 *  2. 发放类（1/2/3）必须挂 budget_id，且先过预算池与 global_cap 校验；
 *  3. biz_type 无「购买」——代码层封闭（旅豆只能消费返/任务/内容获得）；
 *  4. after_bal 必须等于前置余额 ± amount（审计快照，防外部篡改）。
 *
 * 纯 JDK 实现；持久化由 Repo 层（MyBatis）承接，本类只负责不变量。
 */
public final class BeanLedger {

    public static final int BIZ_CONSUME_REbate = 1;   // 消费返豆
    public static final int BIZ_TASK = 2;             // 任务奖励
    public static final int BIZ_CONTENT = 3;          // 内容奖励
    public static final int BIZ_DEDUCT = 4;           // 订单抵扣（下单即扣）
    public static final int BIZ_REFUND_REVERSE = 5;   // 退款冲正（退回抵扣豆）
    public static final int BIZ_EXPIRE = 6;           // 过期回收
    public static final int BIZ_RISK = 7;             // 风控回收

    /** 合法 biz_type 集合（不存在 8=购买，永远不新增） */
    public static final int[] GRANT_SOURCES = {1, 2, 3};

    public enum Direction { CREDIT(1), DEBIT(2);
        public final int code;
        Direction(int code) { this.code = code; }
    }

    /** 一行分录（对应 bean_ledger 一行） */
    public record Entry(long accountId, Direction dir, long amount, long afterBal,
                        int bizType, String bizRef, Long budgetId) {
        public Entry {
            if (amount <= 0) throw new IllegalArgumentException("ledger amount must be > 0");
        }
    }

    /** 一笔双分录事务 */
    public record Tx(String txNo, Entry credit, Entry debit) { }

    /** 预算池校验失败（严禁超发的第一道闸） */
    public static final class BudgetExceededException extends RuntimeException {
        public BudgetExceededException(String msg) { super(msg); }
    }

    private final List<Tx> txs = new ArrayList<>();

    /** 发放（贷用户 / 借预算池），带预算与总量校验 */
    public Tx grant(String txNo, long userAccountId, long userBalanceBefore, long amount,
                    int bizType, String bizRef, long budgetId,
                    long budgetGrantedBefore, long budgetTotal, long budgetReturned,
                    long globalIssuedBefore, long globalCap) {
        if (amount <= 0) throw new IllegalArgumentException("grant amount must be > 0");
        boolean isGrantSource = false;
        for (int b : GRANT_SOURCES) if (b == bizType) { isGrantSource = true; break; }
        if (!isGrantSource)
            throw new IllegalArgumentException("biz_type " + bizType + " is not a grant source");
        if (budgetGrantedBefore + amount > budgetTotal + budgetReturned)
            throw new BudgetExceededException(
                    "batch budget exceeded: " + (budgetGrantedBefore + amount) + " > "
                            + (budgetTotal + budgetReturned));
        if (globalIssuedBefore + amount > globalCap)
            throw new BudgetExceededException(
                    "global cap exceeded (严禁超发红线): " + (globalIssuedBefore + amount) + " > " + globalCap);

        Entry credit = new Entry(userAccountId, Direction.CREDIT, amount,
                userBalanceBefore + amount, bizType, bizRef, budgetId);
        Entry debit = new Entry(budgetId, Direction.DEBIT, amount,
                budgetGrantedBefore + amount, bizType, bizRef, budgetId);
        Tx tx = new Tx(txNo, credit, debit);
        txs.add(tx);
        return tx;
    }

    /** 抵扣/回收类（借用户）：biz 4抵扣 6过期 7风控；余额不足即拒 */
    public Tx deduct(String txNo, long userAccountId, long userBalanceBefore, long amount,
                     int bizType, String bizRef, long counterAccountId, long counterBefore) {
        if (bizType != BIZ_DEDUCT && bizType != BIZ_EXPIRE && bizType != BIZ_RISK)
            throw new IllegalArgumentException("biz_type " + bizType + " is not a deduct source");
        if (amount > userBalanceBefore)
            throw new IllegalStateException("insufficient bean balance: "
                    + userBalanceBefore + " < " + amount);
        Entry debit = new Entry(userAccountId, Direction.DEBIT, amount,
                userBalanceBefore - amount, bizType, bizRef, null);
        Entry credit = new Entry(counterAccountId, Direction.CREDIT, amount,
                counterBefore + amount, bizType, bizRef, null);
        Tx tx = new Tx(txNo, credit, debit);
        txs.add(tx);
        return tx;
    }

    /**
     * 冲正退回（贷用户）：仅 biz_type=5。
     * 与 grant 的本质区别：退回的豆此前已发行过，**不占预算池、不占 global_cap**
     * （否则退款潮会把发行总量虚增）。对方科目=当初承接抵扣的平台科目。
     */
    public Tx reverse(String txNo, long userAccountId, long userBalanceBefore, long amount,
                      String bizRef, long counterAccountId, long counterBefore) {
        Entry credit = new Entry(userAccountId, Direction.CREDIT, amount,
                userBalanceBefore + amount, BIZ_REFUND_REVERSE, bizRef, null);
        Entry debit = new Entry(counterAccountId, Direction.DEBIT, amount,
                Math.max(0, counterBefore - amount), BIZ_REFUND_REVERSE, bizRef, null);
        Tx tx = new Tx(txNo, credit, debit);
        txs.add(tx);
        return tx;
    }

    /** 账本恒等式校验（日终对账 Job 与单测共用）：Σcredit == Σdebit，逐 tx 两行对冲 */
    public boolean isBalanced() {
        long sumCredit = 0, sumDebit = 0;
        for (Tx tx : txs) {
            if (tx.credit().amount() != tx.debit().amount()) return false;
            if (tx.credit().dir() != Direction.CREDIT || tx.debit().dir() != Direction.DEBIT) return false;
            sumCredit += tx.credit().amount();
            sumDebit += tx.debit().amount();
        }
        return sumCredit == sumDebit;
    }

    public List<Tx> txs() { return List.copyOf(txs); }
}
