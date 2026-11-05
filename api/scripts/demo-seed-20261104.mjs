// 演示环境造数（一次性脚本，指向演示库需 ALLOW_DEMO_SEED=1 显式放行）
// 目标：经营概览/各栏目真实感数据——每栏目 ≥10 条。只 INSERT，不改既有行；
// 订单走状态机语义直接落库（演示库无真实支付），旅豆走账本双记（保持借贷平衡）。
import mysql from 'mysql2/promise'
import { grant, BIZ } from '../src/domain/bean.mjs'
import { closeDb } from '../src/db.mjs'

if (process.env.ALLOW_DEMO_SEED !== '1' || !(process.env.DB_NAME === 'wanderlust' || process.env.DB_NAME?.startsWith('wanderlust_qa_'))) {
  console.error('拒绝运行：本脚本只允许 ALLOW_DEMO_SEED=1 且 DB_NAME=wanderlust（演示库）时执行')
  process.exit(1)
}
const c = await mysql.createConnection({ host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306), user: process.env.DB_USER || 'root', password: process.env.DB_PASS || 'root', database: process.env.DB_NAME })
const q = async (sql, a = []) => (await c.query(sql, a))[0]
const rnd = (arr) => arr[Math.floor(Math.random() * arr.length)]
const ri = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min
const stamp = Date.now().toString(36)
let created = { users: [], orders: [], notes: [], tasks: [], risk: [], coCreators: [], profits: [], withdrawals: [], scenics: [], suppliers: [], banners: [], faqs: [], sessions: [] }

