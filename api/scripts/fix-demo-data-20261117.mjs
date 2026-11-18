// 演示库数据修正（D-01～D-06，交GLM交接文档第 6 节）：
//   1) 默认只做「核对清单」输出（改动前的值与将执行的语句），不带 --apply 不写库；
//   2) --apply 才执行修正，逐项打印前后行数，全部写入 audit_log 留痕；
//   3) 守卫：只能对隔离库（wanderlust_qa_*）运行；8080 演示库须负责人同意并完整备份后，
//      按 docs/演示数据修正-D01-D06-核对清单-20261117.md 的流程执行（ALLOW_DESTRUCTIVE=1 例外见 _guard）。
// 用法：DB_NAME=wanderlust_qa_fix_20261117 node scripts/fix-demo-data-20261117.mjs [--apply]
import { assertIsolatedDb } from '../test/_guard.mjs'
assertIsolatedDb('scripts/fix-demo-data-20261117.mjs')
import { q, one, closeDb } from '../src/db.mjs'

const APPLY = process.argv.includes('--apply')
const APPLY_D5 = process.argv.includes('--apply-d5') // D-05：指标分布调整排练（隔离库）
const db = process.env.DB_NAME
const pad = (n) => (n < 10 ? '0' + n : '' + n)
const now = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` }
async function audit(action, ref, before, after) {
  await q('INSERT INTO audit_log (actor, module, action, biz_ref, before_val, after_val) VALUES (?,?,?,?,?,?)',
    ['system:demo-fix-20261117', 'demo-data', action, ref, JSON.stringify(before || null), JSON.stringify(after || null)])
}
const report = []
const line = (s) => { console.log(s); report.push(s) }

line(`# 演示数据修正（D-01～D-06）· 库=${db} · ${APPLY ? '【--apply 执行模式】' : '【核对清单模式（未写库）】'} · ${now()}`)

/* ---------- D-01 装修字样恢复正式文案 ---------- */
line('\n## D-01 品牌装修字样')
{
  // D-01：装修字样存 site_config.profile JSON（表单引擎 kind=site），不是独立列
  const site = await one(`SELECT id,
    JSON_UNQUOTE(JSON_EXTRACT(profile, '$.brand_name')) brand_name,
    JSON_UNQUOTE(JSON_EXTRACT(profile, '$.slogan')) slogan,
    JSON_UNQUOTE(JSON_EXTRACT(profile, '$.hero_eyebrow')) hero_eyebrow FROM site_config WHERE id = 1`)
  const want = { brand_name: '向往的自由', slogan: '世界就是我的游乐场', hero_eyebrow: 'WANDERLUST · 向往的自由' }
  const dirty = site && (site.brand_name !== want.brand_name || site.slogan !== want.slogan || site.hero_eyebrow !== want.hero_eyebrow)
  line(`- 当前：brand_name=${JSON.stringify(site?.brand_name)} slogan=${JSON.stringify(site?.slogan)} hero_eyebrow=${JSON.stringify(site?.hero_eyebrow)}`)
  if (dirty) {
    if (APPLY) {
      await q(`UPDATE site_config SET profile = JSON_SET(profile,
        '$.brand_name', ?, '$.slogan', ?, '$.hero_eyebrow', ?) WHERE id = 1`, [want.brand_name, want.slogan, want.hero_eyebrow])
      await audit('d01-site-reset', 'site-1', { brand_name: site.brand_name, slogan: site.slogan, hero_eyebrow: site.hero_eyebrow }, want)
      line('- ✅ 已恢复为正式文案（游客端「我的」页底部与「关于」随即生效）')
    } else line('- 将执行：JSON_SET profile.brand_name/slogan/hero_eyebrow 为正式文案')
  } else line('- ✅ 已是正式文案，无需处理')
}

/* ---------- D-02 QA 后台账号停用（保留审计） ---------- */
line('\n## D-02 QA 账号停用')
{
  const rows = await q("SELECT id, username, role, status FROM admin_user WHERE username REGEXP '^(mfaqa|modqa|qadn)-' AND status = 1")
  line(`- 在用 QA 账号 ${rows.length} 个：${rows.map((r) => r.username).join(', ') || '（无）'}`)
  if (rows.length) {
    if (APPLY) {
      for (const r of rows) {
        await q('UPDATE admin_user SET status = 0 WHERE id = ?', [r.id])
        await audit('d02-qa-disable', 'admin-' + r.id, { username: r.username, status: 1 }, { status: 0 })
      }
      line(`- ✅ 已停用 ${rows.length} 个并写审计（历史测试的 finally 清理是 DELETE，新增账号不会再残留）`)
    } else line('- 将执行：逐个 UPDATE admin_user SET status=0 + audit_log 留痕')
  }
}

