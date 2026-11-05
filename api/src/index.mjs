// 「向往的自由」API 服务（Node 18+ · 零框架 · mysql2 唯一依赖）
// 启动：node src/index.mjs   （环境变量见 .env.example）
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { routes } from './routes.mjs'
import { q, one, count } from './db.mjs'
import { matchRouteModule } from './domain/admin-modules.mjs'
import { requireModule } from './routes/_shared.mjs'
import { hashPassword } from './auth.mjs'
import { isLive } from './domain/wxpay.mjs'
import { serveBadgeArt } from './domain/badge-art.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 8080)

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' }

async function bootstrap() {
  // 预热凭据缓存：链适配器同步读取后台保存的加密凭据（见 infra/chain/conf.mjs）
  const secrets = await import('./infra/secrets.mjs') // SECRETS_KEY 格式错误会在这里直接报错退出
  if (secrets.keySource === 'derived' && process.env.NODE_ENV === 'production') {
    console.warn('[secrets] 生产环境未设置 SECRETS_KEY：凭据主密钥正由 JWT_SECRET 派生，更换 JWT_SECRET 会导致已保存凭据无法解密。\n' +
      '          运行 node scripts/secrets-key.mjs current 取得当前主密钥，原样设为 SECRETS_KEY 即可（已存凭据无需重新加密）。')
  }
  await secrets.warmSecrets().catch(() => {})
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
    ('city310118', ?, 'city_partner', '青浦城市合伙人·演示', '310118') ON DUPLICATE KEY UPDATE username = VALUES(username)`,
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
  res.end(JSON.stringify({ code, msg: code === 0 ? 'ok' : (data && data.message) || 'error', data: code === 0 ? data : (data && data.fieldErrors ? { fieldErrors: data.fieldErrors } : null), traceId: 't' + Date.now().toString(36) }))
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
  // 静态：/verify → 公开复核页（给景区/政府/投资人，无登录，浏览器内自算哈希）
  if (req.method === 'GET' && (pathname === '/verify' || pathname === '/verify/' || pathname === '/verify.html')) {
    const file = path.join(__dirname, '..', 'static', 'verify.html')
    if (fs.existsSync(file)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      return res.end(fs.readFileSync(file))
    }
  }
  // 静态：/vc → 数字身份验签台（给景区/合作城市/境外生态，无登录）
  if (req.method === 'GET' && (pathname === '/vc' || pathname === '/vc/' || pathname === '/vc.html')) {
    const file = path.join(__dirname, '..', 'static', 'vc.html')
    if (fs.existsSync(file)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
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
  // 静态：/badge-art/<勋章id>.svg → 服务端生成的勋章图形（公开，不含任何用户数据；?state=off 为未获得灰阶）
  if (req.method === 'GET' && pathname.startsWith('/badge-art/')) {
    const art = await serveBadgeArt(pathname, url.searchParams) // SVG 字符串或 PNG Buffer
    if (art !== null) {
      if (!art.length) { res.writeHead(404); return res.end() }
      res.writeHead(200, { 'Content-Type': Buffer.isBuffer(art) ? 'image/png' : 'image/svg+xml; charset=utf-8', 'Cache-Control': 'public, max-age=300' })
      return res.end(art)
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
    // C-05/D-06：命中 ROUTE_MODULES 显式映射的路由统一跑模块强制校验（与路由内既有角色校验取交集，不放松）
    const rm = matchRouteModule(req.method, pathname)
    if (rm) await requireModule({ headers: req.headers, method: req.method, url: req.url }, rm.module)
    const data = await handler({ headers: req.headers, method: req.method, url: req.url, body, query, params, rawBody }, res)
    // handler 已自行写出响应（PDF / 文件流）：不能再套 JSON 信封
    if (res.writableEnded || res.headersSent) return
    if (pathname === '/callback/wxpay') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify(data))
    }
    json(res, 0, data)
  } catch (e) {
    if (pathname === '/callback/wxpay') {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      return res.end(JSON.stringify({ code: 'FAIL', message: '支付通知校验失败' }))
    }
    // P-08：业务错误（BizError）code 是数字；MySQL 驱动错误的 code 是 'ER_*' 字符串——
    // 若只判 truthy 会把 SQL 细节当业务消息回显，必须收紧为整数 code 才走业务分支
    if (e && e.code && Number.isInteger(e.code)) return json(res, e.code, { message: e.message, fieldErrors: e.data && e.data.fieldErrors })
    // P-08：非业务异常（SQL/网络等）不得把内部细节回显给客户端——完整堆栈只进服务端日志，
    // 客户端拿到中文可理解的信息 + 追踪号，可凭追踪号在服务端日志定位同一条记录
    const traceId = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    console.error('[err]', traceId, req.method, pathname, e)
    json(res, 9000, { message: '系统错误，请稍后重试；如持续出现请联系管理员并提供追踪号 ' + traceId }, 500)
  }
})

bootstrap().then(async () => {
  // 服务监听所有网卡（listen 未绑定具体地址）；启动日志列出真实局域网地址，避免只印 127.0.0.1 造成"定死本机"的误解
  server.listen(PORT, async () => {
    const os = await import('node:os')
    const lan = Object.values(os.networkInterfaces()).flat()
      .filter((i) => i && i.family === 'IPv4' && !i.internal)
      .map((i) => i.address)
    for (const h of ['127.0.0.1', ...lan]) console.log(`[wanderlust-api] http://${h}:${PORT}  管理后台: http://${h}:${PORT}/admin-ui  支付通道: ${isLive() ? '微信支付V3(生产)' : 'MOCK(联调)'}`)
    // 定时任务（存证打包/锚定/确认、关单、结算…）：JOBS_IN_API=1 时随 API 一起跑
    // 这台机器注册独立计划任务需要管理员权限，借 API 的看护任务把调度带上；多实例靠 MySQL 咨询锁互斥
    if (String(process.env.JOBS_IN_API || '') === '1') {
      import('./jobs.mjs').then((m) => m.startInApi()).catch((e) => console.error('[jobs] 启动失败', e.message))
    }
  })
}).catch((e) => { console.error('[boot failed]', e.message); process.exit(1) })
