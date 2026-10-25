// 三期 E2E：微信官方能力对照（手机号快速验证 / 推广小程序码 / 订阅消息模板 / 集成中心模板键）
// 前置：服务运行中。运行：node test/e2e-phase3.mjs（不破坏既有数据，仅追加）
const BASE = 'http://127.0.0.1:' + (process.env.PORT || 8080)
let pass = 0, fail = 0
const ok = (c, n) => { c ? (pass++, console.log('  PASS  ' + n)) : (fail++, console.log('  FAIL  ' + n)) }
async function api(method, path, body, token, expectFail) {
  const r = await fetch(BASE + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const j = await r.json()
  if (expectFail) return j
  if (j.code !== 0) throw new Error(`${method} ${path} -> ${j.code} ${j.msg}`)
  return j.data
}

async function main() {
  console.log('== A. 手机号快速验证组件（官方 open-type=getPhoneNumber）==')
  const u = (await api('POST', '/c/auth/login', { code: 'phase3-phone' }))
  const ph = await api('POST', '/c/auth/phone', { code: 'wx-mock-code' }, u.token)
  ok(/^1\d{2}\*\*\*\*\d{4}$/.test(ph.phone), '手机号换号成功并脱敏返回（' + ph.phone + '）')
  const dbx = await import('../src/db.mjs')
  const row = await dbx.one('SELECT mobile_enc FROM user_account WHERE id = ?', [u.user.id])
  ok(row && /^1\d{10}$/.test(Buffer.from(row.mobile_enc).toString()), '手机号已加密落库 user_account.mobile_enc')

  console.log('== B. 推广小程序码（官方 getUnlimitedQRCode）==')
  const admin = (await api('POST', '/admin/login', { username: 'admin', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' })).token
  const p = (await api('POST', '/c/auth/login', { code: 'phase3-promo' }))
  await api('POST', '/admin/promoters/register', { userId: p.user.id, tier: 2 }, admin)
  const qr = await api('GET', '/c/promote/qrcode', null, p.token)
  ok(qr.scene && qr.scene.startsWith('p'), '推广 scene 生成（' + qr.scene + '）')
  ok(qr.mock === true && qr.image === null, '未配置凭据 → MOCK 语义（不中断，提示配置）')
  ok((await api('GET', '/c/promote/qrcode', null, u.token, true)).code === 6001, '非推广服务商请求推广码被拒（6001）')

  console.log('== C. 商户门店码 ==')
  const m = (await api('POST', '/m/auth/login', { code: 'phase3-merchant', merchantId: 1 }))
  const mq = await api('GET', '/m/qrcode', null, m.token)
  ok(mq.scene === 'm' + Number(1).toString(36), '门店码 scene 与商户 ID 绑定（' + mq.scene + '）')

  console.log('== D. 订阅消息 ==')
  const t = await api('GET', '/c/notify/templates', null, u.token)
  ok('payOk' in t, '模板接口返回（未配置=payOk:null，前端跳过 requestSubscribeMessage）')
  const integ = await api('GET', '/admin/integrations', null, admin)
  const tmpl = integ.channels.find((c) => c.name === '订阅消息模板')
  ok(tmpl && tmpl.fields[0].key === 'WX_TMPL_PAY_OK', '集成中心已含订阅消息模板通道（后台可配 WX_TMPL_PAY_OK）')
  const saved = await api('POST', '/admin/integrations/WX_TMPL_PAY_OK', { value: 'TMPL-TEST-0001' }, admin)
  ok(saved.saved === true, '模板 ID 可后台保存（加密落库）')
  const t2 = await api('GET', '/c/notify/templates', null, u.token)
  ok(t2.payOk === 'TMPL-TEST-0001', '保存后 10 秒内热生效（payOk=' + t2.payOk + '）')
  await api('DELETE', '/admin/integrations/WX_TMPL_PAY_OK', null, admin)
  const t3 = await api('GET', '/c/notify/templates', null, u.token)
  ok(t3.payOk === null, '清除后回退未配置态')

  console.log('== E. 头像昵称填写能力（官方组件配套接口）==')
  const prof = await api('POST', '/c/me/profile', { nickname: '青浦旅友·小赵' }, u.token)
  ok(prof.nickname === '青浦旅友·小赵' && prof.secMock === true, '昵称更新并过机审（MOCK 直通）')
  const badNick = await api('POST', '/c/me/profile', { nickname: 'x' }, u.token, true)
  ok(badNick.code === 1001, '过短昵称被拒（1001）')
  const up = await api('POST', '/c/upload/avatar', { data: Buffer.from('PNGDATA-TEST').toString('base64'), ext: 'png' }, u.token)
  ok(/^\/uploads\/avatar_\d+\.png$/.test(up.url), '头像上传返回 /uploads 地址（' + up.url + '）')
  const img = await fetch(BASE + up.url)
  ok(img.status === 200 && (img.headers.get('content-type') || '').includes('image/png'), '头像静态可访问（image/png）')
  const badUp = await api('POST', '/c/upload/avatar', { data: 'AAAA', ext: 'exe' }, u.token, true)
  ok(badUp.code === 1001, '非白名单扩展名被拒（1001）')
  const prof2 = await api('POST', '/c/me/profile', { avatarUrl: up.url }, u.token)
  ok(prof2.avatarUrl === up.url, '头像地址落库（白名单校验通过）')

  console.log('== F. 小程序数据分析（官方 getDailyVisitTrend）==')
  const trend = await api('GET', '/admin/wxdata/visit-trend', null, admin)
  ok(trend.list.length === 7 && trend.list[0].date && trend.list[0].visitPv > 0, '7 日访问趋势可用（' + (trend.mock ? 'MOCK' : '真实') + '）')
  const trendCity = await api('GET', '/admin/wxdata/visit-trend', null, (await api('POST', '/admin/login', { username: 'city310118', password: process.env.CITY_PARTNER_PASSWORD || 'city123' })).token)
  ok(trendCity.list.length === 7, '城市合伙人也可查看（scope 内）')

  console.log('== G. 商户确认结算（§10 商户端能力）==')
  await dbx.q('UPDATE settlement SET status = 0 WHERE merchant_id = 1 ORDER BY id DESC LIMIT 1')
  const sId = (await dbx.one('SELECT id FROM settlement WHERE merchant_id = 1 ORDER BY id DESC LIMIT 1')).id
  const cf = await api('POST', '/m/settlements/' + sId + '/confirm', {}, m.token)
  ok(cf.confirmed === true, '商户确认结算单 #' + sId + '（0 待确认 → 1 已确认）')
  const cf2 = await api('POST', '/m/settlements/' + sId + '/confirm', {}, m.token, true)
  ok(cf2.code === 1001, '重复确认被拒（1001，状态机守卫）')

  console.log('\n结果: ' + pass + ' PASS, ' + fail + ' FAIL')
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error('FATAL', e); process.exit(1) })
