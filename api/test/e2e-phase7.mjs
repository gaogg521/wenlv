// 七期 E2E：资源池（V22）—— 景区/供应商台账、商户类目、商品关联资源、城市合伙人隔离与越权
// 前置：服务运行中 + V22 迁移已应用。运行：node test/e2e-phase7.mjs（自建夹具，跑完清理）
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/e2e-phase7.mjs') // 会写库：只能对隔离库运行
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
  const dbx = await import('../src/db.mjs')
  const { q, one } = dbx
  const admin = (await api('POST', '/admin/login', { username: 'admin', password: process.env.ADMIN_INIT_PASSWORD || 'admin123' })).token
  const partner = (await api('POST', '/admin/login', { username: 'city310118', password: 'city123' })).token

  // ---- 景区资源 ----
  const sc = await api('POST', '/admin/scenics', { name: 'E2E七期·淀山湖水上乐园', cityCode: '310118', level: '4A',
    coopMode: '票务分成', contactName: '测试对接人', contactPhone: '13800000001', profitTerms: '门票8折月结' }, admin)
  ok(Number(sc.id) > 0, '景区创建返回 id')
  let scList = await api('GET', '/admin/scenics', null, admin)
  ok(scList.some((x) => x.id === sc.id && x.scenic_level === '4A' && x.coop_mode === '票务分成'), '景区列表含新景区且字段正确')
  await api('PUT', '/admin/scenics/' + sc.id, { status: 0, profitTerms: '门票7折季结' }, admin)
  scList = await api('GET', '/admin/scenics', null, admin)
  const scRow = scList.find((x) => x.id === sc.id)
  ok(scRow.status === 0 && scRow.profit_terms === '门票7折季结', '景区部分更新（状态+条款）生效')

  // ---- 供应商 ----
  const sup = await api('POST', '/admin/suppliers', { name: 'E2E七期·青浦旅游车队', cityCode: '310118', category: 'transport',
    settleMode: 'per_order', contactName: '车队王师傅', contactPhone: '13900000002', licenseNo: '沪B2E2E7' }, admin)
  ok(Number(sup.id) > 0, '供应商创建返回 id')
  await api('POST', '/admin/suppliers', { name: 'E2E七期·非法类目兜底', cityCode: '310118', category: 'rocket' }, admin)
  const supAll = await api('GET', '/admin/suppliers', null, admin)
  ok(supAll.find((x) => x.name === 'E2E七期·青浦旅游车队')?.category === 'transport', '供应商列表含新供应商且类目正确')
  ok(supAll.find((x) => x.name === 'E2E七期·非法类目兜底')?.category === 'other', '非法类目兜底为 other')
  await api('PUT', '/admin/suppliers/' + sup.id, { status: 2 }, admin)
  ok((await api('GET', '/admin/suppliers', null, admin)).find((x) => x.id === sup.id).status === 2, '供应商状态可更新为清退')

  // ---- 商户类目 ----
  const m = await api('POST', '/admin/merchants', { name: 'E2E七期·类目商户', cityCode: '310118', kind: 'hotel' }, admin)
  ok((await api('GET', '/admin/merchants', null, admin)).find((x) => x.id === m.id)?.kind === 'hotel', '商户创建带类目')
  await api('POST', '/admin/merchants/' + m.id, { name: 'E2E七期·类目商户', cityCode: '310118', kind: 'ticket' }, admin)
  ok((await api('GET', '/admin/merchants', null, admin)).find((x) => x.id === m.id)?.kind === 'ticket', '商户类目可更新')

  // ---- 商品关联资源 ----
  const mActive = await one('SELECT id FROM merchant WHERE status = 1 ORDER BY id LIMIT 1')
  const p = await api('POST', '/admin/products', { title: 'E2E七期·资源关联线路', cat: 'family', priceFrom: 9900,
    merchantId: mActive.id, supplierId: sup.id, scenicId: sc.id, status: 0 }, admin)
  const pRow = (await api('GET', '/admin/products', null, admin)).find((x) => x.id === p.id)
  ok(pRow.supplier_name === 'E2E七期·青浦旅游车队' && (pRow.scenic_name || '').includes('淀山湖'), '商品关联供应商与景区（JOIN 名称回显）')
  const badLink = await api('POST', '/admin/products', { title: '坏资源引用', cat: 'family', priceFrom: 100, merchantId: mActive.id, scenicId: 999999 }, admin, true)
  ok(badLink.code !== 0, '商品关联不存在的景区被拒')

  // ---- 越权与隔离（城市合伙人 city310118）----
  const forbidCreate = await api('POST', '/admin/scenics', { name: '越权尝试·合伙人建景区' }, partner, true)
  ok(forbidCreate.code !== 0, '城市合伙人创建景区被拒（仅 super）')
  const sz = await api('POST', '/admin/scenics', { name: 'E2E七期·姑苏园林', cityCode: '320508' }, admin)
  const pList = await api('GET', '/admin/scenics', null, partner)
  ok(!pList.some((x) => x.id === sz.id), '城市合伙人看不到其他城市的景区')
  ok(pList.every((x) => x.city_code === '310118'), '城市合伙人景区列表全部为本城（行级隔离）')

  // ---- 创作者池（V23）----
  const crList = await api('GET', '/admin/creators', null, admin)
  const aKai = crList.find((x) => x.nickname === '江南拍客阿凯')
  ok(!!aKai && aKai.creator_tag === 'signed' && aKai.published_count >= 2 && aKai.task_done >= 1, '创作者池含签约创作者且产出聚合正确')
  const momo = crList.find((x) => x.nickname === 'momo酱在路上')
  ok(!!momo && momo.creator_tag === 'none', '无标签但有内容的用户自动入池')
  await api('PUT', '/admin/creators/' + momo.id + '/tag', { tag: 'signed' }, admin)
  ok((await api('GET', '/admin/creators', null, admin)).find((x) => x.id === momo.id)?.creator_tag === 'signed', '创作者标签可更新')
  const badTag = await api('PUT', '/admin/creators/' + momo.id + '/tag', { tag: 'vip' }, admin, true)
  ok(badTag.code !== 0, '非法标签被拒')
  const forbidTag = await api('PUT', '/admin/creators/1/tag', { tag: 'star' }, partner, true)
  ok(forbidTag.code !== 0, '城市合伙人改标签被拒（super/ops）')
  await api('PUT', '/admin/creators/' + momo.id + '/tag', { tag: 'none' }, admin)

  // ---- 富表单（V24）：约稿任务全字段 / FAQ 分类 / 轮播投放窗 ----
  const richTask = await api('POST', '/admin/content-tasks', { title: 'E2E七期·富任务', brief: '六十秒秋日短视频',
    category: 'video', richBrief: '<h2>脚本</h2><p>开场空镜<svg onload=alert(1)></svg></p>',
    rewardBeans: 500, cashReward: 5000, minWords: 100, minImages: 3, maxParticipants: 8,
    deadline: '2026-12-31', productId: mActive.id, tags: '秋日,e2e' }, admin)
  const rtRow = (await api('GET', '/admin/content-tasks', null, admin)).find((x) => x.id === richTask.id)
  ok(rtRow.category === 'video' && rtRow.cash_reward === 5000 && rtRow.min_words === 100 && rtRow.max_participants === 8 && rtRow.deadline?.startsWith('2026-12-31'), '任务富字段全量落库（类型/现金/要求/截止）')
  ok(!rtRow.rich_brief.includes('svg') && rtRow.rich_brief.includes('脚本'), '富文本已清洗（去脚本标签留正文）')
  await api('PUT', '/admin/content-tasks/' + richTask.id, { rewardBeans: 600, minImages: 5 }, admin)
  ok((await api('GET', '/admin/content-tasks', null, admin)).find((x) => x.id === richTask.id)?.min_images === 5, '任务富编辑（PUT 部分更新）')
  const badTaskLink = await api('POST', '/admin/content-tasks', { title: '坏商品引用', brief: 'x', productId: 999999 }, admin, true)
  ok(badTaskLink.code !== 0, '任务关联不存在商品被拒')
  const hotFaq = await api('POST', '/admin/faqs', { question: 'E2E七期·测试问题', answer: '测试答案', category: '旅豆', isHot: 1, sort: 99 }, admin)
  const faqRow = (await api('GET', '/admin/faqs', null, admin)).find((x) => x.id === hotFaq.id)
  ok(faqRow.category === '旅豆' && Number(faqRow.is_hot) === 1, 'FAQ 分类与热门标记落库')
  await api('POST', '/admin/faqs/' + hotFaq.id + '/update', { isHot: 0 }, admin)
  ok(Number((await api('GET', '/admin/faqs', null, admin)).find((x) => x.id === hotFaq.id)?.is_hot) === 0, 'FAQ 热门可更新')
  const bn = await api('POST', '/admin/banners', { title: 'E2E七期·轮播', subTitle: '角标', image: '/uploads/prod_1_1793416508790.png',
    link: '/c/tours/1', sort: 50, startAt: '2026-11-01', endAt: '2026-12-31' }, admin)
  const bnRow = (await api('GET', '/admin/banners', null, admin)).find((x) => x.id === bn.id)
  ok(bnRow.sub_title === '角标' && bnRow.start_at?.startsWith('2026-11-01') && bnRow.end_at?.startsWith('2026-12-31'), '轮播副标题与投放窗口落库')

  // ---- 清理夹具 ----
  await q('DELETE FROM tour_product WHERE title LIKE ?', ['E2E七期%'])
  await q('DELETE FROM content_task WHERE title LIKE ?', ['E2E七期%'])
  await q('DELETE FROM faq WHERE question LIKE ?', ['E2E七期%'])
  await q('DELETE FROM banner WHERE title LIKE ?', ['E2E七期%'])
  await q('DELETE FROM scenic_spot WHERE name LIKE ?', ['E2E七期%'])
  await q('DELETE FROM supplier WHERE name LIKE ?', ['E2E七期%'])
  await q('DELETE FROM merchant WHERE name LIKE ?', ['E2E七期%'])

  console.log(`\n结果: ${pass} PASS / ${fail} FAIL`)
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error('E2E 失败:', e.message); process.exit(1) })
