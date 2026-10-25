// 示例内容播种：商户 / 主题游线路 / 商城 SKU / 团期 / 旅豆预算 / 示例推广员
// 数据取自原型 demo 口径（价格=分）。幂等：库空才种；--force 清空商品域后重种（有订单时拒绝）。
// 用法：node db/seed-content.mjs [--force]    （服务启动时 bootstrap 亦会在空库自动调用）
import { q, one, count, tx } from '../src/db.mjs'
import { hashPassword } from '../src/auth.mjs'
import { register } from '../src/domain/promo.mjs'

const MERCHANTS = [
  ['M20261101001', '310118', '安麓大夫第 · 朱家角', 'SUBMCH-ZJQ-001'],
  ['M20261101002', '330500', '安吉瑜伽谷民宿', 'SUBMCH-YOGA-002'],
  ['M20261101003', '320508', '苏州园林文旅', 'SUBMCH-SZLY-003'],
  ['M20261101004', '310101', '一大会址 · 星文旅创', null],
  ['M20261101005', '310151', '崇明营地联盟', null],
]

// [标题, 分类, 城市, 商户序号, 价格分, 赠豆展示, 天数, 简介]
const PRODUCTS = [
  ['朱家角剧本游 · 江南谜案', 'script', '310118', 0, 29800, 298, '1天', '实景搜证 · NPC 互动 · 多结局，样板景区深度剧本'],
  ['一大会址 · 红色剧本闯关', 'red', '310101', 3, 16800, 168, '半日', '扫码选角色 · AR 任务 · 沉浸解谜，红色文旅实景体验'],
  ['安吉瑜伽谷 · 2天1夜', 'yoga', '330500', 1, 68800, 688, '2天1夜', '竹林冥想 + 晨间流瑜伽 + 山野素食，学员互助社群'],
  ['苏州园林 · 姐姐茶会', 'sister', '320508', 2, 39800, 398, '1天', '旗袍拍摄 + 园林茶会 + 花艺，精致姐姐出片专场'],
  ['崇明岛单身露营 · 3天2夜', 'single', '310151', 4, 128800, 1288, '3天2夜', '破冰游戏 + 素人综艺 + 篝火晚会，单身社交实验'],
  ['太湖皮划艇 · 竞技一日', 'sport', '320508', 2, 58800, 588, '1天', '水上闯关 + 团队接力 + 颁奖素人综艺'],
  ['莫干山亲子自然课', 'family', '330500', 1, 46800, 468, '1天', '昆虫观察 + 竹林手作 + 夜观星空，亲子自然教育'],
  ['江南扎染方巾（商城好物）', 'shop', '310118', 0, 6800, 0, '实物', '非遗手工扎染 · 随单发货 · 旅豆可抵 10%'],
  ['安吉白茶 · 明前 50g（商城好物）', 'shop', '330500', 1, 12800, 0, '实物', '源头直供 · 7 天无理由 · 旅豆可抵 10%'],
  ['朱家角阿婆粽礼盒（商城好物）', 'shop', '310118', 0, 8800, 0, '实物', '景区周边村级仓储前置 · 旅豆可抵 10%'],
]

const futureDates = (n) => {
  const out = []
  for (let i = 1; i <= 45 && out.length < n; i++) {
    const d = new Date(Date.now() + i * 86400000)
    if (d.getDay() === 5 || d.getDay() === 6 || i > 28) out.push(d.toISOString().slice(0, 10)) // 优先周五/六，兜底任意日
  }
  return out.slice(0, n)
}

