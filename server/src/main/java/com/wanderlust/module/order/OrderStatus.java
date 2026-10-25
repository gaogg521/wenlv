package com.wanderlust.module.order;

/**
 * 订单状态机（总方案 §7.3）。
 * 状态值与 orders.status 列一致；唯一写入口是 OrderStateMachine.fire。
 */
public enum OrderStatus {
    WAIT_PAY(10),
    PAID(20),
    CONFIRMED(30),
    VERIFIED(40),
    COMPLETED(50),
    REFUNDING(60),
    REFUNDED(70),
    CLOSED(90);

    public final int code;

    OrderStatus(int code) { this.code = code; }

    public static OrderStatus of(int code) {
        for (OrderStatus s : values()) {
            if (s.code == code) return s;
        }
        throw new IllegalArgumentException("unknown order status code: " + code);
    }
}
