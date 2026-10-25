export default function Orders() {
  return (
    <div>
      <h2>订单管理</h2>
      <p style={{ color: '#8a919c', fontSize: 13 }}>
        全量订单 · 多维筛选 · 退款审批（观察期 7 天）· 操作留痕（audit_log）。
        状态机：10 待支付 → 20 已支付 → 30 已确认 → 40 已核销 → 50 已完成 · 60/70 退款 · 90 关闭。
      </p>
    </div>
  )
}
