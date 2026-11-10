import { q, one, tx, BizError } from '../db.mjs'
import { requireUser, jwtSign } from '../auth.mjs'
import { requireAdmin, audit } from './_shared.mjs'
import { bookingNow, validDeadline } from '../domain/booking-window.mjs'

const positive = v => { const n = Number(v); if (!Number.isSafeInteger(n) || n < 1) throw new BizError(1001, '编号无效'); return n }
const sources = { merchant: 'merchant', supplier: 'supplier', cocreator: 'co_creator' }
async function activeUser(req, end) {
  const u = requireUser(req)
  if (u.end !== end) throw new BizError(1003, '请使用对应小程序身份')
  const row = await one('SELECT status FROM user_account WHERE id=?', [u.uid])
  if (!row || Number(row.status) !== 1) throw new BizError(1003, '账号不可用')
  return u
}
export async function subjectContexts(uid) {
  const now = bookingNow()
  return q(`SELECT b.id,b.name,g.valid_to FROM subject_grant g JOIN business_subject b ON b.id=g.subject_id
    WHERE g.user_id=? AND g.status=1 AND b.status=1 AND g.valid_from<=? AND (g.valid_to IS NULL OR g.valid_to>?) ORDER BY b.id`, [uid, now, now])
}
export const workAccess = {
  'GET /admin/work-access': async req => {
    await requireAdmin(req, ['super'])
    return { subjects: await q('SELECT id,name,status FROM business_subject ORDER BY id DESC LIMIT 200'),
      catalog: (await Promise.all(Object.entries(sources).map(async ([kind, table]) => (await q(`SELECT id,name FROM ${table} ORDER BY id DESC LIMIT 500`)).map(r => ({ ...r, kind }))))).flat(),
      staff: await q(`SELECT s.merchant_id,s.user_id,s.role,s.status,u.nickname FROM merchant_staff s JOIN user_account u ON u.id=s.user_id ORDER BY s.id DESC LIMIT 500`),
      resources: await q('SELECT subject_id,kind,resource_id FROM subject_resource ORDER BY subject_id LIMIT 1000'),
      grants: await q(`SELECT g.id,g.subject_id,g.user_id,u.nickname,g.valid_from,g.valid_to,g.status FROM subject_grant g JOIN user_account u ON u.id=g.user_id ORDER BY g.id DESC LIMIT 500`) }
  },
  'POST /admin/work-access/subjects': async req => {
    const a = await requireAdmin(req, ['super']), name = String(req.body.name || '').trim()
    if (!name || name.length > 80) throw new BizError(1001, '主体名称应为1–80字')
    return tx(async c => { const id = await c.ins('INSERT INTO business_subject(name) VALUES(?)', [name]); await audit(c, 'admin:' + a.name, 'work-access', 'subject-create', 'subject-' + id, null, { name }); return { id } })
  },
  'POST /admin/work-access/resources': async req => {
    const a = await requireAdmin(req, ['super']), sid = positive(req.body.subjectId), rid = positive(req.body.resourceId), kind = String(req.body.kind)
    if (!Object.hasOwn(sources, kind)) throw new BizError(1001, '资源类型无效')
    const reason = String(req.body.reason || '').trim()
    if (reason.length < 4 || reason.length > 300) throw new BizError(1001, '请填写4–300字核对依据')
    return tx(async c => {
      if (!await c.one('SELECT id FROM business_subject WHERE id=? AND status=1 FOR UPDATE', [sid])) throw new BizError(1004, '主体不可用')
      if (!await c.one(`SELECT id FROM ${sources[kind]} WHERE id=?`, [rid])) throw new BizError(1004, '资源不存在')
      const old = await c.one('SELECT subject_id FROM subject_resource WHERE kind=? AND resource_id=?', [kind, rid])
      if (old && Number(old.subject_id) !== sid) throw new BizError(1001, '资源已属于其他主体，请先核对并解除原关联')
      if (req.body.remove === true) await c.q('DELETE FROM subject_resource WHERE subject_id=? AND kind=? AND resource_id=?', [sid, kind, rid])
      else await c.q('INSERT IGNORE INTO subject_resource(subject_id,kind,resource_id) VALUES(?,?,?)', [sid, kind, rid])
      await audit(c, 'admin:' + a.name, 'work-access', req.body.remove === true ? 'resource-unlink' : 'resource-link', 'subject-' + sid, old, { kind, resourceId: rid, reason })
      return { ok: true }
    })
  },
  'POST /admin/work-access/grants': async req => {
    const a = await requireAdmin(req, ['super']), sid = positive(req.body.subjectId), uid = positive(req.body.userId)
    const status = Number(req.body.status), from = req.body.validFrom || bookingNow(), to = req.body.validTo || null, reason = String(req.body.reason || '').trim()
    if (![0,1].includes(status) || !validDeadline(from) || (to && (!validDeadline(to) || to.replace('T',' ') <= from.replace('T',' '))) || reason.length < 4 || reason.length > 300) throw new BizError(1001, '状态、有效期或核对原因无效')
    return tx(async c => {
      if (!await c.one('SELECT id FROM business_subject WHERE id=? AND status=1 FOR UPDATE', [sid])) throw new BizError(1004, '主体不可用')
      if (!await c.one('SELECT id FROM user_account WHERE id=? AND status=1', [uid])) throw new BizError(1004, '用户不可用')
      const before = await c.one('SELECT * FROM subject_grant WHERE subject_id=? AND user_id=?', [sid, uid])
      await c.q(`INSERT INTO subject_grant(subject_id,user_id,valid_from,valid_to,status) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE valid_from=VALUES(valid_from),valid_to=VALUES(valid_to),status=VALUES(status)`, [sid, uid, from.replace('T',' '), to?.replace('T',' ') || null, status])
      await audit(c, 'admin:' + a.name, 'work-access', 'grant', 'subject-' + sid, before, { userId: uid, from, to, status, reason })
      return { ok: true }
    })
  },
  'POST /admin/work-access/staff': async req => {
    const a=await requireAdmin(req,['super']), mid=positive(req.body.merchantId),uid=positive(req.body.userId),role=Number(req.body.role),status=Number(req.body.status),reason=String(req.body.reason || '').trim()
    if(![1,2,3].includes(role) || ![0,1].includes(status) || reason.length<4 || reason.length>300)throw new BizError(1001,'岗位、状态或依据无效')
    return tx(async c=>{
      if(!await c.one('SELECT id FROM merchant WHERE id=? AND status=1 FOR UPDATE',[mid]))throw new BizError(1004,'门店不可用')
      if(!await c.one('SELECT id FROM user_account WHERE id=? AND status=1',[uid]))throw new BizError(1004,'用户不可用')
      const before=await c.one('SELECT role,status FROM merchant_staff WHERE merchant_id=? AND user_id=?',[mid,uid])
      await c.q('INSERT INTO merchant_staff(merchant_id,user_id,role,status) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE role=VALUES(role),status=VALUES(status)',[mid,uid,role,status])
      await audit(c,'admin:'+a.name,'work-access','staff-grant','merchant-'+mid,before,{userId:uid,role,status,reason})
      return {ok:true}
    })
  },
  'GET /c/work-contexts': async req => {
    const u = await activeUser(req, 'c'), subjects = await subjectContexts(u.uid), p = await one('SELECT status FROM promoter WHERE user_id=?', [u.uid])
    return { canPromote: Number(p?.status) === 1, subjects, canCooperate: subjects.length > 0 }
  },
  'GET /c/work-contexts/:id': async req => {
    const u = await activeUser(req, 'c'), sid = positive(req.params.id), subject = (await subjectContexts(u.uid)).find(s => Number(s.id) === sid)
    if (!subject) throw new BizError(1003, '合作主体未授权或授权已失效')
    const resources = []
    for (const [kind, table] of Object.entries(sources)) resources.push(...(await q(`SELECT r.resource_id id,t.name FROM subject_resource r JOIN ${table} t ON t.id=r.resource_id WHERE r.subject_id=? AND r.kind=? AND t.status=1`, [sid, kind])).map(r => ({ ...r, kind })))
    return { subject, resources, note: '项目和分润按当前主体授权查询；投资额登记不代表应返本金，登记付款不代表银行到账。' }
  },
  'GET /m/auth/stores': async req => {
    const u = await activeUser(req, 'm')
    return q(`SELECT m.id,m.name,m.merchant_no,s.role FROM merchant_staff s JOIN merchant m ON m.id=s.merchant_id WHERE s.user_id=? AND s.status=1 AND m.status=1 ORDER BY m.id`, [u.uid])
  },
  'POST /m/auth/switch': async req => {
    const u = await activeUser(req, 'm'), mid = positive(req.body.merchantId)
    const s = await one(`SELECT m.id,m.name,m.merchant_no,s.role FROM merchant_staff s JOIN merchant m ON m.id=s.merchant_id WHERE s.user_id=? AND m.id=? AND s.status=1 AND m.status=1`, [u.uid, mid])
    if (!s) throw new BizError(1003, '未获得该门店有效授权')
    return { token: jwtSign({ uid: u.uid, end: 'm', merchantId: mid, role: Number(s.role) }, 7*24*3600), merchant: { id: mid, name: s.name, merchant_no: s.merchant_no }, role: Number(s.role) }
  },
}
