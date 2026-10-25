// 「向往的自由」API 服务（Node 18+ · 零框架 · mysql2 唯一依赖）
// 启动：node src/index.mjs   （环境变量见 .env.example）
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { routes } from './routes.mjs'
import { q, one, count } from './db.mjs'
import { hashPassword } from './auth.mjs'
import { isLive } from './domain/wxpay.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 8080)

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' }

async function bootstrap() {
  // 后台超管种子（首次启动；密码 ADMIN_INIT_PASSWORD，默认 admin123，登录后必须修改）
  const c = await one('SELECT COUNT(*) c FROM admin_user')
  if (Number(c.c) === 0) {
    const pw = process.env.ADMIN_INIT_PASSWORD || 'admin123'
    await q(`INSERT INTO admin_user (username, password_hash, role, display_name) VALUES
      ('admin', ?, 'super', '超级管理员'),
      ('finance', ?, 'finance', '财务'),
      ('ops', ?, 'ops', '运营')`, [hashPassword(pw), hashPassword(pw), hashPassword(pw)])
    console.log('[boot] 后台账号已种入：admin / finance / ops（初始密码 ' + pw + '，上线后立即修改）')
  }
  // 城市合伙人演示账号（幂等，独立于首启种子块）
  const cityPw = process.env.CITY_PARTNER_PASSWORD || 'city123'
  await q(`INSERT INTO admin_user (username, password_hash, role, display_name, scope_city) VALUES
    ('city310118', ?, 'city_partner', '青浦城市合伙人·演示', '310118') ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
    [hashPassword(cityPw)])
  console.log('[boot] 城市合伙人演示账号：city310118（仅可见 310118 青浦数据）')
  // 空库自动播种示例内容（商户/线路/商城SKU/团期/预算/示例推广员）
  try {
    const { seedContent } = await import('../db/seed-content.mjs')
    await seedContent()
  } catch (e) { console.error('[boot:seed]', e.message) }
}

function json(res, code, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ code, msg: code === 0 ? 'ok' : (data && data.message) || 'error', data: code === 0 ? data : null, traceId: 't' + Date.now().toString(36) }))
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const pathname = decodeURIComponent(url.pathname)

  // 静态：/admin-ui → 管理后台 SPA（生产挂 Nginx/CDN 亦可）
  if (req.method === 'GET' && (pathname === '/' || pathname.startsWith('/admin-ui'))) {
    const rel = (pathname === '/' || pathname === '/admin-ui' || pathname === '/admin-ui/') ? '/index.html' : pathname.replace('/admin-ui', '')
    const file = path.join(__dirname, '..', 'admin', rel)
    if (file.startsWith(path.join(__dirname, '..', 'admin')) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
      return res.end(fs.readFileSync(file))
    }
  }
  // 静态：/uploads → 用户上传文件（头像等；路径穿越已防护）
  if (req.method === 'GET' && pathname.startsWith('/uploads/')) {
    const file = path.join(__dirname, '..', 'static', pathname)
    if (file.startsWith(path.join(__dirname, '..', 'static')) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'public, max-age=86400' })
      return res.end(fs.readFileSync(file))
    }
  }
  if (req.method === 'GET' && pathname === '/c/health') {
    return json(res, 0, { app: 'wanderlust-api', payMode: isLive() ? 'WECHAT-PAY-V3' : 'MOCK', time: new Date().toISOString() })
  }

  // API 路由匹配（含 :param）
  let handler = null, params = {}
  for (const key of Object.keys(routes)) {
    const [m, p] = key.split(' ')
    if (m !== req.method) continue
    const pk = p.split('/'), uk = pathname.split('/')
    if (pk.length !== uk.length) continue
    const cur = {}
    let ok = pk.every((seg, i) => seg.startsWith(':') ? (cur[seg.slice(1)] = uk[i], true) : seg === uk[i])
    if (ok) { handler = routes[key]; params = cur; break }
  }
  if (!handler) return json(res, 1004, { message: '接口不存在: ' + req.method + ' ' + pathname }, 404)

  const chunks = []
  for await (const ch of req) chunks.push(ch)
  const rawBody = Buffer.concat(chunks).toString('utf8')
  let body = {}
  try { body = rawBody ? JSON.parse(rawBody) : {} } catch { body = {} }
  const query = Object.fromEntries(url.searchParams)

  try {
    const data = await handler({ headers: req.headers, method: req.method, url: req.url, body, query, params, rawBody }, res)
    json(res, 0, data)
  } catch (e) {
    if (e && e.code) return json(res, e.code, { message: e.message })
    console.error('[err]', req.method, pathname, e)
    json(res, 9000, { message: '系统错误：' + e.message }, 500)
  }
})

bootstrap().then(() => {
  server.listen(PORT, () => console.log(`[wanderlust-api] http://127.0.0.1:${PORT}  管理后台: http://127.0.0.1:${PORT}/admin-ui  支付通道: ${isLive() ? '微信支付V3(生产)' : 'MOCK(联调)'}`))
}).catch((e) => { console.error('[boot failed]', e.message); process.exit(1) })
