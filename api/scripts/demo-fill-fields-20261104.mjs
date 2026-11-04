// 演示数据字段补满（第二轮）：所有实体把可填字段填满，占位图生成 SVG 文件让图片位有内容。
// 守卫同 demo-seed：只允许演示库 + 显式放行。只 UPDATE 演示 created/既有实体的资料字段，不动账务数字。
import mysql from 'mysql2/promise'
import fs from 'node:fs'
import path from 'node:path'

if (process.env.ALLOW_DEMO_SEED !== '1' || process.env.DB_NAME !== 'wanderlust') {
  console.error('拒绝运行：需要 ALLOW_DEMO_SEED=1 且 DB_NAME=wanderlust')
  process.exit(1)
}
const c = await mysql.createConnection({ host: '127.0.0.1', port: 3306, user: 'root', password: 'root', database: 'wanderlust' })
const q = async (sql, a = []) => (await c.query(sql, a))[0]
const ri = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min
const pick = (arr, i) => arr[(i || 0) % arr.length]

// ---------- 占位 SVG 生成 ----------
const UP_DIR = path.join(import.meta.dirname, '..', 'static', 'uploads')
fs.mkdirSync(UP_DIR, { recursive: true })
const PALETTES = [['#2f6f4f', '#e8f3ec'], ['#3a5fa8', '#e9eef9'], ['#a8642f', '#faf0e6'], ['#7a4fa8', '#f3ecfa'], ['#a82f4f', '#faecef']]
function makeSvg(name, title, sub, pi) {
  const [fg, bg] = PALETTES[pi % PALETTES.length]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450">
<rect width="800" height="450" fill="${bg}"/>
<path d="M0 340 Q200 280 400 330 T800 320 V450 H0 Z" fill="${fg}" opacity="0.25"/>
<path d="M0 380 Q220 320 430 370 T800 360 V450 H0 Z" fill="${fg}" opacity="0.45"/>
<circle cx="660" cy="90" r="46" fill="${fg}" opacity="0.5"/>
<text x="48" y="200" font-family="PingFang SC,Microsoft YaHei,sans-serif" font-size="40" fill="${fg}" font-weight="600">${title}</text>
<text x="48" y="252" font-family="PingFang SC,Microsoft YaHei,sans-serif" font-size="22" fill="${fg}" opacity="0.8">${sub}</text>
</svg>`
  const file = path.join(UP_DIR, name)
  if (!fs.existsSync(file)) fs.writeFileSync(file, svg)
  return '/uploads/' + name
}

let n = 0
const upd = async (sql, a) => { const r = await q(sql, a); n += r.affectedRows }

// ---------- 1. 线路商品：全字段 ----------
const products = await q("SELECT id, title, city_code, price_from FROM tour_product WHERE channel = 'main' ORDER BY id")
const CITY_SUB = { 310118: '上海·青浦 朱家角', 330500: '湖州·安吉', 320508: '苏州·姑苏' }
for (let i = 0; i < products.length; i++) {
  const p = products[i]
  const city = CITY_SUB[p.city_code] || '江南水乡'
  const imgs = [1, 2, 3].map((k) => makeSvg(`demo-prod-${p.id}-${k}.svg`, p.title.slice(0, 14), `${city} · 实拍 ${k}`, p.id + k))
  const brief = `${p.title}：跟着在地向导走进${city}，用半天到两天的时间，把这里的风物、手艺和故事走一遍。`
  await upd(`UPDATE tour_product SET subtitle = ?, days_desc = ?, bean_gift = ?, meeting_point = ?, safety_note = ?, images = ?, rich_desc = ?, profile = ? WHERE id = ?`, [
    city + ' · 小团慢游',
    pick(['半日 · 4 小时', '一日 · 8 小时', '2 天 1 夜'], i),
    ri(50, 300),
    city + ' 地铁站 2 号口「向往的自由」旗帜下集合',
    '1) 请穿防滑舒适的鞋；2) 水上活动段必须穿救生衣；3) 贵重物品自行保管；4) 集合逾时 15 分钟视为放弃，不支持退款。',
    JSON.stringify(imgs),
    JSON.stringify({
      intro: `<p>${brief}</p><p>线路由平台与在地履约商户共同设计，小团出行（≤15 人），全程无强制消费。途中安排 1 次茶歇与 1 次手作体验，适合第一次来的朋友。</p>`,
      includes: ['全程向导服务', '行程内手作体验材料费', '一次茶歇饮品', '活动当日旅行意外险'],
      excludes: ['往返大交通', '行程外个人消费', '午餐（会推荐本地餐馆）'],
      highlights: ['在地人带路，去游客不知道的角落', '小团慢节奏，随走随停', '行程结束赠电子纪念卡'],
    }),
    JSON.stringify({
      tags: pick([['水乡', '慢游'], ['茶山', '旅修'], ['园林', '评弹']], i),
      suitable: ['情侣出行', '朋友结伴', '亲子家庭'],
      age_range: '6–60 岁',
      group_size: '8–15 人小团',
      itinerary: [
        { time: '09:30', title: '集合出发', desc: '签到领物料，向导讲行程与安全须知' },
        { time: '10:00', title: '主题走读', desc: '沿核心动线走访 3–4 个点位，边走边讲' },
        { time: '12:00', title: '本地午餐', desc: '推荐 3 家在地餐馆，自行选择' },
        { time: '14:00', title: '手作体验', desc: '非遗/风物主题手作，成品带走' },
        { time: '16:00', title: '返程', desc: '合影解散，可继续自由探索' },
      ],
      transport: '自行前往集合点；行程内步行 + 一次摆渡车',
      notice: '<p>请提前 15 分钟到达集合点；雨天照常进行（室内备选方案），极端天气提前 24 小时通知改期。</p>',
      insurance_note: '含当日旅行意外险（保额 20 万），报名时自动投保，无需额外操作。',
      share_title: p.title + '｜向往的自由',
      share_image: imgs[0],
      keywords: ['江南', '小团', '在地体验'],
    }),
    p.id,
  ])
}

// ---------- 2. 商户：全字段 ----------
const merchants = await q('SELECT id, name FROM merchant ORDER BY id')
const M = ['餐饮名店', '精品民宿', '文旅体验馆']
for (let i = 0; i < merchants.length; i++) {
  const m = merchants[i]
  const logo = makeSvg(`demo-mlogo-${m.id}.svg`, m.name.slice(0, 8), '商户标识', m.id)
  const sf = [1, 2].map((k) => makeSvg(`demo-mstore-${m.id}-${k}.svg`, m.name.slice(0, 8), `门店实拍 ${k}`, m.id + 7 + k))
  await upd('UPDATE merchant SET biz_license = ?, score = ?, profile = ? WHERE id = ?', [
    '91310000MA1DEMO' + String(100 + i),
    (4.2 + i * 0.2).toFixed(1),
    JSON.stringify({
      short_name: m.name.replace(/^安麓大夫第 · /, '安麓·').replace(/民宿|文旅$/, ''),
      tags: pick([['餐饮', '老字号'], ['住宿', '设计感'], ['体验', '研学']], i),
      logo, storefront: sf,
      intro: `<p>${m.name}：在地经营多年，主打本帮风味与水乡生活方式，是本线路的履约与接待主体。</p>`,
      address: pick(['朱家角镇北大街 187 号', '安吉递铺街道灵峰北路 88 号', '姑苏区平江路 245 号'], i),
      geo: '31.11' + ri(10, 60) + ',121.05' + ri(10, 60),
      service_phone: '021-5975' + String(1000 + i * 7),
      business_hours: [{ days: '周一至周日', time: '09:00–20:00' }],
      capacity: ri(40, 150),
      facilities: ['免费WiFi', '行李寄存', '无障碍通道', '饮水点'],
      legal_person: pick(['沈德标', '屠杏珍', '顾明堂'], i),
      settle_cycle: 'weekly',
      account_name: m.name, bank_name: pick(['中国银行朱家角支行', '农业银行安吉支行', '苏州银行平江支行'], i),
      account_no: '6222 0210 0' + ri(1000000, 9999999),
      invoice_title: m.name + '有限公司',
      refund_fee_share: 0,
      contacts: [{ name: pick(['王店长', '李主管', '张经理'], i), phone: '139' + String(10000000 + i * 111111).slice(0, 8), role: '门店负责人' }],
      contract_no: 'HT-DEMO-' + (2025 + i) + '-' + (100 + i),
      contract_end: '2027-12-31',
      bd_owner: pick(['运营·陈晨', '运营·周舟'], i),
      remark: '演示数据：合作履约稳定，无未决争议。',
    }),
    m.id,
  ])
}

// ---------- 3. 景区：全字段 ----------
const scenics = await q('SELECT id, name, city_code FROM scenic_spot ORDER BY id')
for (let i = 0; i < scenics.length; i++) {
  const s = scenics[i]
  const cover = makeSvg(`demo-scenic-${s.id}.svg`, s.name.slice(0, 10), '景区实景', s.id)
  const gal = [1, 2, 3].map((k) => makeSvg(`demo-scenic-${s.id}-${k}.svg`, s.name.slice(0, 10), `四季 ${k}`, s.id + 20 + k))
  await upd('UPDATE scenic_spot SET ticket_interface = ?, contact_name = ?, contact_phone = ?, profit_terms = ?, profile = ? WHERE id = ?', [
    pick(['线下窗口代售', '扫码核销', '电子票直连'], i),
    pick(['孙园长', '钱主管', '吴经理', '郑主任'], i),
    '021-5926' + String(2000 + i * 13),
    '门票按协议价 9 折结算，月结 30 天',
    JSON.stringify({
      alias: [s.name.slice(0, 3) + '景区'],
      cover, gallery: gal,
      intro: `<p>${s.name}：${pick(['江南园林的代表片段，一步一景。', '水上森林与湿地观鸟的四季课堂。', '竹海与茶山之间的天然氧吧。', '老街与评弹交织的市井生活现场。'], i)}</p><p>开放区域包含核心游览区与体验工坊，持平台凭证可走团队通道。</p>`,
      address: pick(['朱家角镇西井街 121 号', '青浦金泽镇莲湖村', '姑苏区仓街小新桥巷 6 号', '安吉灵峰街道横山坞村'], i),
      geo: '31.10' + ri(10, 90) + ',120.98' + ri(10, 90),
      open_hours: '08:30–17:00（16:30 停止入园）',
      tickets: [{ name: '成人票', price: ri(40, 90) * 100, note: '含核心景区' }, { name: '优待票', price: ri(20, 45) * 100, note: '学生/60 岁以上凭证' }],
      traffic: '地铁 17 号线转公交，或自驾停车费 10 元/次；团队大巴可预约园内落客。',
      contract_end: '2027-06-30',
      remark: '演示数据：合作票价与结算条款以协议为准。',
    }),
    s.id,
  ])
}

// ---------- 4. 供应商：全字段 ----------
const suppliers = await q('SELECT id, name FROM supplier ORDER BY id')
for (let i = 0; i < suppliers.length; i++) {
  const s = suppliers[i]
  const logo = makeSvg(`demo-suplogo-${s.id}.svg`, s.name.slice(0, 8), '供给方', s.id + 30)
  await upd('UPDATE supplier SET license_no = ?, contact_name = ?, contact_phone = ?, note = ?, profile = ? WHERE id = ?', [
    '91330500MA2DEMO' + String(200 + i),
    pick(['冯队长', '沈馆长', '施营地长', '陆社长'], i),
    '0572-503' + String(3000 + i * 17),
    '演示数据：月结，对账单每月 5 日前发送。',
    JSON.stringify({
      service_area: [pick(['青浦', '朱家角'], i), pick(['安吉', '姑苏'], i)],
      rating: pick(['A', 'B+'], i),
      logo,
      intro: `<p>${s.name}：平台认证在地供给方，服务能力与安全资质年审通过。</p>`,
      credit_days: 30,
      account_name: s.name, bank_name: '农商银行', account_no: '6228 4801 0' + ri(1000000, 9999999),
      contract_end: '2027-03-31',
      contacts: [{ name: '对接人·小' + pick(['杨', '何', '高'], i), phone: '137' + String(30000000 + i * 121212).slice(0, 8), role: '商务对接' }],
    }),
    s.id,
  ])
}

// ---------- 5. 用户：头像 + 成长值/等级 ----------
const { sealMobile } = await import('../src/infra/mobile.mjs').then((m) => m)
const users = await q('SELECT id, nickname FROM user_account ORDER BY id')
const LV = [[0, 1], [200000, 2], [1000000, 3], [3000000, 4]]
for (let i = 0; i < users.length; i++) {
  const u = users[i]
  const avatar = makeSvg(`demo-avatar-${u.id}.svg`, (u.nickname || '旅').slice(0, 1), '', u.id + 40)
  const tier = ri(0, 3)
  const growth = LV[tier][0] + ri(0, 150000)
  await upd('UPDATE user_account SET avatar_url = ?, growth_value = ?, member_level = ? WHERE id = ?', [avatar, growth, LV[tier][1], u.id])
}

// ---------- 6. 团期：早鸟价/带队人/集合信息 ----------
const sessions = await q('SELECT s.id, s.price_adult, s.depart_date FROM tour_session s WHERE s.status = 1')
for (let i = 0; i < sessions.length; i++) {
  const s = sessions[i]
  const early = i % 3 !== 2
  await upd('UPDATE tour_session SET early_price = ?, early_days = ?, profile = ? WHERE id = ?', [
    early ? Math.floor(Number(s.price_adult) * 0.88) : null, early ? 7 : null,
    JSON.stringify({
      sign_deadline: s.depart_date + ' 18:00:00',
      gather_time: '09:30',
      end_time: pick(['16:00', '16:30', '17:00'], i),
      leader_name: pick(['向导·阿凯', '向导·桃子', '向导·老周'], i),
      leader_phone: '136' + String(40000000 + i * 91827).slice(0, 8),
      vehicle: pick(['步行 + 摆渡车', '大巴 + 步行'], i),
      note: '成团前 48 小时确认；未成团全额退款。',
      internal_note: '演示数据：领队为内部员工挂名。',
    }),
    s.id,
  ])
}

// ---------- 7. 约稿任务：富要求 ----------
const tasks = await q('SELECT id, title FROM content_task ORDER BY id')
for (let i = 0; i < tasks.length; i++) {
  const t = tasks[i]
  const cover = makeSvg(`demo-task-${t.id}.svg`, t.title.slice(0, 10), '征稿封面', t.id + 50)
  await upd('UPDATE content_task SET cover_img = ?, rich_brief = ?, min_words = ?, min_images = ?, deadline = ?, profile = ? WHERE id = ?', [
    cover,
    `<p><b>${t.title}</b></p><p>以真实体验为底稿：记录过程、细节与情绪，避免通篇宣传语。图文 6 图起步，视频 60 秒以上。</p><p>发布平台不限，需带话题 #向往的自由#。通过审核后旅豆即时到账，有现金奖励的由财务登记打款。</p>`,
    pick([400, 500, 600], i), pick([4, 6, 3], i),
    new Date(Date.now() + ri(10, 40) * 86400000).toISOString().slice(0, 19).replace('T', ' '),
    JSON.stringify({
      platforms: ['小程序创作中心', '小红书', '抖音'],
      must_mention: ['向往的自由', pick(['课植园', '竹海', '平江路', '白茶'], i)],
      forbidden: ['虚假宣传', '涉政涉黄内容', '其他平台水印'],
      references: [{ title: '优秀示例 · 水乡晨雾', link: '/uploads/demo-task-' + t.id + '.svg' }],
      review_rules: ['内容真实，为本人在平台的真实体验', '图片清晰无他平台水印', '文字不少于平台要求字数', '带话题 #向往的自由#'],
    }),
    t.id,
  ])
}

