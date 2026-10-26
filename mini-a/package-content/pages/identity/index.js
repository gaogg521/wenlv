const api = require('../../../utils/api')

const LEVELS = ['探索者', '旅行家', '城市探索官', '环球探索家']
const PASS_STATUS = { 1: '待使用', 2: '已核销' }

Page({
  data: { d: null, loadTxt: '加载中…' },
  onShow() { this.fetch() },
  async fetch() {
    try {
      await api.ensureLogin()
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
      this.setData({ d, loadTxt: '' })
    } catch (e) { this.setData({ loadTxt: e.msg || '暂时无法加载，请稍后重试' }) }
  },
})
