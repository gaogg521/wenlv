const api = require('../../../utils/api')

const LEVELS = ['探索者', '旅行家', '城市探索官', '环球探索家']
const PASS_STATUS = { 1: '待使用', 2: '已核销' }
// 兜底词表：接口不可用时用这套，保证页面只出现「可信记录 / 校验码」口径的用语
const LEX_FALLBACK = {
  did: '文旅数字身份', pass: '权益凭证', attest_list: '可信记录流水',
  note: '记录仅用于权益与贡献核算', ledger_sealed: '今日账本已封存',
}

Page({
  data: { d: null, lex: LEX_FALLBACK, loadTxt: '加载中…' },
  onShow() { this.fetch() },
  async fetch() {
    try {
      await api.ensureLogin()
      // 术语从后端字典取（一处定义、多端分发），页面里不硬写专业术语
      const lex = await api.request('/c/lexicon').catch(() => LEX_FALLBACK)
      const d = await api.request('/c/identity')
      // 层级名与凭证状态在 JS 里算好：WXML 绑定表达式里写
      // ['探索者',...][d.profile.memberLevel-1] 这种「数组字面量 + 下标表达式」会让分包编译失败
      if (d && d.profile) {
        d.profile.levelName = LEVELS[d.profile.memberLevel - 1] || '探索者'
      }
      if (d && Array.isArray(d.passes)) {
        d.passes = d.passes.map((p) => Object.assign({}, p, {
          statusText: PASS_STATUS[p.status] || '已作废',
        }))
      }
      const ownedCount = (d.badges || []).filter((b) => b.owned).length
      this.setData({ d, ownedCount, lex: Object.assign({}, LEX_FALLBACK, lex || {}), loadTxt: '' })
    } catch (e) { this.setData({ loadTxt: e.msg || '暂时无法加载，请稍后重试' }) }
  },
  showBadge(e) {
    const b = this.data.d.badges[Number(e.currentTarget.dataset.i)]
    const plain = String(b.description || '').replace(/<[^>]+>/g, '').trim()
    const lines = [plain, b.ruleDesc ? '获得方式：' + b.ruleDesc : '', b.owned ? '获得于 ' + String(b.granted_at).slice(0, 10) + (b.expireAt ? '，有效至 ' + b.expireAt : '') : '尚未获得']
    wx.showModal({ title: b.name + ' · ' + b.rarityLabel, content: lines.filter(Boolean).join('\n'), showCancel: false, confirmText: '知道了' })
  },
})
