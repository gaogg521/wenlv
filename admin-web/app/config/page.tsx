// 参数中心（总方案 §4.2）：分组浏览 / 双人复核 / 影响预览 / 版本回滚
const GROUPS = [
  ['bean', '旅豆（返豆率/抵扣上限/过期/发行总量）', true],
  ['member', '会员（等级阈值/成长系数/保级）', true],
  ['promoter', '推广（三档费率/定档门槛/提现）', true],
  ['order', '订单（支付超时/观察期/退改梯度/成团取消）', false],
  ['settlement', '结算（佣金 T+N/出账日）', true],
  ['cost', '成本控制（审批阈值/熔断/预警）', true],
]

export default function ConfigCenter() {
  return (
    <div>
      <h2>参数中心</h2>
      <p style={{ color: '#8a919c', fontSize: 13 }}>
        全部业务数字在此修改：敏感参数强制双人复核（提案→审批→生效），带影响预览与版本回滚；
        promoter.rate_bp 受数据库 CHECK 约束（500/800/1200）——突破 12% 封顶需先变更表结构（D2）。
      </p>
      <table style={{ width: '100%', background: '#fff', borderRadius: 12, borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ textAlign: 'left', borderBottom: '1px solid #ecedf1' }}>
            <th style={{ padding: 12 }}>分组</th><th>说明</th><th>敏感（双人复核）</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          {GROUPS.map(([k, desc, sensitive]) => (
            <tr key={k} style={{ borderBottom: '1px solid #f4f5f7' }}>
              <td style={{ padding: 12, fontWeight: 600 }}>{k}</td>
              <td>{desc}</td>
              <td>{sensitive ? '是' : '否'}</td>
              <td><a href="#">查看/修改</a></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
