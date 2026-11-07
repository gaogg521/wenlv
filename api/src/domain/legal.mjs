import { one, q, BizError } from '../db.mjs'
import { cfg } from '../config.mjs'
import { readValues } from './entity-schema.mjs'

export async function legalVersions() {
  const value = async key => { try { return await cfg('legal.' + key + '_version') || '2026.11' } catch { return '2026.11' } }
  return { privacy: await value('privacy'), terms: await value('terms') }
}
export async function legalDocuments() {
  const row = await one('SELECT * FROM site_config WHERE id=1')
  const v = row ? readValues('site', row) : {}
  const present = x => String(x || '').replace(/<[^>]*>|&nbsp;|\s/g, '').length > 0
  return { privacy: present(v.privacy_policy), terms: present(v.user_agreement) }
}
export async function requireProductionLegal(userId) {
  if (process.env.NODE_ENV !== 'production') return
  const docs = await legalDocuments()
  if (!docs.privacy || !docs.terms) throw new BizError(1001, '服务协议尚未发布，暂不可下单')
  const versions = await legalVersions()
  const rows = await q("SELECT scene,granted,version FROM user_privacy_consent WHERE user_id=? AND scene IN ('privacy','terms')", [userId])
  for (const scene of ['privacy', 'terms']) if (!rows.some(r => r.scene === scene && Number(r.granted) === 1 && r.version === versions[scene])) throw new BizError(1001, '协议已更新，请重新阅读并同意后下单')
}
