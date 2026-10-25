package com.wanderlust.infra.config;

import java.math.BigDecimal;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 参数中心（总方案 §4.1bis / §4.2）。
 *
 * 规约：代码只允许通过本类取业务数字 —— 可硬编码的只有结构（枚举/状态机/公式形状），
 * 一切数值/比例/阈值/天数来自参数（DB rule_config 优先，此处 DEFAULTS 兜底）。
 * 生产实现：Repo 层加载 rule_config 表 + Redis 缓存 + 变更广播；本类先以默认值跑通第 0 阶段。
 */
public class ConfigService {

    /** 定稿初始值（与 V2__seed_rule_config.sql 一一对应；改这里必须同步改种子与单测快照） */
    private static final Map<String, String> DEFAULTS = buildDefaults();

    private volatile Map<String, String> overrides = Map.of();

    private static Map<String, String> buildDefaults() {
        Map<String, String> m = new LinkedHashMap<>();
        // bean
        m.put("bean.order_rate", "0.10");
        m.put("bean.deduct_max_pct", "0.10");
        m.put("bean.expire_months", "12");
        m.put("bean.value_anchor", "{\"beans\":100,\"yuan\":10}");
        m.put("bean.task_reward", "200");
        m.put("bean.note_reward", "50");
        m.put("bean.note_weekly_cap", "500");
        m.put("bean.script_rewards", "[80,50,20]");
        m.put("bean.budget_profit_pct", "0.05");
        m.put("bean.global_cap_yuan", "600000");
        // member
        m.put("member.level.thresholds", "[0,2000,10000,50000]");
        m.put("member.cs_multiplier", "10");
        m.put("member.annual_reset", "true");
        // promoter
        m.put("promoter.tier2_gmv", "1000000");
        m.put("promoter.tier3_gmv", "5000000");
        m.put("promoter.rate_bp", "[500,800,1200]");
        m.put("promoter.tier3_score_min", "4.5");
        m.put("promoter.window_days", "90");
        m.put("promoter.withdraw_min", "10000");
        m.put("promoter.withdraw_daily_max", "500000");
        // contribution
        m.put("contribution.weights", "{\"q\":0.5,\"s\":0.3,\"r\":0.2}");
        // order
        m.put("order.pay_timeout", "15");
        m.put("order.observe_days", "7");
        m.put("order.refund_policy", "{\"d7\":0.0,\"d3\":0.10,\"d1\":0.30}");
        m.put("order.group_cancel_hours", "48");
        // pass
        m.put("pass.code_window", "60");
        // settlement / cost
        m.put("commission.settle_delay_days", "7");
        m.put("settlement.weekday", "1");
        m.put("budget.approval.l1", "300000");
        m.put("budget.approval.l2", "800000");
        m.put("budget.fuse_pct", "0.25");
        m.put("budget.forecast.warn", "[0.25,0.50]");
        // channel
        m.put("city.initial", "[\"310118\",\"320508\"]");
        m.put("channel.initial", "[\"main\"]");
        return Map.copyOf(m);
    }

    /** 运行时覆盖（参数中心生效入口；生产由 DB 广播调用） */
    public void applyOverrides(Map<String, String> kv) {
        Map<String, String> next = new LinkedHashMap<>(overrides);
        next.putAll(kv);
        this.overrides = Map.copyOf(next);
    }

    public String raw(String key) {
        String v = overrides.get(key);
        return v != null ? v : DEFAULTS.get(key);
    }

    public int getInt(String key) { return Integer.parseInt(raw(key).trim()); }

    public long getLong(String key) { return Long.parseLong(raw(key).trim()); }

    public boolean getBool(String key) { return Boolean.parseBoolean(raw(key).trim()); }

    public BigDecimal getDecimal(String key) { return new BigDecimal(raw(key).trim()); }

    public int[] getIntArray(String key) {
        String s = raw(key).replaceAll("[\\[\\] ]", "");
        String[] parts = s.split(",");
        int[] out = new int[parts.length];
        for (int i = 0; i < parts.length; i++) out[i] = Integer.parseInt(parts[i]);
        return out;
    }

    public long[] getLongArray(String key) {
        String s = raw(key).replaceAll("[\\[\\] ]", "");
        String[] parts = s.split(",");
        long[] out = new long[parts.length];
        for (int i = 0; i < parts.length; i++) out[i] = Long.parseLong(parts[i]);
        return out;
    }

    /** 定稿快照（单测断言用：防止无意识改参） */
    public Map<String, String> defaultsSnapshot() { return DEFAULTS; }
}
