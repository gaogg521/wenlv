package com.wanderlust.module.order;

import com.wanderlust.infra.config.ConfigService;
import com.wanderlust.infra.db.Db;

import java.util.Map;

/**
 * 订单域：下单（锁团期 + 旅豆抵扣即扣 + 幂等）→ 支付 → 确认 → 核销 → 完成 → 退款冲正。
 * 状态流转全部经 OrderStateMachine（守卫表）；每次流转写 order_event。
 */
public class OrderService {

    public static final String ACTOR_USER = "user";
    public static final String ACTOR_SYSTEM = "system";

    private final Db db;
    private final ConfigService cfg;

    public OrderService(Db db, ConfigService cfg) {
        this.db = db;
        this.cfg = cfg;
    }

    /** 业务单号：WL + 日期 + 时间基随机（生产换发号器） */
    private String newOrderNo() {
        return String.format("WL%s%05d", new java.text.SimpleDateFormat("yyyyMMdd")
                .format(new java.util.Date()), System.nanoTime() % 100000);
    }

    public static final class PlaceResult {
        public final String orderNo;
        public final long amountPay;
        public final long beanDeducted;
        public PlaceResult(String o, long p, long b) { orderNo = o; amountPay = p; beanDeducted = b; }
    }

    /** 下单：条件 UPDATE 锁名额（防超卖）→ 豆抵扣即扣（biz=4）→ 建单(10)。名额不足抛异常。 */
    public PlaceResult place(long userId, long sessionId, int qty,
                             long wantedBeanDeduct, String promoScene, BeanDeductor deductor) {
        Map<String, Object> s = db.queryOne(
                "SELECT product_id, price_adult, quota, booked, status FROM tour_session WHERE id = ?", sessionId);
        if (s == null) throw new IllegalStateException("团期不存在");
        if (((Number) s.get("status")).intValue() != 1) throw new IllegalStateException("团期不在报名中");
        long price = ((Number) s.get("price_adult")).longValue();
        long goods = price * qty;
        long productId = ((Number) s.get("product_id")).longValue();

        long beans = deductor.clamp(wantedBeanDeduct, goods); // 上限 10% 封顶
        long dedFen = deductor.amountFen(beans);
        long pay = goods - dedFen;

        String orderNo = newOrderNo();
        db.tx(c -> {
            // 条件更新防超卖：仅当余量足够时占位
            int n = db.update(c,
                    "UPDATE tour_session SET booked = booked + ? WHERE id = ? AND booked + ? <= quota",
                    qty, sessionId, qty);
            if (n != 1) throw new IllegalStateException("名额不足（并发超卖被条件更新拦截）");
            long orderId = db.insertReturnId(c,
                    "INSERT INTO orders (order_no, user_id, product_id, session_id, city_code, merchant_id, qty, "
                            + "amount_goods, amount_bean_ded, bean_deducted, amount_pay, status, promo_scene) "
                            + "SELECT ?,?,?,?,p.city_code,p.merchant_id,?,?,?,?,?,10,? FROM tour_product p WHERE p.id = ?",
                    orderNo, userId, productId, sessionId, qty, goods, dedFen, beans, pay, promoScene, productId);
            if (pay < goods) {
                deductor.deduct(userId, beans, orderNo); // 抵扣即真实扣减（总方案 D3 裁决）
            }
            db.update(c, "INSERT INTO order_event (order_id, from_st, to_st, actor, detail) VALUES (?,?,?,?,?)",
                    orderId, 0, 10, "user:" + userId, jsonStr("下单占位"));
            return null;
        });
        return new PlaceResult(orderNo, pay, beans);
    }

    public Map<String, Object> byNo(String orderNo) {
        return db.queryOne("SELECT * FROM orders WHERE order_no = ?", orderNo);
    }

    public long statusOf(Map<String, Object> order) {
        return ((Number) order.get("status")).longValue();
    }

    /** 状态机流转统一入口：守卫校验 → listener → 落库 + order_event */
    public void fire(String orderNo, OrderEvent ev, String actor, OrderStateMachine.Listener listener) {
        Map<String, Object> o = byNo(orderNo);
        if (o == null) throw new IllegalStateException("订单不存在: " + orderNo);
        OrderStatus from = OrderStatus.of(((Number) o.get("status")).intValue());
        OrderStateMachine.Transition t = OrderStateMachine.fire(from, ev, orderNo, actor, listener);
        int n = db.update("UPDATE orders SET status = ?, version = version + 1 WHERE id = ? AND version = ?",
                t.to().code, o.get("id"), o.get("version"));
        if (n != 1) throw new IllegalStateException("并发冲突（乐观锁）: " + orderNo);
        db.update("INSERT INTO order_event (order_id, from_st, to_st, actor, detail) VALUES (?,?,?,?,?)",
                o.get("id"), t.from().code, t.to().code, actor,
                jsonStr(t.detail() == null ? ev.name() : t.detail()));
    }


    /** detail 为 JSON 列：统一包成合法 JSON 字符串 */
    private static String jsonStr(String text) {
        return "\"" + (text == null ? "" : text.replace("\\", "\\\\").replace("\"", "\"")) + "\"";
    }

    /** 15 分钟未支付关单 + 释放名额（定时任务） */
    public int closeTimeoutOrders(QuotaReleaser releaser) {
        var stale = db.query(
                "SELECT id, order_no, session_id, qty FROM orders WHERE status = 10 "
                        + "AND created_at < NOW() - INTERVAL ? MINUTE", cfg.getInt("order.pay_timeout"));
        for (var o : stale) {
            db.tx(c -> {
                int n = db.update(c, "UPDATE orders SET status = 90, version = version + 1 WHERE id = ? AND status = 10", o.get("id"));
                if (n == 1) {
                    db.update(c, "UPDATE tour_session SET booked = booked - ? WHERE id = ?",
                            o.get("qty"), o.get("session_id"));
                    db.update(c, "INSERT INTO order_event (order_id, from_st, to_st, actor, detail) VALUES (?,10,90,'system',?)",
                            o.get("id"), jsonStr("超时关单"));
                }
                return null;
            });
        }
        return stale.size();
    }

    /** 豆抵扣回调接口（由 BeanService 实现，避免域间直依赖） */
    public interface BeanDeductor {
        long clamp(long wantedBeans, long orderAmountFen);
        long amountFen(long beans);
        void deduct(long userId, long beans, String orderNo);
    }

    public interface QuotaReleaser { }
}