try {
  await c.beginTransaction()
  // ---------- 1. 用户（补到 ≥ 20）----------
  const { nicknames: NN } = { nicknames: ['青浦晨跑者小林', '姑苏评弹爱好者', '湖畔亲子日记', '古镇摄影社阿伟', '瑜伽旅修师安安', '周末徒步团·老周', '茶山拾光·小满', '水乡食记·阿玲', '汉服出行·糖糖', '江南骑行队·大鹏', '亲子研学·贝壳妈', '日落收集者·屿'] }
  for (const n of NN) {
    const [r] = await c.query('INSERT INTO user_account (mini_a_openid, nickname, created_at) VALUES (?, ?, NOW(3) - INTERVAL ? DAY)', ['demo-' + stamp + '-' + n.length + Math.random().toString(36).slice(2, 6), n, ri(3, 90)])
    created.users.push(r.insertId)
  }
  const users = (await q('SELECT id FROM user_account WHERE status = 1')).map((r) => r.id)

  // ---------- 2. 景区/供应商（补到 ≥10）----------
  const SC = [
    ['310118', '朱家角课植园', '3A'], ['310118', '青西郊野公园', '4A'], ['320508', '耦园', '世界遗产'],
    ['320508', '平江路历史街区', '街区'], ['330500', '安吉竹博园', '4A'], ['330500', '余村两山景区', '4A'],
  ]
  for (const [city, name, lv] of SC) {
    const [r] = await c.query('INSERT INTO scenic_spot (city_code, name, scenic_level, coop_mode, status) VALUES (?,?,?,?,1)', [city, name, lv, '票务分成'])
    created.scenics.push(r.insertId)
  }
  const SUP = [
    ['310118', '朱家角乌篷船队', 'transport'], ['320508', '姑苏手作体验馆', 'other'], ['330500', '安吉竹海营地', 'hotel'],
    ['310118', '水乡光影剧社', 'ticket'], ['330500', '白茶山配送合作社', 'catering'], ['320508', '苏式点心工坊', 'catering'],
  ]
  for (const [city, name, cat] of SUP) {
    const [r] = await c.query("INSERT INTO supplier (city_code, name, category, settle_mode, status) VALUES (?,?,?,'monthly',1)", [city, name, cat])
    created.suppliers.push(r.insertId)
  }

  // ---------- 3. 团期（未来 8 周，含名额与价格）----------
  const prods = (await q('SELECT id, city_code, merchant_id, price_from FROM tour_product WHERE status = 1 AND channel = \'main\'')).filter((p) => p.id <= 3)
  for (const p of prods) {
    for (let w = 1; w <= 4; w++) {
      const d = new Date(Date.now() + w * 7 * 86400000)
      const ds = d.toISOString().slice(0, 10)
      const [r] = await c.query('INSERT INTO tour_session (product_id, depart_date, quota, min_go, price_adult, status) VALUES (?,?,?,?,?,1)', [p.id, ds, ri(15, 30), 8, p.price_from])
      created.sessions.push(r.insertId)
    }
  }
  const sessions = (await q('SELECT s.id, s.depart_date, s.price_adult, p.id pid, p.city_code, p.merchant_id FROM tour_session s JOIN tour_product p ON p.id = s.product_id WHERE s.status = 1 AND s.depart_date >= CURDATE()')).map((r) => r)

  // ---------- 4. 订单（≈60 条，跨状态/城市/时间，占名额）----------
  const CATS = { 310118: ['陈晓青', '周文彬', '吴雪梅', '郑浩然'], 330500: ['林雅静', '沈国强', '顾梦琪'], 320508: ['徐子涵', '马俊杰', '唐雨欣'] }
  const STS = [10, 20, 20, 30, 30, 40, 40, 50, 50, 50, 70]
  const phone = (i) => '138' + String(51000000 + i * 7919).slice(0, 8)
  for (let i = 0; i < 60; i++) {
    const s = rnd(sessions)
    const st = STS[i % STS.length]
    const qty = ri(1, 3)
    const pay = s.price_adult * qty
    const uname = rnd(users)
    const city = s.city_code
    const daysAgo = ri(0, 55)
    const contact = rnd(CATS[city] || CATS[310118])
    const paid = st >= 20 && st !== 10
    const no = 'WL' + new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10).replaceAll('-', '') + 'DEMO' + String(i).padStart(4, '0')
    const [r] = await c.query(`INSERT INTO orders (order_no, user_id, product_id, session_id, city_code, merchant_id, qty, amount_goods, amount_pay, status, contact_name, created_at, paid_at, insurance_fee)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [no, uname, s.pid, s.id, city, s.merchant_id, qty, pay, pay, st, contact,
        `NOW - ${daysAgo}d`.replace('NOW - ' + daysAgo + 'd', new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 19).replace('T', ' ')),
        paid ? new Date(Date.now() - (daysAgo - 0.02) * 86400000).toISOString().slice(0, 19).replace('T', ' ') : null, 200 * qty])
    created.orders.push(r.insertId)
    if ([20, 30, 40, 50].includes(st)) await c.query('UPDATE tour_session SET booked = LEAST(quota, booked + ?) WHERE id = ?', [qty, s.id])
    // 已核销/已完成的出凭证
    if ([40, 50].includes(st)) {
      for (let k = 0; k < qty; k++) {
        await c.query('INSERT INTO travel_pass (user_id, order_id, kind, name, product_id, status, created_at) VALUES (?,?,1,?,?,?,NOW(3) - INTERVAL ? DAY)',
          [uname, r.insertId, '主题游通行凭证·' + no, s.pid, st === 50 ? 2 : ri(1, 2), daysAgo])
      }
    }
  }

  // ---------- 5. 推广员 + 佣金 + 提现（提现 ≥12 条）----------
  const promoUsers = users.slice(0, 6)
  for (const uid of promoUsers) {
    await c.query('INSERT IGNORE INTO promoter (user_id, tier, rate_bp, service_score, status) VALUES (?,?,?,4.6,1)', [uid, 1, 500])
  }
  for (let i = 0; i < 14; i++) {
    const uid = rnd(promoUsers)
    const st = [0, 0, 1, 1, 1, 2][i % 6]
    const amt = ri(100, 900) * 100
    const [r] = await c.query('INSERT INTO promoter_withdraw (promoter_id, amount, status, proposer_note, pay_ref, created_at) VALUES (?,?,?,?,?,NOW(3) - INTERVAL ? DAY)',
      [uid, amt, st, '演示提现申请 #' + (i + 1), st === 1 ? 'DEMO-PAY-' + stamp + '-' + i : null, ri(1, 30)])
    created.withdrawals.push(r.insertId)
  }

  // ---------- 6. 旅豆预算内补发 + 账本（借贷平衡）----------
  const budget = (await q('SELECT id, total, granted FROM bean_budget WHERE status = 1 ORDER BY id LIMIT 1'))[0]
  const connection = {
    q, one: async (sql, args = []) => (await q(sql, args))[0] || null,
    ins: async (sql, args = []) => (await q(sql, args)).insertId,
    upd: async (sql, args = []) => (await q(sql, args)).affectedRows,
  }
  for (let i = 0; i < 18; i++) {
    const uid = rnd(users)
    const amt = ri(50, 300)
    await grant(uid, amt, BIZ.REBATE, 'DEMO-GRANT-' + stamp + '-' + i, budget.id, connection)
  }

  // ---------- 7. 笔记（≥14 条，多为已发布带赞）----------
  const NOTE_TITLES = [
    ['朱家角一日漫游：课植园里的江南谜案', 310118], ['安吉白茶采摘初体验｜从茶山到茶盏', 330500], ['带娃走姑苏：耦园的评弹下午', 320508],
    ['青西郊野公园的水上森林，秋季限定', 310118], ['瑜伽谷的清晨：山雾里的冥想课', 330500], ['平江路手作扎染，把江南带回家', 320508],
    ['阿婆粽测评：三家老店横向对比', 310118], ['竹海露营过夜攻略（装备清单）', 330500], ['余村两山石打卡路线', 330500],
    ['汉服出片圣地：课植园倒影位', 310118], ['周末骑行环淀山湖 42km 记录', 310118], ['苏州园林年卡值不值？算给你看', 320508],
    ['亲子研学：一片茶叶的科学', 330500], ['水乡夜游灯光秀避雷帖', 310118],
  ]
  for (let i = 0; i < NOTE_TITLES.length; i++) {
    const [title, city] = NOTE_TITLES[i]
    const pid = (prods.find((p) => p.city_code === city) || prods[0]).id
    const st = i < 11 ? 2 : ri(0, 3) // 11 篇已发布，其余待审/驳回/下架
    const [r] = await c.query(`INSERT INTO content_note (user_id, title, body, status, related_product_id, like_count, created_at, published_at)
      VALUES (?,?,?,?,?,?,NOW(3) - INTERVAL ? DAY, ${st === 2 ? 'NOW(3) - INTERVAL ? DAY' : 'NULL'})`,
      [rnd(users), title, JSON.stringify({ text: '<p>' + title + '——演示数据正文，记录一次真实的江南出行体验。</p>', images: [] }), st, pid, st === 2 ? ri(3, 220) : 0, ri(1, 40), ri(0, 20)])
    created.notes.push(r.insertId)
  }

  // ---------- 8. 约稿任务 + 参与记录（任务 ≥10）----------
  const TASKS = [
    ['寻找水乡的 100 种清晨', 300, 0], ['白茶采矿笔记征集', 200, 2000], ['古镇汉服变装 Vlog', 500, 0],
    ['亲子研学路线实测', 250, 3000], ['露营装备横评', 150, 0], ['江南食记：一碗面的仪式感', 200, 0],
    ['秋日骑行vlog征稿', 180, 0], ['非遗手作体验报告', 220, 2500], ['夜游灯光摄影征集', 260, 0],
    ['周末短途拼团攻略', 200, 0],
  ]
  for (let i = 0; i < TASKS.length; i++) {
    const [title, beans, cash] = TASKS[i]
    const pid = rnd(prods).id
    const st = i < 8 ? 1 : 0
    const [t] = await c.query(`INSERT INTO content_task (task_no, title, brief, reward_beans, cash_reward, status, created_at)
      VALUES (?,?,?,?,?,?,NOW(3) - INTERVAL ? DAY)`, ['TKDEMO' + stamp + i, title, title + '——面向全体旅友的长期征稿，图文/视频均可。', beans, cash, st, ri(3, 30)])
    created.tasks.push(t.insertId)
    if (i % 2 === 0) {
      await c.query(`INSERT INTO content_task_entry (task_id, user_id, status, reward_beans, cash_reward, cash_status, claimed_at)
        VALUES (?,?,?,?,?,?,NOW(3) - INTERVAL ? DAY)`, [t.insertId, rnd(users), i % 4 === 0 ? 2 : 1, beans, cash, cash > 0 ? 1 : 0, ri(1, 10)])
    }
  }

  // ---------- 9. 风控事件 + 风险案件（≥12）+ 离线冲突 ----------
  const RISKS = [
    ['verify_replay', 3, '同一凭证 2 分钟内跨商户两次核销请求'], ['refund_abuse', 2, '30 天内第 4 笔全额退款申请'],
    ['device_cluster', 2, '同设备登录 5 个账号下单'], ['anchor_fail', 3, '存证批次锚定超时未确认'],
    ['commission_anomaly', 1, '单笔佣金基数异常放大（×12）'], ['verify_replay', 2, '离线核销载荷时间戳超前'],
    ['refund_abuse', 2, '下单后 10 分钟内申请退款 ×3'], ['device_cluster', 3, '同 IP 批量注册 8 账号'],
    ['commission_anomaly', 2, '推广商自购计佣嫌疑'], ['verify_replay', 1, '核销码暴力枚举拦截'],
    ['anchor_fail', 2, '链回执校验失败待人工'], ['device_cluster', 2, '同设备短时切换 3 商户端账号'],
  ]
  for (let i = 0; i < RISKS.length; i++) {
    const [kind, sev, detail] = RISKS[i]
    const uid = rnd(users)
    const [r] = await c.query('INSERT INTO risk_event (user_id, kind, severity, detail, created_at) VALUES (?,?,?,?,NOW(3) - INTERVAL ? HOUR)',
      [uid, kind, sev, JSON.stringify({ reason: detail, demo: true }), i])
    created.risk.push(r.insertId)
    // 前几条升级为案件
    if (i < 6) {
      const sevCase = sev
      const [k] = await c.query(`INSERT INTO risk_case (case_no, source_type, source_id, object_type, object_id, user_id, city_code, severity, title, status, handler, created_by, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'2026-11-03 09:00:00')`,
        ['RCDEMO' + stamp + String(i).padStart(3, '0'), 'risk_event', r.insertId, 'user', uid, uid, '310118', sevCase,
          detail.slice(0, 40), i < 3 ? 1 : 0, i < 3 ? 'admin:超级管理员' : null, 'admin:超级管理员'])
      await c.query('INSERT INTO risk_case_record (case_id, actor, action, note, from_status, to_status) VALUES (?,?,?,?,?,?)',
        [k.insertId, 'admin:超级管理员', 'create', '演示案件：' + detail, null, 0])
      if (i < 3) await c.query('INSERT INTO risk_case_record (case_id, actor, action, note, from_status, to_status) VALUES (?,?,?,?,?,?)',
        [k.insertId, 'admin:超级管理员', 'judge', '已受理，核查中', 0, 1])
      await c.query('UPDATE risk_event SET handled = 1 WHERE id = ?', [r.insertId])
    }
  }

  // ---------- 10. 共创人 + 分润（台账有数据可看闭环）----------
  for (let i = 0; i < 5; i++) {
    const pid = rnd(prods).id
    const [co] = await c.query('INSERT INTO co_creator (product_id, co_no, name, mobile, role, invest_amount, share_pct, status) VALUES (?,?,?,?,?,?,?,1)',
      [pid, 'CDEMO' + stamp + i, rnd(['王建军', '李慧珍', '张启明', '赵雅芝', '钱多多']), '139' + String(20000000 + i * 13579).slice(0, 8), i % 2 + 1, ri(5, 50) * 10000, ri(3, 12) * 100])
    created.coCreators.push(co.insertId)
    for (let w = 0; w < 2; w++) {
      const amt = ri(80, 400) * 100
      const settled = i < 2 // 前两位共创人有已结清记录
      const [pf] = await c.query(`INSERT INTO co_profit (settlement_id, co_creator_id, product_id, period, base_amount, amount, status, paid_amount)
        VALUES (?,?,?,?,?,?,?,?)`, [960000 + i * 2 + w, co.insertId, pid, '2026-W' + (40 + w), amt * 10, amt, settled ? 1 : 0, settled ? amt : (i === 2 ? Math.floor(amt / 2) : 0)])
      created.profits.push(pf.insertId)
      if (settled || i === 2) {
        await c.query("INSERT INTO co_profit_pay (co_profit_id, direction, pay_ref, channel, pay_date, amount, status, operator) VALUES (?,1,?,'bank',CURDATE() - INTERVAL ? DAY,?,1,'admin:超级管理员')",
          [pf.insertId, 'DEMO-CO-PAY-' + stamp + '-' + i + '-' + w, ri(1, 20), settled ? amt : Math.floor(amt / 2)])
      }
    }
  }

  // ---------- 11. 轮播 / FAQ（各补到 ≥10）----------
  const BANNERS = [
    ['秋日水乡 · 课植园谜案季', 310118], ['安吉瑜伽谷 · 深秋旅修营', 330500], ['姑苏姐姐茶会 · 每周六', 320508],
    ['淀山湖骑行周末团', 310118], ['竹海露营早鸟价', 330500], ['平江路手作工坊日历', 320508],
    ['白茶明前预售开启', 330500], ['汉服出行日 · 免费跟拍', 310118], ['亲子研学冬令营报名中', 320508], ['年终会员双倍旅豆', null],
  ]
  for (let i = 0; i < BANNERS.length; i++) {
    const [title, city] = BANNERS[i]
    const [b] = await c.query('INSERT INTO banner (title, image, profile, status, sort, created_at) VALUES (?,?,?,1,?,NOW(3) - INTERVAL ? DAY)',
      [title, '/uploads/demo-banner-' + (i + 1) + '.svg', city ? JSON.stringify({ cities: [city] }) : null, i + 1, i])
    created.banners.push(b.insertId)
  }
  const FAQS = [
    ['订单支持改期吗？', '出发前 7 天可免费改期一次，进入「我的订单」选择需要改期的订单操作。'],
    ['旅豆怎么获得？', '完成订单、发表笔记、参与约稿任务均可获得旅豆，返豆比例与会员等级相关。'],
    ['核销码在哪里看？', '支付成功后订单详情页会生成动态核销码，到店出示给工作人员即可。'],
    ['可以开发票吗？', '支持电子发票，订单完成后 7 个工作日内开具，请在订单详情中填写开票信息。'],
    ['退款手续费怎么算？', '按距出发天数梯度收取：7 天以上免费，3–7 天 10%，1–3 天 30%，出发当天不支持退款。'],
    ['儿童怎么收费？', '1.2 米以下儿童免费随行，1.2 米以上按成人价，部分线路有儿童价以页面展示为准。'],
    ['雨天下活动会取消吗？', '小雨正常进行，极端天气会提前 24 小时通知改期或全额退款。'],
    ['集合地点怎么找？', '订单详情页有集合点地图与导航，出发前一天会发送短信提醒。'],
    ['可以带宠物吗？', '户外线路可携带小型宠物（需牵绳），室内场馆与餐饮环节不可携带。'],
    ['旅豆有有效期吗？', '旅豆自获得之日起 12 个月内有效，到期前 30 天会在小程序提醒。'],
  ]
  for (let i = 0; i < FAQS.length; i++) {
    const [qq, aa] = FAQS[i]
    const [f] = await c.query('INSERT INTO faq (question, answer, status, sort, created_at) VALUES (?,?,1,?,NOW(3) - INTERVAL ? DAY)', [qq, aa, i + 1, i])
    created.faqs.push(f.insertId)
  }

  // ---------- 12. 商户进件待审（给审核栏目 2 条）----------
  for (let i = 0; i < 2; i++) {
    await c.query("INSERT INTO merchant (city_code, name, kind, merchant_no, status, apply_contact, created_at) VALUES (?,?,?,?,0,?,NOW(3))",
      ['310118', ['朱家角手冲咖啡实验室', '水乡蓝染工作室'][i], 'other', 'MDEMO' + stamp + i, '演示申请人' + (i + 1)])
  }

  // ---------- 汇总 ----------
  const summary = {
    用户: created.users.length, 景区: created.scenics.length, 供应商: created.suppliers.length,
    团期: created.sessions.length, 订单: created.orders.length, 笔记: created.notes.length,
    任务: created.tasks.length, 风控事件: created.risk.length, 风险案件: 6,
    共创人: created.coCreators.length, 分润单: created.profits.length,
    提现: created.withdrawals.length, 轮播: created.banners.length, FAQ: created.faqs.length,
  }
  await c.commit()
  console.log('演示数据写入完成：', JSON.stringify(summary))
} catch (e) {
  console.error('失败，回滚本次写入……', e.message)
  await c.rollback()
  process.exitCode = 1
} finally {
  await c.end()
  await closeDb()
}
