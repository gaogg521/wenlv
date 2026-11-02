// 退改梯度单元测试（纯函数，不碰数据库）
import assert from 'node:assert/strict'
import { parsePolicy, quote, describe, daysBetween } from '../src/domain/refund-policy.mjs'

let pass = 0
const t = (name, fn) => { try { fn(); pass++; console.log('  ✓', name) } catch (e) { console.log('  ✗', name, '\n    ', e.message); process.exitCode = 1 } }
const P = '{"d7":0.0,"d3":0.10,"d1":0.30}'
const at = (today, depart, amt = 29800) => quote({ policy: P, amountPayFen: amt, departDate: depart, today })

console.log('== 退改梯度 ==')
t('日历天数', () => { assert.equal(daysBetween('2026-11-02', '2026-11-09'), 7); assert.equal(daysBetween('2026-12-31', '2027-01-01'), 1) })
t('≥7 天：免手续费，全额', () => { const q = at('2026-11-02', '2026-11-09'); assert.equal(q.rate, 0); assert.equal(q.refundFen, 29800); assert.equal(q.feeFen, 0) })
t('边界 6 天落入 10% 档', () => { const q = at('2026-11-02', '2026-11-08'); assert.equal(q.rate, 0.1); assert.equal(q.feeFen, 2980); assert.equal(q.refundFen, 26820) })
t('边界 3 天仍是 10%', () => assert.equal(at('2026-11-02', '2026-11-05').rate, 0.1))
t('2 天 → 30%', () => { const q = at('2026-11-02', '2026-11-04'); assert.equal(q.feeFen, 8940); assert.equal(q.refundFen, 20860) })
t('1 天 → 30%', () => assert.equal(at('2026-11-02', '2026-11-03').rate, 0.3))
t('出发当天：不允许自助退款', () => { const q = at('2026-11-02', '2026-11-02'); assert.equal(q.allowed, false); assert.match(q.reason, /不足 1 天/) })
t('已出发：不允许', () => assert.match(at('2026-11-05', '2026-11-02').reason, /已出发/))
t('手续费四舍五入到分，退款+手续费=实付', () => { const q = at('2026-11-02', '2026-11-04', 9999); assert.equal(q.feeFen + q.refundFen, 9999); assert.equal(q.feeFen, 3000) })
t('实付 0（全旅豆抵扣）也可退，手续费 0', () => { const q = at('2026-11-02', '2026-11-04', 0); assert.equal(q.allowed, true); assert.equal(q.refundFen, 0) })
t('配置 d0 后当天可退', () => assert.equal(quote({ policy: '{"d3":0,"d0":0.5}', amountPayFen: 100, departDate: '2026-11-02', today: '2026-11-02' }).feeFen, 50))
t('100% 档位不允许自助退款', () => assert.equal(quote({ policy: '{"d1":1}', amountPayFen: 100, departDate: '2026-11-03', today: '2026-11-02' }).allowed, false))
t('配置对象形式（JSON 列）也能解析', () => assert.equal(parsePolicy({ d7: 0, d1: 0.3 }).length, 2))
t('非法配置直接报错，不按 0 放行', () => {
  assert.throws(() => parsePolicy('{"d7":1.5}')); assert.throws(() => parsePolicy('{"x7":0.1}'))
  assert.throws(() => parsePolicy('{"d7":"abc"}')); assert.throws(() => parsePolicy('{}'))
})
t('游客说明文案', () => {
  assert.deepEqual(describe(P), ['出发前 7 天及以上：免手续费，全额退款', '出发前 3~6 天：收取实付金额 10% 手续费',
    '出发前 1~2 天：收取实付金额 30% 手续费', '出发前不足 1 天：不支持自助退款，可联系客服'])
})
console.log(`\n${pass} 项通过${process.exitCode ? '，有失败' : ''}`)
