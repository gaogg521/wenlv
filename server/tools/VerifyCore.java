import com.wanderlust.common.Result;
import com.wanderlust.infra.config.ConfigService;
import com.wanderlust.module.attestation.AttestationClient;
import com.wanderlust.module.attestation.NoopAttestationClient;
import com.wanderlust.module.bean.BeanLedger;
import com.wanderlust.module.order.OrderEvent;
import com.wanderlust.module.order.OrderStatus;
import com.wanderlust.module.order.OrderStateMachine;
import com.wanderlust.module.pass.PassCodeUtil;

import java.util.List;
import java.util.Map;

/**
 * 核心领域自检（无 Maven 环境下的第 0 阶段验证器；团队用 JUnit 后可平移为单测）。
 * 断言口径 = 总方案 V3.1：状态机守卫表 / 双分录恒等 / 预算与总量红线 / 核销码防重放 / 参数快照。
 */
public class VerifyCore {

    static int pass = 0, fail = 0;

    static void check(boolean cond, String name) {
        if (cond) { pass++; System.out.println("  PASS  " + name); }
        else      { fail++; System.out.println("  FAIL  " + name); }
    }

    public static void main(String[] args) throws Exception {
        System.out.println("== 1. 订单状态机（总方案 §7.3 守卫表） ==");
        // 主链路 10→20→30→40→50
        var t1 = OrderStateMachine.fire(OrderStatus.WAIT_PAY, OrderEvent.PAY_SUCCESS,
                "WL202610230001", "system", null);
        check(t1.to() == OrderStatus.PAID, "10 +PAY_SUCCESS→ 20");
        var t2 = OrderStateMachine.fire(OrderStatus.PAID, OrderEvent.CONFIRM,
                "WL202610230001", "system", null);
        check(t2.to() == OrderStatus.CONFIRMED, "20 +CONFIRM→ 30");
        var t3 = OrderStateMachine.fire(OrderStatus.CONFIRMED, OrderEvent.VERIFY_ALL,
                "WL202610230001", "merchant:1", null);
        check(t3.to() == OrderStatus.VERIFIED, "30 +VERIFY_ALL→ 40（商户核销驱动）");
        var t4 = OrderStateMachine.fire(OrderStatus.VERIFIED, OrderEvent.OBSERVE_END,
                "WL202610230001", "system", null);
        check(t4.to() == OrderStatus.COMPLETED, "40 +OBSERVE_END→ 50（触发返豆+计佣）");
        // 超时关单与退款
        check(OrderStateMachine.fire(OrderStatus.WAIT_PAY, OrderEvent.CLOSE_TIMEOUT,
                "WL202610230002", "system", null).to() == OrderStatus.CLOSED, "10 +CLOSE_TIMEOUT→ 90");
        check(OrderStateMachine.fire(OrderStatus.PAID, OrderEvent.REFUND_APPLY,
                "WL202610230003", "user", null).to() == OrderStatus.REFUNDING, "20 +REFUND_APPLY→ 60");
        check(OrderStateMachine.fire(OrderStatus.REFUNDING, OrderEvent.REFUND_SUCCESS,
                "WL202610230003", "system", null).to() == OrderStatus.REFUNDED, "60 +REFUND_SUCCESS→ 70（负向冲正）");
        // 非法组合必须抛
        boolean threw = false;
        try { OrderStateMachine.fire(OrderStatus.WAIT_PAY, OrderEvent.VERIFY_ALL, "X", "x", null); }
        catch (OrderStateMachine.IllegalTransitionException e) { threw = true; }
        check(threw, "10 +VERIFY_ALL 非法（抛 IllegalTransition）");
        threw = false;
        try { OrderStateMachine.fire(OrderStatus.COMPLETED, OrderEvent.PAY_SUCCESS, "X", "x", null); }
        catch (OrderStateMachine.IllegalTransitionException e) { threw = true; }
        check(threw, "终态 50 无出边（重复支付回调被守卫表拒绝）");
        check(!OrderStateMachine.canFire(OrderStatus.REFUNDED, OrderEvent.REFUND_APPLY),
                "70 +REFUND_APPLY 拒绝（canFire 预检）");

        System.out.println("== 2. 旅豆双分录（Σ贷=Σ借 / 预算红线 / 无购买枚举） ==");
        BeanLedger ledger = new BeanLedger();
        long cap = 6_000_000L;
        // 发放：贷用户/借预算池
        ledger.grant("TX1", 100L, 0L, 1_000L, BeanLedger.BIZ_CONSUME_REbate,
                "WL202610230001", 9L, 0L, 1_000_000L, 0L, 0L, cap);
        // 抵扣：借用户/贷平台
        ledger.deduct("TX2", 100L, 1_000L, 100L, BeanLedger.BIZ_DEDUCT,
                "WL202610230009", 1L, 0L);
        // 退款冲正退回（reverse：不占预算/总量）
        ledger.reverse("TX3", 100L, 900L, 100L, "WL202610230009", 1L, 100L);
        check(ledger.isBalanced(), "三笔事务后 Σ贷=Σ借 恒等");
        BeanLedger.Tx last = ledger.txs().get(ledger.txs().size() - 1);
        check(last.credit().afterBal() == 1_000L, "退款冲正后用户余额回到 1000");
        // 预算超限必须抛
        threw = false;
        try {
            ledger.grant("TX4", 100L, 1_000L, 500L, BeanLedger.BIZ_TASK,
                    "TASK-1", 9L, 999_999L, 1_000_000L, 0L, 2_000L, cap);
        } catch (BeanLedger.BudgetExceededException e) { threw = true; }
        check(threw, "批次预算超限拒绝（granted+X > total+returned 抛出）");
        threw = false;
        try {
            ledger.grant("TX5", 100L, 1_000L, 1L, BeanLedger.BIZ_CONTENT,
                    "NOTE-1", 9L, 0L, 10_000_000L, 0L, cap, cap); // globalIssued+1 > cap
        } catch (BeanLedger.BudgetExceededException e) { threw = true; }
        check(threw, "全局总量触顶拒绝（严禁超发红线）");
        threw = false;
        try {
            ledger.grant("TX6", 100L, 1_000L, 1L, 99, "X", 9L, 0L, 10_000_000L, 0L, 0L, cap);
        } catch (IllegalArgumentException e) { threw = true; }
        check(threw, "biz_type=99 非法（枚举封闭，无『购买』通道）");
        threw = false;
        try {
            ledger.deduct("TX7", 100L, 100L, 200L, BeanLedger.BIZ_DEDUCT, "X", 1L, 0L);
        } catch (IllegalStateException e) { threw = true; }
        check(threw, "余额不足抵扣拒绝");

        System.out.println("== 3. 动态核销码（HMAC / 窗口轮换 / ±1 容忍） ==");
        PassCodeUtil pc = new PassCodeUtil("unit-test-secret");
        long now = 1_796_000_040L; // 恰为窗口起点（% 60 == 0），排除测试自身跨窗
        long w = PassCodeUtil.windowOf(now, 60);
        check(PassCodeUtil.windowOf(now + 59, 60) == w, "59s 后同窗口");
        check(PassCodeUtil.windowOf(now + 61, 60) == w + 1, "61s 后下一窗口");
        String sig = pc.sign(77L, w);
        check(sig.length() == PassCodeUtil.SIG_FULL && sig.matches("[0-9a-f]+"), "签名 16 位 hex");
        check(!pc.sign(77L, w + 1).equals(sig), "换窗口换码（防截图重放的时间基础）");
        check(pc.verify(77L, w, sig) == w, "当前窗口验签通过");
        check(pc.verify(77L, w + 1, sig) == w, "下一窗口容忍 -1（时钟漂移）命中原窗口");
        check(pc.verify(77L, w + 2, sig) == -1, "超出 ±1 窗口拒绝");
        check(pc.verify(78L, w, sig) == -1, "换 passId 拒绝（码不可跨凭证复用）");
        String d1 = pc.displayCode(77L, w), d2 = pc.displayCode(77L, w);
        check(d1.length() == 6 && d1.equals(d2), "6 位展示码同窗稳定（人工输码兜底）");
        String qr = pc.qrPayload(77L, w);
        check(qr.startsWith("wl://v/77/" + w + "/"), "二维码格式 wl://v/{passId}/{window}/{sig}");

        System.out.println("== 4. 参数中心快照（V3.1 §4.1bis 定稿数字） ==");
        ConfigService cfg = new ConfigService();
        check(cfg.getDecimal("bean.order_rate").toPlainString().equals("0.10"), "返豆率 10%");
        check(cfg.getDecimal("bean.deduct_max_pct").toPlainString().equals("0.10"), "抵扣上限 10%");
        check(cfg.getInt("bean.expire_months") == 12, "12 个月滚动过期");
        check(cfg.getInt("bean.task_reward") == 200, "任务奖励 200 豆");
        int[] rewards = cfg.getIntArray("bean.script_rewards");
        check(rewards[0] == 80 && rewards[1] == 50 && rewards[2] == 20, "剧本三结局 80/50/20");
        long[] th = cfg.getLongArray("member.level.thresholds");
        check(th[0] == 0 && th[1] == 2000 && th[2] == 10000 && th[3] == 50000, "会员阈值 0/2k/10k/50k");
        int[] rates = cfg.getIntArray("promoter.rate_bp");
        check(rates.length == 3 && rates[2] == 1200, "推广三档 5%/8%/12% 封顶");
        check(cfg.getInt("order.observe_days") == 7, "观察期 7 天");
        check(cfg.getInt("pass.code_window") == 60, "核销码窗口 60s");
        check(cfg.getInt("budget.approval.l1") == 300000 && cfg.getInt("budget.approval.l2") == 800000,
                "超支审批 3000/8000 元");
        check(cfg.getDecimal("budget.fuse_pct").toPlainString().equals("0.25"), "熔断线 25%");
        check(cfg.defaultsSnapshot().size() == 34, "参数快照 34 个 key 全量（与 V2 种子 SQL 逐行一致）");
        // 覆盖生效
        cfg.applyOverrides(Map.of("bean.order_rate", "0.08"));
        check(cfg.getDecimal("bean.order_rate").toPlainString().equals("0.08"),
                "参数中心改值即时生效（0.10→0.08）");

        System.out.println("== 5. 存证 Noop 与统一响应 ==");
        AttestationClient attest = new NoopAttestationClient();
        attest.submit("order", "WL202610230001", "deadbeef");
        String ref = attest.anchorBatch("2026-10-23", List.of("deadbeef", "cafebabe"));
        check("NOOP".equals(ref), "Noop 锚定返回 NOOP（P0 工程不等链）");
        check(!attest.verify("order", "WL202610230001").anchored(), "Noop 验证未锚定");
        Result<String> ok = Result.ok("x");
        check(ok.code() == 0 && ok.traceId() != null, "统一响应 ok(code=0, traceId)");
        Result<Void> err = Result.err(Result.ErrorCode.BEAN_BUDGET_EXCEEDED, "预算不足");
        check(err.code() == 5002, "错误码 5xxx=旅豆域");

        System.out.println();
        System.out.println("RESULT: " + pass + " PASS / " + fail + " FAIL");
        if (fail > 0) System.exit(1);
    }
}
