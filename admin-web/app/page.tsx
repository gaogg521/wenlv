// 驾驶舱六卡（总方案 §11.3）：数据来自 GET /admin/dash/kpi
async function getKpi() {
  try {
    const r = await fetch('http://127.0.0.1:8080/admin/dash/kpi', { cache: 'no-store' })
    const j = await r.json()
    return j.code === 0 ? j.data : null
  } catch { return null }
}

export default async function Dashboard() {
  const kpi = await getKpi()
  const cards = [
    ['今日 GMV', kpi?.gmvToday ?? '—'],
    ['今日订单', kpi?.ordersToday ?? '—'],
    ['核销率', kpi?.verifyRate ?? '—'],
    ['90 天复购', kpi?.repurchase90d ?? '—'],
    ['预算池水位', kpi?.budgetUsage ?? '—'],
    ['异常告警', kpi?.alerts ?? 0],
  ]
  return (
    <div>
      <h2>经营驾驶舱</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {cards.map(([label, value]) => (
          <div key={label} style={{ background: '#fff', borderRadius: 12, padding: 20, boxShadow: '0 1px 4px rgba(20,40,80,.06)' }}>
            <div style={{ color: '#8a919c', fontSize: 13 }}>{label}</div>
            <div style={{ fontSize: 28, fontWeight: 700, marginTop: 6 }}>{String(value)}</div>
          </div>
        ))}
      </div>
      <p style={{ color: '#8a919c', fontSize: 13 }}>
        后端未连接时展示占位（wanderlust-server 启动后自动取数）；图表/趋势 P1 接 ECharts。
      </p>
    </div>
  )
}
