export const metadata = { title: '向往的自由 · 运营后台' }

const nav = [
  ['/', '驾驶舱'], ['/orders', '订单'], ['/config', '参数中心'],
]

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body style={{ margin: 0, fontFamily: '-apple-system,"PingFang SC",sans-serif', background: '#f4f5f7' }}>
        <nav style={{ display: 'flex', gap: 24, padding: '14px 24px', background: '#0f766e', color: '#fff' }}>
          <b>向往的自由 · PC 运营后台</b>
          {nav.map(([href, label]) => (
            <a key={href} href={href} style={{ color: '#fff', textDecoration: 'none', opacity: 0.9 }}>{label}</a>
          ))}
          <span style={{ marginLeft: 'auto', opacity: 0.8 }}>RBAC · TOTP · 审计留痕</span>
        </nav>
        <main style={{ padding: 24 }}>{children}</main>
      </body>
    </html>
  )
}
