package com.wanderlust.module.order;

/** 订单事件（触发状态流转的输入，总方案 §7.3 状态图） */
public enum OrderEvent {
    PAY_SUCCESS,      // 支付回调成功            10→20
    CONFIRM,          // 出票/确认（建 travel_pass）20→30
    VERIFY_ALL,       // 全部权益核销完           30→40
    OBSERVE_END,      // 退款观察期结束（定时任务） 40→50 → 触发返豆+计佣
    REFUND_APPLY,     // 退款申请（任意已付状态）   20/30/40→60
    REFUND_SUCCESS,   // 退款成功 → 负向冲正       60→70
    CLOSE_TIMEOUT     // 15分钟未支付自动关        10→90
}