// ---------- 8. 笔记：图片占位 ----------
const notes = await q("SELECT id, title FROM content_note WHERE status = 2 ORDER BY id DESC LIMIT 14")
for (let i = 0; i < notes.length; i++) {
  const imgs = [1, 2, 3].map((k) => makeSvg(`demo-note-${notes[i].id}-${k}.svg`, notes[i].title.slice(0, 12), `配图 ${k}`, notes[i].id + k))
  await upd("UPDATE content_note SET body = JSON_SET(body, '$.images', CAST(? AS JSON)) WHERE id = ?", [JSON.stringify(imgs), notes[i].id])
}

// ---------- 9. 轮播：副标题/链接/投窗 ----------
const banners = await q('SELECT id, title, sort FROM banner ORDER BY sort')
const prods = await q("SELECT id FROM tour_product WHERE channel = 'main' AND status = 1")
for (let i = 0; i < banners.length; i++) {
  const b = banners[i]
  const img = makeSvg(`demo-banner-${b.id}.svg`, b.title.slice(0, 12), '向往的自由 · 精选', b.id + 60)
  const start = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 19).replace('T', ' ')
  const end = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 19).replace('T', ' ')
  const linkProd = prods.length ? pick(prods).id : null
  const linkType = prods.length ? 'product' : 'none'
  await upd('UPDATE banner SET image = ?, sub_title = ?, start_at = ?, end_at = ?, link = ?, profile = ? WHERE id = ?', [
    img, pick(['本周精选 · 拼团中', '早鸟价 · 剩 3 天', '会员日 · 双倍旅豆'], i),
    start, end, linkProd ? '/pages/tour/detail?id=' + linkProd : '',
    JSON.stringify({ track_code: 'banner-demo-' + b.id, link_type: linkType, link_product: linkProd, bg_color: pick(['#2f6f4f', '#3a5fa8', '#a8642f'], i) }),
    b.id,
  ])
}

// ---------- 10. 订单联系人电话：加密落库（演示服务 JWT_SECRET=dev 同源）----------
const orders = await q("SELECT id, order_no FROM orders WHERE contact_name LIKE '%' AND contact_phone_sealed IS NULL AND status IN (20,30,40,50) ORDER BY id DESC LIMIT 40")
for (let i = 0; i < orders.length; i++) {
  const phone = '138' + String(61000000 + i * 81727).slice(0, 8)
  const sealed = sealMobile(phone)
  await upd('UPDATE orders SET contact_phone_sealed = ? WHERE id = ?', [sealed.enc, orders[i].id])
}

console.log('字段补满完成：UPDATE 共', n, '行；占位 SVG', fs.readdirSync(UP_DIR).filter((f) => f.startsWith('demo-')).length, '个')
await c.end()
