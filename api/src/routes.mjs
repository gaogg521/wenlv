// 路由层入口：按领域拆分在 src/routes/ 下。
// 注意：下面展开的顺序决定路由匹配顺序（index.mjs 按插入顺序取第一个匹配），不要随意调整。
import { one, BizError } from './db.mjs'
import { requireUser } from './auth.mjs'
import { staffRoleOf } from './infra/staff-role.mjs'
import { handlePayNotify } from './routes/_shared.mjs'
import { c, cWithdraw, lexicon, cPromo, cNotes, cPhraseKyc, cIdentity } from './routes/tourist.mjs'
import { m, mSite, mPhrase, mApply, mPkg } from './routes/merchant.mjs'
import { admin } from './routes/admin.mjs'
import { adminSys, adminEco, adminEdit, adminNew, adminFin } from './routes/admin-ops.mjs'
import { adminAccounts } from './routes/admin-accounts.mjs'
import { adminTickets } from './routes/admin-tickets.mjs'
import { adminUserOps } from './routes/admin-userops.mjs'
import { adminRiskCases } from './routes/admin-riskcases.mjs'
import { scenicFollowupRoutes } from './routes/scenic-followup.mjs'
import { scenicCalculatorRoutes } from './routes/scenic-calculator.mjs'
import { partnerDash } from './routes/partner-dash.mjs'
import { fundWorkbenchAgg } from './routes/admin-ops.mjs'
import { adminReviewQueue } from './routes/admin-reviewqueue.mjs'
import { integrations } from './routes/integrations.mjs'
import { web3 } from './routes/web3.mjs'
import { open } from './routes/open.mjs'
import { callback } from './routes/callback.mjs'
import { people } from './routes/people.mjs'
import { contentGovernance } from './routes/content-governance.mjs'
import { noteCommentRoutes } from './routes/note-comments.mjs'
import { workAccess } from './routes/work-access.mjs'
import { salesRoutes } from './routes/sales.mjs'
import { freedomRoutes } from './routes/freedom.mjs'
import { promoAdminRoutes } from './routes/promo-admin.mjs'
import { supplyAdminRoutes } from './routes/supply-admin.mjs'
import { pkgAdminRoutes } from './routes/pkg-admin.mjs'
import { routes as subjectApprovalRoutes } from './routes/subject-approval.mjs'


export const routes = { ...workAccess, ...c, ...m, ...mPkg, ...admin, ...people, ...contentGovernance, ...adminSys, ...adminEco, ...adminFin, ...adminAccounts, ...adminTickets, ...adminUserOps, ...adminRiskCases, ...fundWorkbenchAgg, ...adminReviewQueue, ...cWithdraw, ...cPromo, ...integrations, ...web3, ...open, ...lexicon, ...cIdentity, ...cNotes, ...mApply, ...cPhraseKyc, ...mPhrase, ...mSite, ...adminNew, ...adminEdit, ...callback, ...salesRoutes, ...freedomRoutes, ...promoAdminRoutes, ...supplyAdminRoutes, ...pkgAdminRoutes, ...scenicCalculatorRoutes, ...scenicFollowupRoutes, ...partnerDash, ...noteCommentRoutes, ...subjectApprovalRoutes }

for (const [key, handler] of Object.entries(routes)) {
  if (key.includes('/admin/dev/')) routes[key] = (req, res) => {
    if (process.env.NODE_ENV === 'production') throw new BizError(1003, '生产环境禁用联调操作')
    return handler(req, res)
  }
}
// 游客账号被后台冻结后立即失效：每个 /c 请求复核账号状态（已登录的会话也会被拒）。
// A-17：同时拒绝跨端令牌——/c/* 只接受 end==='c' 的 JWT（商户/后台/mfa challenge 令牌一律 1003）
for (const [key, handler] of Object.entries(routes)) {
  if (!key.split(' ')[1]?.startsWith('/c/') || key === 'POST /c/auth/login') continue
  routes[key] = async (req, res) => {
    let u = null
    try { u = requireUser(req) } catch { /* 未登录的由原 handler 自行处理 */ }
    if (u) {
      if (u.end !== 'c') throw new BizError(1003, '请使用游客账号访问')
      const r = await one('SELECT status FROM user_account WHERE id = ?', [u.uid])
      if (r && Number(r.status) === 0) throw new BizError(1003, '账号已被停用，请联系客服')
    }
    return handler(req, res)
  }
}
// 商户权限在每次请求重新校验，停用员工及变更角色立即生效，禁止跨端 JWT 复用。
// A-17：复核账号本体状态——账号被冻结后，商户令牌也立即失效（此前只查 staff/merchant）。
// M-01：role 以 merchant_staff 当前库值为准（短缓存 30s + 员工管理写入即失效），
// 同一 token 改岗/停用后立即按新角色行事——不再踢下线（此前 1002「角色已变更」），
// 负责人 2026-11-19 指令：老板与店长都能改价（撤销旧「仅老板可调价」闸，核销员仍被 manager 门槛拒）。
// 注意：/m/apply、/m/applications、/m/auth/phone-login 是游客端（c 令牌）可用的入驻流程，
// 端校验只对门店业务路由生效——此前 c 令牌调 /m/apply 一律被"请使用商户账号登录"挡死，入驻自助化名存实亡。
const M_C_END_ROUTES = new Set(['POST /m/auth/join', 'POST /m/apply', 'POST /m/auth/phone-login', 'GET /m/applications', 'GET /m/site'])
for (const [key, handler] of Object.entries(routes)) {
  if (!key.split(' ')[1]?.startsWith('/m/') || key === 'POST /m/auth/login') continue
  // 注意：必须把 res 透传给原 handler —— 否则 /m/ 下的 PDF/文件类响应拿不到 res（曾踩坑：500 writeHead）
  routes[key] = async (req, res) => {
    const u = requireUser(req)
    const ua = await one('SELECT status FROM user_account WHERE id = ?', [u.uid])
    if (!ua || Number(ua.status) === 0) throw new BizError(1003, '账号已被停用，请联系平台')
    if (key === 'GET /m/auth/stores' || key === 'POST /m/auth/switch') return handler(req, res)
    if (!M_C_END_ROUTES.has(key)) {
      if (u.end !== 'm') throw new BizError(1003, '请使用商户账号登录')
      const staff = await staffRoleOf(u.uid, u.merchantId)
      if (!staff.status) throw new BizError(1003, '尚未加入门店或账号已停用')
      u.role = staff.role // 以库为准：后续 handler 内的 role 门槛全部按实时角色判定
      const manager = /\/settlements|\/supply|\/invite|\/stats|\/orders/.test(key)
      if (manager && staff.role < 2) throw new BizError(1003, '需要店长及以上权限')
    }
    return handler(req, res)
  }
}
export { handlePayNotify }