export async function seedContent({ verbose = true } = {}) {
  const log = (...a) => verbose && console.log('[seed]', ...a)
  if ((await count('SELECT COUNT(*) c FROM tour_product')) > 0) {
    log('商品已存在，跳过（重种用 --force）')
    return { seeded: false }
  }
  const merchIds = []
  for (const [mno, city, name, sub] of MERCHANTS) {
    merchIds.push(await tx(async (c) => c.ins(
      'INSERT INTO merchant (city_code, name, merchant_no, wxpay_sub_mchid, status, score) VALUES (?,?,?,?,1,4.9)',
      [city, name, mno, sub])))
  }
  log(merchIds.length, '家商户')

  let sessions = 0
  for (const [title, cat, city, mi, price, gift, days, intro] of PRODUCTS) {
    const pid = await tx(async (c) => c.ins(
      `INSERT INTO tour_product (channel, city_code, cat, title, subtitle, days_desc, price_from, bean_gift, merchant_id, status, rich_desc)
       VALUES ('main',?,?,?,?,?,?,?,?,1,?)`,
      [city, cat, title, intro, days, price, gift, merchIds[mi], JSON.stringify({ intro, includes: ['示例：行程/费用包含/退改规则可在此编辑'] })]))
    const dates = cat === 'shop'
      ? [new Date(Date.now() + 86400000).toISOString().slice(0, 10)]
      : futureDates(3)
    for (const d of dates) {
      await q('INSERT INTO tour_session (product_id, depart_date, quota, min_go, price_adult) VALUES (?,?,?,?,?)',
        [pid, d, cat === 'shop' ? 999 : 20 + Math.floor(Math.random() * 10), cat === 'shop' ? 1 : 8, price])
      sessions++
    }
  }
  log(PRODUCTS.length, '个商品（7 条线路 + 3 个商城 SKU）·', sessions, '个团期')

  const budget = await tx(async (c) => c.ins(
    "INSERT INTO bean_budget (name, total, biz_owner, status, period_start, period_end) VALUES ('首期·消费返豆', 6000000, 'marketing', 1, '2026-11-01', '2026-12-31')"))
  log('旅豆预算批次 #' + budget, '总额 6,000,000 豆（= 年度发行总量上限）')

  // 示例推广员：两个演示用户开通基础/优选档
  const promoUsers = []
  for (const name of ['demo-promoter-1', 'demo-promoter-2']) {
    let u = await one('SELECT id FROM user_account WHERE mini_a_openid = ?', ['mock-openid-' + name])
    if (!u) {
      const uid = await tx(async (c) => {
        const id = await c.ins('INSERT INTO user_account (unionid, mini_a_openid, nickname) VALUES (?,?,?)',
          ['mock-union-' + name, 'mock-openid-' + name, '示例推广员·' + name.slice(-1)])
        await c.ins('INSERT INTO bean_account (user_id) VALUES (?)', [id])
        return id
      })
      u = { id: uid }
    }
    promoUsers.push(Number(u.id))
  }
  await register(promoUsers[0], 1)
  await register(promoUsers[1], 2)
  const s1 = await (await import('../src/domain/promo.mjs')).createScene(promoUsers[0], 'poster')
  const s2 = await (await import('../src/domain/promo.mjs')).createScene(promoUsers[1], 'poster')
  log('示例推广员 2 名（基础 5% / 优选 8%），推广码：' + s1 + ' / ' + s2)

  return { seeded: true, merchants: merchIds.length, products: PRODUCTS.length, sessions, scenes: [s1, s2] }
}

// CLI
if (process.argv[1].endsWith('seed-content.mjs')) {
  const force = process.argv.includes('--force')
  ;(async () => {
    if (force) {
      const orders = await count('SELECT COUNT(*) c FROM orders')
      if (orders > 0) { console.error('已有订单，拒绝 --force（避免孤儿数据）；如需重来请整库重建'); process.exit(1) }
      await q('SET FOREIGN_KEY_CHECKS = 0')
      for (const t of ['attribution_hit', 'attribution', 'commission', 'promoter', 'bean_budget',
        'travel_pass', 'tour_session', 'tour_product', 'merchant', 'merchant_staff']) {
        await q('TRUNCATE TABLE `' + t + '`')
      }
      await q('SET FOREIGN_KEY_CHECKS = 1')
      console.log('[seed] --force 清空商品域完成')
    }
    const r = await seedContent()
    console.log('[seed] result:', JSON.stringify(r))
    process.exit(0)
  })()
}
