import crypto from 'node:crypto'
import { one, q, BizError } from '../db.mjs'
import { bookingNow } from './booking-window.mjs'

export const json = v => typeof v === 'string' ? JSON.parse(v) : (v || {})
export const id = v => { const n=Number(v); if(!Number.isSafeInteger(n)||n<1)throw new BizError(1001,'编号无效');return n }
export function paging(query) {
  const page=Number(query.page || 1),pageSize=Number(query.pageSize || 20)
  if(!Number.isSafeInteger(page)||page<1||page>100000||!Number.isSafeInteger(pageSize)||pageSize<1||pageSize>100)throw new BizError(1001,'分页参数无效')
  return {page,pageSize,offset:(page-1)*pageSize}
}
export async function promoter(uid, c={one}) {
  const p=await c.one('SELECT p.user_id,p.rate_bp,p.status,u.status user_status FROM promoter p JOIN user_account u ON u.id=p.user_id WHERE p.user_id=?'+(c.upd?' FOR UPDATE':''),[uid])
  if(p && Number(p.user_status)!==1)throw new BizError(6001,'账号已冻结，暂停取码和资金操作')
  if(!p || Number(p.status)!==1 || Number(p.user_status)!==1)throw new BizError(6001,'推广资格未生效或已暂停')
  return p
}
export async function effectiveRate(uid,pid,at=bookingNow(),c={one}) {
  const p=await c.one('SELECT rate_bp,status FROM promoter WHERE user_id=?',[uid])
  if(!p||Number(p.status)!==1)return null
  const grant=await c.one('SELECT * FROM promoter_product WHERE promoter_id=? AND product_id=?',[uid,pid])
  // 有逐人授权记录的产品按此记录控制；无记录的旧通用归因继续按原规则。
  if(grant && (Number(grant.status)!==1 || at<grant.valid_from || at>=grant.valid_to))return null
  const prod=await c.one('SELECT promo_rate_bp,profile FROM tour_product WHERE id=?',[pid])
  const pf=json(prod?.profile),day=at.slice(0,10),window=(!pf.rate_start||day>=pf.rate_start)&&(!pf.rate_end||day<=pf.rate_end)
  return {rateBp:Math.max(0,Math.min(1200,Number(grant?.rate_bp ?? (window ? prod?.promo_rate_bp : null) ?? p.rate_bp))),grantId:grant?.id || null,source:grant?.rate_bp!=null?'person_product':window&&prod?.promo_rate_bp!=null?'product':'tier'}
}
export async function authorizedProduct(uid,pid,c={one}) {
  await promoter(uid,c)
  const now=bookingNow(),g=await c.one(`SELECT g.*,p.title,p.status product_status FROM promoter_product g JOIN tour_product p ON p.id=g.product_id JOIN merchant m ON m.id=p.merchant_id
    WHERE g.promoter_id=? AND g.product_id=? AND g.status=1 AND g.valid_from<=? AND g.valid_to>? AND p.status=1 AND m.status=1`,[uid,pid,now,now])
  if(!g)throw new BizError(6001,'该产品未授权、已停售或授权已到期')
  return g
}
export async function source(scene,pid,c={one}) {
  if(!scene)return null
  if(/^m[0-9a-z]+$/i.test(String(scene))){const mid=parseInt(String(scene).slice(1),36);if(!await c.one('SELECT id FROM merchant WHERE id=? AND status=1',[mid]))throw new BizError(1001,'门店来源已失效');return {merchantId:mid,scene}}
  const a=await c.one('SELECT promoter_id,product_id,scene FROM attribution WHERE scene=?',[String(scene)])
  if(!a)throw new BizError(1001,'推广来源无效，请从产品页重新进入')
  if(a.product_id){
    if(Number(a.product_id)!==Number(pid))throw new BizError(1001,'推广码与产品不匹配')
    await authorizedProduct(a.promoter_id,pid,c)
  }
  return a
}
export async function orderSnapshot(c,uid,pid,scene) {
  const a=await source(scene,pid,c)
  if(!a||a.merchantId)return null
  // 锁用户串行化首触录入，顺序即真实首次有效到访顺序。
  await c.one('SELECT id FROM user_account WHERE id=? FOR UPDATE',[uid])
  await c.q('INSERT IGNORE INTO attribution_hit(scene,user_id) VALUES(?,?)',[a.scene,uid])
  const first=await c.one(`SELECT a.promoter_id FROM attribution_hit h JOIN attribution a ON a.scene=h.scene WHERE h.user_id=? ORDER BY h.id LIMIT 1`,[uid])
  const rate=Number(first?.promoter_id)===Number(uid)?null:await effectiveRate(first?.promoter_id,pid,bookingNow(),c)
  return {version:1,promoterId:first?.promoter_id || null,eligible:!!rate,...(rate||{}),at:bookingNow(),sourceScene:a.scene}
}
export async function productScene(uid,pid,channel='mini') {
  await authorizedProduct(uid,pid)
  if(!/^[a-z0-9_-]{1,24}$/i.test(channel))throw new BizError(1001,'渠道无效')
  const old=await one('SELECT scene FROM attribution WHERE promoter_id=? AND product_id=? AND channel=? ORDER BY id DESC LIMIT 1',[uid,pid,channel])
  if(old)return old.scene
  const scene='p'+crypto.randomBytes(12).toString('hex')
  await q('INSERT INTO attribution(promoter_id,product_id,channel,scene) VALUES(?,?,?,?)',[uid,pid,channel,scene])
  return scene
}
