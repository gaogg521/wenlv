const api = require('../../utils/api')
// 本单分账比例：新结算单出账时锁定了比例（split_snapshot，单位万分比）；
// 比例快照上线前生成的旧单没有记录，按各栏金额占订单总额推算并注明
function splitInfo(s) {
  let sp = s.split_snapshot
  if (typeof sp === 'string') { try { sp = JSON.parse(sp) } catch (e) { sp = null } }
  const pct = (v) => (Math.round(v * 10) / 10) + '%'
  const t = Number(s.total_amount)
  if (!(t > 0)) return { hasSnapshot: !!(sp && sp.fulfill != null), splitNote: '', splitText: '' } // 只有退改手续费、没有订单的单子不显示比例
  if (sp && sp.fulfill != null) {
    return { hasSnapshot: true, splitNote: '本单比例（出账时锁定）',
      splitText: '履约 ' + pct(sp.fulfill / 100) + ' · 服务费 ' + pct(sp.service / 100) + ' · 权益 ' + pct(sp.beanbudget / 100) }
  }
  return { hasSnapshot: false, splitNote: '本单比例（按金额推算）',
    splitText: '履约 ' + pct(s.amt_fulfill / t * 100) + ' · 服务费 ' + pct(s.amt_service / t * 100) + ' · 权益 ' + pct(s.amt_beanbudget / t * 100) }
}
// 同一周出过账后又有新订单时会出补充单，周期形如 2026-W45-2
function periodTitle(p) {
  const m = /^(.*W\d{2})-(\d+)$/.exec(String(p || ''))
  return m ? m[1] + ' 周结算单（补充 ' + m[2] + '）' : p + ' 周结算单'
}
Page({
  data: { list: [], visibleList: [], loaded: false, detail: {}, expanded: {}, state: 'all', filters: [{k:'all',n:'全部账单'},{k:'pending',n:'待确认'},{k:'processing',n:'处理中'},{k:'paid',n:'已登记回单'}] },
  filterState(e) { this.setData({state:e.currentTarget.dataset.k}); this.applyFilter() },
  applyFilter() { this.setData({visibleList:this.data.list.filter(s=>this.data.state==='all' || this.data.state==='pending' && s.status===0 || this.data.state==='paid' && s.status===3 || this.data.state==='processing' && [1,2,4].includes(s.status))}) },
  toggleBill(e) { const id=e.currentTarget.dataset.id; this.setData({['expanded.'+id]:!this.data.expanded[id]}) },
  // 展开/收起结算单订单明细（对账逐单可查）
  async toggleDetail(e) {
    const id = e.currentTarget.dataset.id
    if (this.data.detail[id]) return this.setData({ ['detail.' + id]: null })
    try {
      const s = await api.request('/m/settlements/' + id)
      const items = (s.items || []).map(it => ({ ...it, amountText: (Number(it.amount_pay) / 100).toFixed(2) }))
      this.setData({ ['detail.' + id]: items })
    } catch (err) { wx.showToast({ title: err.msg || '加载失败', icon: 'none' }) }
  },
  onShow() { this.fetch() },
  fetch() {
    if (!getApp().globalData.token) { this.setData({ loaded: true, list: [], visibleList: [] }); return }
    api.request('/m/settlements').then((l) => { const list=l.map(s => ({ ...s, ...splitInfo(s), totalLabel:(Number(s.total_amount)/100).toFixed(2), periodTitle: periodTitle(s.period), statusText: ['待确认', '待财务复核', '待实际支付', '已登记支付回单', '异议处理中'][s.status],
      // 应结 = 履约结算 + 退改手续费分成（分成比例生成时快照，见后台参数中心/商户资料）
      payableLabel: ((Number(s.amt_fulfill) + Number(s.fee_merchant || 0)) / 100).toFixed(2),
      feeShareText: s.fee_share_bp != null ? (Number(s.fee_share_bp) / 100) + '%' : '—',
      // WXML 红线：算术插值（除法/百分比）全部在 JS 预计算，防 NaN 与静默炸分包
      totalText: (Number(s.total_amount) / 100).toFixed(2),
      pctFulfill: Number(s.total_amount) > 0 ? (Number(s.amt_fulfill) / Number(s.total_amount) * 100).toFixed(2) : 0,
      pctService: Number(s.total_amount) > 0 ? (Number(s.amt_service) / Number(s.total_amount) * 100).toFixed(2) : 0,
      pctPromoter: Number(s.total_amount) > 0 ? (Number(s.amt_promoter) / Number(s.total_amount) * 100).toFixed(2) : 0,
      pctBean: Number(s.total_amount) > 0 ? (Number(s.amt_beanbudget) / Number(s.total_amount) * 100).toFixed(2) : 0,
      pctRetained: Number(s.total_amount) > 0 ? (Number(s.amt_retained) / Number(s.total_amount) * 100).toFixed(2) : 0,
      fulfillText: (Number(s.amt_fulfill) / 100).toFixed(2),
      serviceText: (Number(s.amt_service) / 100).toFixed(2),
      promoterText: (Number(s.amt_promoter) / 100).toFixed(2),
      beanText: (Number(s.amt_beanbudget) / 100).toFixed(2),
      retainedText: (Number(s.amt_retained) / 100).toFixed(2),
      feeTotalText: (Number(s.fee_total) / 100).toFixed(2),
      feeMerchantText: (Number(s.fee_merchant) / 100).toFixed(2) }));this.setData({list,loaded:true,error:'',pendingCount:list.filter(s=>s.status===0).length,pendingAmount:list.filter(s=>s.status===0).reduce((sum,s)=>sum+Number(s.payableLabel),0).toFixed(2)});this.applyFilter() }).catch(e => this.setData({ loaded: true, error: e.msg || '加载失败，请重试' }))
  },
  dispute(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({ title: '发起结算异议', editable: true, placeholderText: '请填写订单、金额差异和原因', success: async r => {
      if (!r.confirm || !r.content || !r.content.trim()) return
      try { await api.request('/m/settlements/' + id + '/dispute', 'POST', { note: r.content.trim() }); this.fetch() }
      catch (e) { wx.showToast({ title: e.msg || '提交失败', icon: 'none' }) }
    } })
  },
  // 商户确认结算（待确认 → 已确认，财务复核后完成）
  confirm(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '确认结算单', content: '确认本期对账无误？确认后进入财务复核打款流程。',
      success: (r) => {
        if (!r.confirm) return
        api.request('/m/settlements/' + id + '/confirm', 'POST', {}).then(() => {
          wx.showToast({ title: '已确认，待财务复核' })
          this.fetch()
        }).catch((err) => wx.showToast({ title: err.msg || '确认失败', icon: 'none' }))
      },
    })
  },
})
