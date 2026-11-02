// 列表行内操作：风控处理、商户/预算/推广商状态等（V14 补齐的编辑能力）
// 普通脚本（非模块）：与 core.js 共享全局作用域，加载顺序见 index.html

// ── 后台编辑能力（V14 补齐）──
async function handleRisk(id) {
  try { await api('POST', '/admin/risk/' + id + '/handle', {}); toast('风控事件已标记处理'); risk() } catch (e) { toast(e.message, true) }
}
async function editMerchant(id) { return entityEditor('merchant', id, { onSaved: () => merchants() }) }
async function approveMerchant(id) {
  try { await api('POST', '/admin/merchants/' + id + '/approve', {}); toast('商户进件已通过'); merchants() } catch (e) { toast(e.message, true) }
}
async function toggleBudget(id, status) {
  try { await api('POST', '/admin/budgets/' + id + '/status', { status: status === 1 ? 0 : 1 }); toast(status === 1 ? '批次已停用' : '批次已启用'); budgets() } catch (e) { toast(e.message, true) }
}
async function togglePromoter(userId, status) {
  try { await api('POST', '/admin/promoters/' + userId + '/status', { status: status === 1 ? 0 : 1 }); toast(status === 1 ? '推广商已冻结' : '推广商已解冻'); promoters() } catch (e) { toast(e.message, true) }
}
async function changePromoterTier(userId, tier) {
  const newTier = prompt('请输入新档位（1=基础 5% / 2=优选 8% / 3=金牌 12%）：', tier)
  if (!newTier) return
  try { await api('POST', '/admin/promoters/' + userId + '/tier', { tier: Number(newTier) }); toast('档位已更新'); promoters() } catch (e) { toast(e.message, true) }
}
