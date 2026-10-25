package com.wanderlust.common;

/** 统一响应（总方案 §7.7）：code 分段 1xxx通用 2xxx订单 3xxx支付 4xxx凭证 5xxx旅豆 6xxx推广 7xxx内容 9xxx系统 */
public record Result<T>(int code, String msg, T data, String traceId) {

    public static <T> Result<T> ok(T data) { return new Result<>(0, "ok", data, Trace.current()); }

    public static Result<Void> err(ErrorCode ec, String msg) {
        return new Result<>(ec.code, msg, null, Trace.current());
    }

    /** 简易 trace 上下文（生产接 SkyWalking/日志 MDC） */
    public static final class Trace {
        private static final ThreadLocal<String> T = new ThreadLocal<>();
        public static void set(String id) { T.set(id); }
        public static String current() {
            String v = T.get();
            return v != null ? v : "local";
        }
    }

    /** 错误码枚举（起步版；随接口扩展增补） */
    public enum ErrorCode {
        PARAM_INVALID(1001),
        UNAUTHORIZED(1002),
        FORBIDDEN(1003),
        NOT_FOUND(1004),
        IDEMPOTENT_REPLAY(1005),

        SESSION_SOLD_OUT(2001),
        ORDER_STATE_ILLEGAL(2002),
        ORDER_NOT_FOUND(2003),
        GROUP_CANCELLED(2004),

        PAY_CALLBACK_INVALID(3001),
        PAY_AMOUNT_MISMATCH(3002),

        PASS_EXPIRED(4001),
        PASS_CODE_INVALID(4002),
        PASS_ALREADY_VERIFIED(4003),

        BEAN_INSUFFICIENT(5001),
        BEAN_BUDGET_EXCEEDED(5002),
        BEAN_GLOBAL_CAP(5003),

        PROMOTER_NOT_ACTIVE(6001),
        COMMISSION_DUPLICATED(6002),

        CONTENT_REJECTED(7001),

        SYSTEM_ERROR(9000);

        public final int code;
        ErrorCode(int code) { this.code = code; }
    }
}
