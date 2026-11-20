// M-12：三端统一「修改二次确认」封装（mini-a 版；mini-b/utils/confirm.js 参数同构）。
// - confirmAsk：A 级直接确认——标题=动作，content=对象/旧→新/影响范围，按钮用具体文案（wx.showModal confirmText 上限 4 字）。
// - confirmReason：需要原因的输入框（A+ 高危：金额变动超 ±30%、批量超 5 条、资金类、停用账号等）。
// - confirmChange：A/A+ 通用入口——先展示变更明细确认，needReason 时再强制填原因；resolve({ok, reason})。
function confirmAsk({ title, content, confirmText = '确认', cancelText = '取消', danger = false } = {}) {
  return new Promise((resolve) => {
    wx.showModal({
      title: title || '请确认',
      content: content || '',
      confirmText: String(confirmText || '确认').slice(0, 4),
      cancelText,
      confirmColor: danger ? '#c0392b' : '#e87722',
      success: (r) => resolve(!!r.confirm),
      fail: () => resolve(false),
    })
  })
}

function confirmReason({ title = '填写原因', placeholder = '请填写原因（至少 2 个字，必填）' } = {}) {
  return new Promise((resolve) => {
    wx.showModal({
      title, editable: true, placeholderText: placeholder,
      success: (r) => {
        if (!r.confirm) return resolve(null)
        const reason = String(r.content || '').trim()
        if (reason.length < 2) { wx.showToast({ title: '原因至少 2 个字', icon: 'none' }); return resolve(null) }
        resolve(reason)
      },
      fail: () => resolve(null),
    })
  })
}

/** A/A+ 统一入口：展示「动作 + 对象 + 旧→新 + 影响范围」确认；needReason=true 时必须填原因才能提交。 */
function confirmChange({ title, target, changes = [], impact, needReason = false, confirmText = '确认', danger = false } = {}) {
  const lines = []
  if (target) lines.push(target)
  for (const c of changes) lines.push((c.label ? c.label + '：' : '') + c.from + ' → ' + c.to)
  if (impact) lines.push(impact)
  return confirmAsk({ title, content: lines.join('\n'), confirmText, danger }).then((ok) => {
    if (!ok) return { ok: false, reason: '' }
    if (!needReason) return { ok: true, reason: '' }
    return confirmReason().then((reason) => (reason ? { ok: true, reason } : { ok: false, reason: '' }))
  })
}

module.exports = { confirmAsk, confirmReason, confirmChange }
