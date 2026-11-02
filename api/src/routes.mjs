// 路由层入口：按领域拆分在 src/routes/ 下。
// 注意：下面展开的顺序决定路由匹配顺序（index.mjs 按插入顺序取第一个匹配），不要随意调整。
import { one, BizError } from './db.mjs'
import { requireUser } from './auth.mjs'
import { handlePayNotify } from './routes/_shared.mjs'
import { c, cWithdraw, lexicon, cPromo, cNotes, cPhraseKyc, cIdentity } from './routes/tourist.mjs'
import { m, mSite, mPhrase, mApply } from './routes/merchant.mjs'
import { admin } from './routes/admin.mjs'
import { adminSys, adminEco, adminEdit, adminNew, adminFin } from './routes/admin-ops.mjs'
import { integrations } from './routes/integrations.mjs'
import { web3 } from './routes/web3.mjs'
import { open } from './routes/open.mjs'
import { callback } from './routes/callback.mjs'

export const routes = { ...c, ...m, ...admin, ...adminSys, ...adminEco, ...adminFin, ...cWithdraw, ...cPromo, ...integrations, ...web3, ...open, ...lexicon, ...cIdentity, ...cNotes, ...mApply, ...cPhraseKyc, ...mPhrase, ...mSite, ...adminNew, ...adminEdit, ...callback }
for (const [key, handler] of Object.entries(routes)) {
  if (key.includes('/admin/dev/')) routes[key] = (req, res) => {
    if (process.env.NODE_ENV === 'production') throw new BizError(1003, '生产环境禁用联调操作')
    return handler(req, res)
  }
}
// 商户权限在每次请求重新校验，停用员工及变更角色立即生效，禁止跨端 JWT 复用。
for (const [key, handler] of Object.entries(routes)) {
  if (!key.split(' ')[1]?.startsWith('/m/') || key === 'POST /m/auth/login') continue
  // 注意：必须把 res 透传给原 handler —— 否则 /m/ 下的 PDF/文件类响应拿不到 res（曾踩坑：500 writeHead）
  routes[key] = async (req, res) => {
    const u = requireUser(req)
    if (u.end !== 'm') throw new BizError(1003, '请使用商户账号登录')
    if (!['POST /m/auth/join', 'POST /m/apply', 'POST /m/auth/phone-login', 'GET /m/applications', 'GET /m/site'].includes(key)) {
      const staff = await one(`SELECT s.role FROM merchant_staff s JOIN merchant m ON m.id = s.merchant_id
        WHERE s.user_id = ? AND s.merchant_id = ? AND s.status = 1 AND m.status = 1`, [u.uid, u.merchantId])
      if (!staff) throw new BizError(1003, '尚未加入门店或账号已停用')
      if (Number(staff.role) !== Number(u.role)) throw new BizError(1002, '角色已变更，请重新登录')
      const manager = /\/settlements|\/supply|\/invite|\/stats|\/orders/.test(key)
      if (manager && staff.role < 2) throw new BizError(1003, '需要店长及以上权限')
      if (key === 'POST /m/supply/:sid' && req.body.action === 'price' && staff.role < 3) throw new BizError(1003, '仅老板可调整价格')
    }
    return handler(req, res)
  }
}
export { handlePayNotify }

