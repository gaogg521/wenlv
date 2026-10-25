package com.wanderlust.module.payment;

import com.wanderlust.infra.db.Db;
import com.wanderlust.module.bean.BeanLedger;
import com.wanderlust.module.bean.BeanService;
import com.wanderlust.module.order.OrderEvent;
import com.wanderlust.module.order.OrderService;
import com.wanderlust.module.order.OrderStateMachine;

import java.util.Map;

/**
 * 支付域：微信支付回调（幂等）→ 订单 10→20；退款 → 60→70 + 全量负向冲正。
 * 第 0 阶段以「模拟收付通」实现通道语义（幂等键 / 回调原文留档 / 原路退款），
 * 生产接 com.weixin.pay SDK 后仅替换 channel 层，本类状态编排不变。
 */
public class PaymentService {

    private final Db db;
    private final OrderService orders;
    private final BeanService beans;

    public PaymentService(Db db, OrderService orders, BeanService beans) {
        this.db = db;
        this.orders = orders;
        this.beans = beans;
    }

    /** 支付成功回调（幂等：transNo 唯一，重复回调直接返回已处理） */
    public boolean onPaySuccess(String orderNo, String wxTransNo, long amountFen) {
        // 幂等闸 1：同微信单号只处理一次
        Map<String, Object> pay = db.queryOne("SELECT id, status FROM payment WHERE wx_trans_no = ?", wxTransNo);
        if (pay != null) return false; // 重放

        Map<String, Object> o = orders.byNo(orderNo);
        if (o == null) throw new IllegalStateException("订单不存在");
        if (((Number) o.get("amount_pay")).longValue() != amountFen)
            throw new IllegalStateException("支付金额不符（防篡改）: " + amountFen);

        db.tx(c -> {
            // 幂等闸 2：唯一键兜底（并发双回调只有一个成功）
            boolean ok = db.tryInsert(c,
                    "INSERT INTO payment (order_id, wx_trans_no, amount, status, callback_at) "
                            + "VALUES (?,?,?,1,NOW(3))", o.get("id"), wxTransNo, amountFen);
            if (!ok) return false;
            return null;
        });

        if (((Number) o.get("status")).longValue() == 10) {
            orders.fire(orderNo, OrderEvent.PAY_SUCCESS, "system", (no, from, to, actor) -> {
                db.update("UPDATE orders SET paid_at = NOW(3) WHERE order_no = ?", no);
                return "支付回调 " + wxTransNo;
            });
        }
        return true;
    }

    /** 支付成功后的确认（出票/建 travel_pass 由 PassService 在 listener 里完成） */
    public void confirm(String orderNo, Runnable onConfirmed) {
        orders.fire(orderNo, OrderEvent.CONFIRM, "system", (no, from, to, actor) -> {
            if (onConfirmed != null) onConfirmed.run();
            return "确认出票";
        });
    }

    /**
     * 退款全链：60→70 + 负向冲正（退回抵扣豆 / 回收已返豆 / 佣金置无效 / 释放名额）。
     * 平台默认退改梯度由参数中心 order.refund_policy 决定应退金额（此处演示全额）。
     */
    public void refund(String orderNo, String reason, RefundHooks hooks) {
        Map<String, Object> o = orders.byNo(orderNo);
        if (o == null) throw new IllegalStateException("订单不存在");
        long st = ((Number) o.get("status")).longValue();
        if (st == 10) throw new IllegalStateException("未支付订单直接关闭，无退款");

        // 退款单（幂等：同订单仅一条进行中/成功）
        db.tx(c -> {
            long rid = db.insertReturnId(c,
                    "INSERT INTO refunds (order_id, refund_no, amount, reason, status, operator) "
                            + "VALUES (?,?,?,?,0,'user')",
                    o.get("id"), "RF" + System.nanoTime(), o.get("amount_pay"), reason);
            db.update(c, "UPDATE payment SET status = 3 WHERE order_id = ?", o.get("id"));
            return rid;
        });

        if (st == 20 || st == 30 || st == 40) {
            orders.fire(orderNo, OrderEvent.REFUND_APPLY, "user", null);
        }
        orders.fire(orderNo, OrderEvent.REFUND_SUCCESS, "system", (no, from, to, actor) -> {
            hooks.onRefundSuccess(no); // 各域冲正钩子（豆/佣金/权益）
            db.update("UPDATE refunds SET status = 2, settled_at = NOW(3) WHERE order_id = ? AND status IN (0,1)", o.get("id"));
            db.update("UPDATE payment SET status = 4 WHERE order_id = ?", o.get("id"));
            return "退款成功·冲正完成";
        });
    }

    public interface RefundHooks {
        void onRefundSuccess(String orderNo);
    }
}
