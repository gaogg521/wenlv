# -*- coding: utf-8 -*-
import io
p = 'test/api-e2e.mjs'
s = io.open(p, encoding='utf-8').read()
old = "NOT IN ('rule_config','bean_global_cap','admin_user')"
assert old in s, 'anchor not found'
s = s.replace(old, "NOT IN ('rule_config','bean_global_cap','admin_user','faq')")
old2 = "  await dbx.q('UPDATE bean_global_cap SET issued_sum = 0 WHERE id = 1')"
assert old2 in s
s = s.replace(old2, old2 + """
  // V13 FAQ 种子（复位时如空则重建）
  const fqCount = (await dbx.q('SELECT COUNT(*) c FROM faq'))[0].c
  if (Number(fqCount) === 0) {
    await dbx.q("INSERT INTO faq (question, answer, sort) VALUES ('旅豆是什么？','旅豆是消费与活动的积分奖励，100 豆=10 元，下单可抵扣最多 10%，核销完成 24 小时后到账。',1), ('核销码怎么用？','入园时向商户出示「我的-订单」里的 6 位动态码或二维码，每 60 秒自动轮换，一码一次有效。',2), ('退款规则是什么？','出发前 7 天免费退；3-7 天收 10%；72 小时内收 30%；出发后不退。拼团未成团自动全额退款。',3)")
  }""")
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('phase1 seed ok')
