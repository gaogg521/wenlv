// 列表行内操作：风控处理、商户/预算/推广商状态等（V14 补齐的编辑能力）
// 普通脚本（非模块）：与 core.js 共享全局作用域，加载顺序见 index.html

// ── 后台编辑能力（V14 补齐）──
// 风控事件处理（T12）：必须填结论；复杂处置用「升级为案件」走完整案件闭环
async function handleRisk(id) {
  modal('处理风控事件 · #' + id, `
    <p class="td-sub">处理结论必填并进入审计；需要多步处置/复核的复杂场景请改用「升级为案件」。</p>
    <div class="field"><label>处理结论 *（4–200 字）</label><input id="rkReason" maxlength="200"></div>
    <div id="rkErr" class="td-sub" style="color:var(--red)"></div>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="handleRiskSubmit(${id})">确认处理</button>`)
}
window.handleRiskSubmit = async (id) => {
  try {
    await api('POST', '/admin/risk/' + id + '/handle', { reason: ($('#rkReason').value || '').trim() })
    closeModal(); toast('风控事件已处理'); risk()
  } catch (e) { $('#rkErr').textContent = e.message }
}
// 事件升级为风险案件（T12）：事件标记已处理，处置走案件状态机
window.caseFromEvent = (eventId, userId) => {
  caseCreateModal({ sourceType: 'risk_event', sourceId: eventId, userId: userId || '' })
  const el = document.getElementById('rcTitle')
  if (el) el.value = '风控事件 #' + eventId + ' 处置'
}
async function editMerchant(id) { return entityEditor('merchant', id, { onSaved: () => merchants() }) }
async function approveMerchant(id) {
  const r = await uiConfirm({ title: '商户进件审批通过', target: '商户 #' + id, impact: '通过后商户状态改为「生效」，可正常维护商品与接单', confirmText: '审批通过' })
  if (!r.ok) return
  try { await api('POST', '/admin/merchants/' + id + '/approve', {}); toast('商户进件已通过'); merchants() } catch (e) { toast(e.message, true) }
}
async function toggleBudget(id, status) {
  const off = status === 1
  const r = await uiConfirm({ title: off ? '停用旅豆预算批次' : '启用旅豆预算批次', target: '预算批次 #' + id, changes: [{ label: '批次状态', from: off ? '生效' : '停用', to: off ? '停用' : '生效' }], impact: off ? '停用后不能再从该批次发放旅豆' : '启用后恢复从该批次发放旅豆', danger: off, confirmText: off ? '确认停用' : '确认启用' })
  if (!r.ok) return
  try { await api('POST', '/admin/budgets/' + id + '/status', { status: status === 1 ? 0 : 1 }); toast(status === 1 ? '批次已停用' : '批次已启用'); budgets() } catch (e) { toast(e.message, true) }
}
async function togglePromoter(userId, status) {
  const freeze = status === 1
  const r = await uiConfirm({ title: freeze ? '冻结推广服务商' : '解冻推广服务商', target: '推广商（用户）#' + userId, changes: [{ label: '资金账号状态', from: freeze ? '生效' : '冻结', to: freeze ? '冻结' : '生效' }], impact: freeze ? '冻结后不再计提新佣金，提现入口一并暂停' : '解冻后恢复佣金计提与提现', needReason: true, reasonPlaceholder: freeze ? '冻结原因（必填，记入审计）' : '解冻依据（必填，记入审计）', danger: freeze, confirmText: freeze ? '确认冻结' : '确认解冻' })
  if (!r.ok) return
  try { await api('POST', '/admin/promoters/' + userId + '/status', { status: status === 1 ? 0 : 1, reason: r.reason }); toast(status === 1 ? '推广商已冻结' : '推广商已解冻'); promoters() } catch (e) { toast(e.message, true) }
}
async function changePromoterTier(userId, tier) {
  const r = await uiConfirm({ title: '推广商调档', target: '推广商（用户）#' + userId, changes: [{ label: '当前档位', from: ['', '基础 5%', '优选 8%', '金牌 12%'][tier] || tier, to: '按下方输入' }], impact: '档位 1=基础 5% / 2=优选 8% / 3=金牌 12%，调整后新成交按新档位计佣', needReason: true, reasonPlaceholder: '输入新档位，如「2 = 优选 8%」', confirmText: '确认调档' })
  if (!r.ok) return
  const newTier = parseInt(r.reason, 10)
  if (![1, 2, 3].includes(newTier)) return toast('档位无效：请输入 1 / 2 / 3', true)
  try { await api('POST', '/admin/promoters/' + userId + '/tier', { tier: Number(newTier) }); toast('档位已更新'); promoters() } catch (e) { toast(e.message, true) }
}