/* ---------- D-03 演示商品资料 / 商户类目 ---------- */
line('\n## D-03 演示商品与商户类目')
{
  const demos = await q("SELECT id, title, status, city_code, scenic_id, supplier_id, merchant_id FROM tour_product WHERE title LIKE '%月度演示%'")
  line(`- 「月度演示」商品 ${demos.length} 个（${demos.map((p) => `#${p.id}${p.status === 1 ? '在架' : '已下架'}`).join(' ') || '无'}）`)
  if (demos.length && APPLY) {
    for (const p of demos) {
      // 统一改为内部可识别名称并保持下架，避免出现在任何游客端列表
      const t = p.title.replace(/·\s*月度演示\s*\d*/, '') + '【内部演示样例，不上架】'
      await q('UPDATE tour_product SET title = ?, status = 0 WHERE id = ?', [t.slice(0, 60), p.id])
      await audit('d03-demo-rename', 'product-' + p.id, { title: p.title, status: p.status }, { title: t.slice(0, 60), status: 0 })
    }
    line('- ✅ 已改名并全部下架（资料完整度不再影响演示）')
  } else if (demos.length) line('- 将执行：改名「…【内部演示样例，不上架】」+ status=0')
  // 错配资料：关联景区/供应商所在城市与商品城市不一致 → 摘除错配引用（资料回到"未关联"，可再由运营正确挂载）
  const mismatch = await q(`SELECT p.id, p.title, p.city_code pc, sc.city_code scc, sc.id sid FROM tour_product p
    LEFT JOIN scenic_spot sc ON sc.id = p.scenic_id
    WHERE sc.id IS NOT NULL AND sc.city_code <> p.city_code
      AND JSON_EXTRACT(p.profile, '$.cross_city') NOT IN (1, true)`.replace('$.*', '$.*'))
  line(`- 景区城市错配且未勾跨城的商品 ${mismatch.length} 个：${mismatch.map((p) => `#${p.id}(${p.pc}≠${p.scc})`).join(' ') || '无'}`)
  if (mismatch.length && APPLY) {
    for (const p of mismatch) {
      await q('UPDATE tour_product SET scenic_id = NULL WHERE id = ?', [p.id])
      await audit('d03-scenic-detach', 'product-' + p.id, { scenic_id: p.sid, city: p.pc }, { scenic_id: null })
    }
    line('- ✅ 已摘除错配景区引用（供应商错配同理按下一段处理）')
  } else if (mismatch.length) line('- 将执行：摘除错配 scenic_id')
  const supMismatch = await q(`SELECT p.id, p.title, p.city_code pc, sup.city_code scc FROM tour_product p
    JOIN supplier sup ON sup.id = p.supplier_id WHERE sup.city_code <> p.city_code`)
  line(`- 供应商城市错配商品 ${supMismatch.length} 个：${supMismatch.map((p) => `#${p.id}(${p.pc}≠${p.scc})`).join(' ') || '无'}`)
  if (supMismatch.length && APPLY) {
    for (const p of supMismatch) {
      await q('UPDATE tour_product SET supplier_id = NULL WHERE id = ?', [p.id])
      await audit('d03-supplier-detach', 'product-' + p.id, { city: p.pc }, { supplier_id: null })
    }
    line('- ✅ 已摘除错配供应商引用')
  } else if (supMismatch.length) line('- 将执行：摘除错配 supplier_id')
  // 商户类目补齐（P-08/D-03）：known 商户按名称映射，其余保持 other 由运营在后台补
  const KIND_MAP = [['安麓大夫第', 'hotel'], ['朱家角', 'catering'], ['课植园', 'catering']]
  const others = await q("SELECT id, name FROM merchant WHERE kind = 'other' AND status = 1")
  const fixable = others.filter((m) => KIND_MAP.find(([k]) => m.name.includes(k)))
  line(`- 类目为「其他」的在架商户 ${others.length} 家，可按名称映射补齐 ${fixable.length} 家：${fixable.map((m) => m.name).join('、') || '无'}`)
  if (fixable.length && APPLY) {
    for (const m of fixable) {
      const kind = KIND_MAP.find(([k]) => m.name.includes(k))[1]
      await q('UPDATE merchant SET kind = ? WHERE id = ?', [kind, m.id])
      await audit('d03-merchant-kind', 'merchant-' + m.id, { kind: 'other' }, { kind })
    }
    line('- ✅ 已按名称映射补齐类目')
  } else if (fixable.length) line('- 将执行：按名称映射补齐 kind')
}

/* ---------- D-04 订单号日期与创建时间矛盾 ---------- */
line('\n## D-04 单号日期与创建时间矛盾')
{
  const rows = await q(`SELECT id, order_no, created_at, paid_at FROM orders
    WHERE order_no REGEXP '^WL[0-9]{8}' AND DATE(created_at) <> STR_TO_DATE(SUBSTRING(order_no, 3, 8), '%Y%m%d') LIMIT 500`)
  line(`- 矛盾订单 ${rows.length} 笔（示例：${rows.slice(0, 3).map((r) => `${r.order_no} 建于 ${String(r.created_at).slice(0, 10)}`).join('；')}）`)
  if (rows.length && APPLY) {
    for (const r of rows) {
      const d = r.order_no.slice(2, 10)
      const fixed = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`
      await q('UPDATE orders SET created_at = ?, paid_at = COALESCE(paid_at, ?) WHERE id = ?',
        [fixed + String(r.created_at).slice(10), fixed + ' 12:00:00', r.id])
      await audit('d04-order-date-align', 'order-' + r.id, { created_at: String(r.created_at).slice(0, 19) }, { created_at: fixed + String(r.created_at).slice(10, 19) })
    }
    line('- ✅ 已把创建时间对齐到单号日期（单号即真实建单日，历史回填造成的矛盾消除）')
  } else if (rows.length) line('- 将执行：created_at 对齐单号日期（paid_at 空则补当日 12:00）')
}

/* ---------- D-05 经营指标（报告 + 排练开关） ---------- */
line('\n## D-05 经营指标现状（转化 / 复购 / 退款占比）')
{
  const m = await one(`SELECT
    COUNT(*) created,
    COALESCE(SUM(status BETWEEN 20 AND 70), 0) paid,
    COALESCE(SUM(status IN (40,50)), 0) done,
    (SELECT COUNT(DISTINCT user_id) FROM orders WHERE status IN (20,30,40,50)) payers,
    (SELECT COUNT(*) c FROM (SELECT user_id FROM orders WHERE status IN (20,30,40,50) GROUP BY user_id HAVING COUNT(*) > 1) t) rebuyers,
    (SELECT COALESCE(SUM(status IN (60,70)),0) FROM orders) refunded
    FROM orders`)
  const pct = (a, b) => (b ? Math.round(Number(a) / Number(b) * 1000) / 10 + '%' : '—')
  line(`- 下单 ${m.created} · 已支付以上 ${m.paid}（下单支付转化 ${pct(m.paid, m.created)}）`)
  line(`- 支付用户 ${m.payers} · 复购用户 ${m.rebuyers}（复购率 ${pct(m.rebuyers, m.payers)}）`)
  line(`- 退款单 ${m.refunded}（占全部订单 ${pct(m.refunded, m.created)}）`)
  line('- 修正路径（负责人拍板后执行）：优先重灌 demo-volume（FROM_AGE/VOL_TODAY 参数控制历史分布），使指标落在可讲解区间；脚本只做报告，不直接改写订单状态。')
  if (APPLY_D5) line('- 【--apply-d5】重灌属破坏性操作，请用 demo-volume-20261109.mjs 对隔离库重跑（本脚本不代做）。')
}

/* ---------- D-06 同游客同线路 1 小时多单 ---------- */
line('\n## D-06 同游客 1 小时内同线路多单')
{
  const dups = await q(`SELECT o.user_id, o.product_id, o.merchant_id, COUNT(*) c, MIN(o.order_no) keep_no,
    GROUP_CONCAT(o.order_no ORDER BY o.id SEPARATOR ',') nos
    FROM orders o WHERE o.status IN (10,20,30)
    GROUP BY o.user_id, o.product_id, o.merchant_id, FLOOR(UNIX_TIMESTAMP(o.created_at)/3600)
    HAVING c > 1 LIMIT 20`)
  line(`- 疑似测试残留组 ${dups.length} 组（每组保留最早一单，其余为重复）：${dups.slice(0, 3).map((d) => d.nos).join('；') || '无'}`)
  if (dups.length && APPLY) {
    for (const d of dups) {
      const rows = await q(`SELECT id, order_no, session_id, qty FROM orders
        WHERE user_id = ? AND product_id = ? AND merchant_id = ? AND status IN (10,20,30)
          AND FLOOR(UNIX_TIMESTAMP(created_at)/3600) = FLOOR(UNIX_TIMESTAMP((SELECT MIN(created_at) FROM (SELECT created_at FROM orders WHERE user_id = ? AND product_id = ? AND merchant_id = ? AND status IN (10,20,30)) x))/3600)
          AND order_no <> ?`, [d.user_id, d.product_id, d.merchant_id, d.user_id, d.product_id, d.merchant_id, d.keep_no]).catch(() => [])
      for (const r of rows) {
        await q("UPDATE orders SET status = 90, close_reason = 'demo-dup-cleanup', version = version + 1 WHERE id = ? AND status IN (10,20,30)", [r.id])
        if (r.session_id) await q('UPDATE tour_session SET booked = GREATEST(0, booked - ?) WHERE id = ?', [r.qty, r.session_id]).catch(() => {})
        await audit('d06-dup-close', 'order-' + r.id, { status: 20 }, { status: 90, reason: 'demo-dup-cleanup' })
      }
      line(`- ✅ 组 ${d.keep_no}：关闭重复单 ${rows.length} 笔并释放名额`)
    }
  } else if (dups.length) line('- 将执行：每组保留最早一单，其余置 90（demo-dup-cleanup）并回退团期 booked')
}

line('\n# 结束 · ' + (APPLY ? '修正已执行，请按核对清单逐项复查' : '本次为核对清单输出，未写库'))
if (!APPLY) line('# 执行：DB_NAME=<隔离库> node scripts/fix-demo-data-20261117.mjs --apply')
await closeDb()
