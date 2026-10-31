const api = require('../../../utils/api')

const LEVELS = ['探索者', '旅行家', '城市探索官', '环球探索家']
const PASS_STATUS = { 1: '待使用', 2: '已核销' }
// 兜底词表：接口不可用时用这套，保证页面永不出现「存证 / 链 / Web3 / NFT / Token」等词
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
      // 术语从后端字典取（一处定义、三处分发），页面里不硬写任何链上字眼
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
      this.setData({ d, lex: Object.assign({}, LEX_FALLBACK, lex || {}), loadTxt: '' })
    } catch (e) { this.setData({ loadTxt: e.msg || '暂时无法加载，请稍后重试' }) }
  },
})
