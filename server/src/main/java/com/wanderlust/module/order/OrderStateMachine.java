package com.wanderlust.module.order;

import java.util.Map;
import java.util.Set;

/**
 * 订单状态机 —— 全项目唯一的订单状态写入口（总方案 §7.3）。
 *
 * 三端（小程序A / 商户端 / 后台）都只能通过本类改状态：
 *   fire(orderNo, event, actor) 在事务内：
 *   1) 守卫表校验 (from, event) 合法；
 *   2) 回调 listener 执行该流转的业务动作（占名额/建凭证/冲正…）；
 *   3) listener 返回后的新状态由调用方落库并写 order_event。
 *
 * 纯 JDK 实现，不依赖 Spring / 数据库 —— 单测直接覆盖守卫表。
 */
public final class OrderStateMachine {

    /** 流转守卫表：(当前状态, 事件) -> 目标状态。不在表内的组合一律非法。 */
    private static final Map<OrderStatus, Map<OrderEvent, OrderStatus>> GUARDS = Map.of(
            OrderStatus.WAIT_PAY, Map.of(
                    OrderEvent.PAY_SUCCESS, OrderStatus.PAID,
                    OrderEvent.CLOSE_TIMEOUT, OrderStatus.CLOSED),
            OrderStatus.PAID, Map.of(
                    OrderEvent.CONFIRM, OrderStatus.CONFIRMED,
                    OrderEvent.REFUND_APPLY, OrderStatus.REFUNDING),
            OrderStatus.CONFIRMED, Map.of(
                    OrderEvent.VERIFY_ALL, OrderStatus.VERIFIED,
                    OrderEvent.REFUND_APPLY, OrderStatus.REFUNDING),
            OrderStatus.VERIFIED, Map.of(
                    OrderEvent.OBSERVE_END, OrderStatus.COMPLETED,
                    OrderEvent.REFUND_APPLY, OrderStatus.REFUNDING),
            OrderStatus.REFUNDING, Map.of(
                    OrderEvent.REFUND_SUCCESS, OrderStatus.REFUNDED),
            // 终态：COMPLETED / REFUNDED / CLOSED 无出边
            OrderStatus.COMPLETED, Map.of(),
            OrderStatus.REFUNDED, Map.of(),
            OrderStatus.CLOSED, Map.of()
    );

    /** 流转副作用接口：由各领域模块实现（支付/凭证/账本/佣金），在状态落库前执行。 */
    public interface Listener {
        /**
         * @return 业务明细（写入 order_event.detail），抛异常则整个流转回滚
         */
        String onTransition(String orderNo, OrderStatus from, OrderStatus to, String actor);
    }

    /** 一次成功流转的结果 */
    public record Transition(String orderNo, OrderStatus from, OrderStatus to,
                             OrderEvent event, String actor, String detail) { }

    /** 非法流转（并发/重复回调/乱序）一律抛出，由上层转 4xx + 告警 */
    public static final class IllegalTransitionException extends RuntimeException {
        public IllegalTransitionException(OrderStatus from, OrderEvent event) {
            super("illegal order transition: " + from + " + " + event);
        }
    }

    private OrderStateMachine() { }

    /** 预检：不改状态，只判断 (from, event) 是否合法（幂等重放判断用） */
    public static boolean canFire(OrderStatus from, OrderEvent event) {
        return GUARDS.get(from).containsKey(event);
    }

    /** 唯一写入口 */
    public static Transition fire(OrderStatus current, OrderEvent event,
                                  String orderNo, String actor, Listener listener) {
        OrderStatus to = GUARDS.get(current).get(event);
        if (to == null) throw new IllegalTransitionException(current, event);
        String detail = listener == null ? null
                : listener.onTransition(orderNo, current, to, actor);
        return new Transition(orderNo, current, to, event, actor, detail);
    }

    /** 供测试/文档断言守卫表全貌 */
    public static Set<Map.Entry<OrderStatus, Map<OrderEvent, OrderStatus>>> guardTable() {
        return GUARDS.entrySet();
    }
}
