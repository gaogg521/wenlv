const api = require('../../utils/api')
const fmt = (c) => (c.reverse ? '不高于 ' + c.need + c.unit : '达到 ' + c.need + c.unit)
Page({
  data: { d: null, groups: [], proofRecords: [], ownedCount: 0, total: 0, crit: [], active: 'level', tabs: [{k:'level',n:'经营等级'},{k:'badges',n:'等级勋章'},{k:'proof',n:'可信凭证'}], loadTxt: '加载中…' },
  onLoad(q) { if (q && ['level','badges','proof'].includes(q.tab)) this.setData({ active: q.tab }) },
  switchTab(e) { this.setData({ active: e.currentTarget.dataset.k }); wx.pageScrollTo({scrollTop:0,duration:0}) },
  onShow() { this.fetch() },
  onPullDownRefresh() { this.fetch().then(() => wx.stopPullDownRefresh()) },
  async fetch() {
    if (!getApp().globalData.token) return this.setData({ d: null, proofRecords: [], loadTxt: '请先在「我的」绑定门店' })
    try {
      const d = await api.request('/m/honor')
      d.badges = d.badges.map(b => Object.assign({}, b, { proofState: b.proof ? ({0:'等待封存',1:'已封存 · 待确认',2:'已确认',3:'处理中',4:'待人工核对',5:'已提交 · 待确认'})[b.proof.status] || '记录已生成' : '暂无可信记录' }))
      const next = d.level.next
      // 距下一级的逐项差距：进度条宽度与"还差多少"在 JS 里算好，WXML 里不写复杂表达式
      const crit = next ? next.criteria.map((c) => {
        const pct = c.reverse ? (c.ok ? 100 : 0) : Math.max(0, Math.min(100, Math.floor(c.cur / (c.need || 1) * 100)))
        return Object.assign({}, c, { pct, text: c.label + ' ' + c.cur + c.unit + ' / ' + fmt(c) })
      }) : []
      const groups = (d.groups || []).map((g) => {
        const items = d.badges.filter((b) => b.category === g.key).sort((x, y) => String(x.series).localeCompare(String(y.series)) || (x.tier - y.tier) || (x.order - y.order))
        return { key: g.key, label: g.label, items, got: items.filter((b) => b.owned).length }
      }).filter((g) => g.items.length)
      d.level.levels = d.level.levels.map((l) => Object.assign({}, l, {
        needText: l.lv === 1 ? '入驻即享' : '订单 ' + l.need.orders + ' · 评价 ' + l.need.reviews + (l.need.rating ? ' · 评分 ' + l.need.rating : '') + (l.need.refundPct < 100 ? ' · 退款率 ≤' + l.need.refundPct + '%' : ''),
        perkText: (l.perks || []).join(' · '),
      }))
      d.level.ratingText = d.level.metrics.reviews ? ' · 评分 ' + (d.level.metrics.rating10 / 10) : ''
      const proofRecords = d.badges.filter(b => b.owned).map(b => Object.assign({},b,{dateLabel:String(b.granted_at || '').slice(0,10)}))
      this.setData({ d, groups, crit, proofRecords, ownedCount: d.badges.filter((b) => b.owned).length, total: d.badges.length, loadTxt: '' })
      if (d.fresh && d.fresh.length) wx.showModal({ title: '获得新徽章', content: '恭喜点亮「' + d.fresh.join('」「') + '」', showCancel: false, confirmText: '好的' })
    } catch (e) { this.setData({ d: null, proofRecords: [], loadTxt: e.msg || '暂时无法加载，请稍后重试' }) }
  },
  showBadge(e) {
    const b = this.data.d.badges.find((x) => Number(x.id) === Number(e.currentTarget.dataset.id))
    if (!b) return
    const lines = [b.description, b.ruleDesc ? '获得方式：' + b.ruleDesc : '',
      !b.owned && b.progress ? '当前进度 ' + b.progress.cur + '/' + b.progress.need : '',
      b.proof ? '记录编号 ' + b.proof.code + '（' + b.proofState + '）' : '',
      b.owned ? '获得于 ' + String(b.granted_at).slice(0, 10) : '尚未获得']
    wx.showModal({ title: b.name + ' · ' + b.rarityLabel, content: lines.filter(Boolean).join('\n'), showCancel: false, confirmText: '知道了' })
  },
  goProof(e) { const code = e.currentTarget.dataset.code; wx.navigateTo({ url: '/pages/proof/index' + (code ? '?code=' + encodeURIComponent(code) : '') }) },
  copyProof(e) { const code = e.currentTarget.dataset.code; if (code) wx.setClipboardData({data:String(code)}) },
})
