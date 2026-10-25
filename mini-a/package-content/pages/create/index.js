const api = require('../../../utils/api')
Page({
  data: { notes: [], title: '', body: '', pubMsg: '' },
  onShow() { this.fetch() },
  async fetch() {
    try { await api.ensureLogin(); this.setData({ notes: await api.request('/c/notes') }) } catch (e) {}
  },
  onTitle(e) { this.setData({ title: e.detail.value }) },
  onBody(e) { this.setData({ body: e.detail.value }) },
  async publish() {
    if (!this.data.body) return wx.showToast({ title: '写点什么吧', icon: 'none' })
    try {
      const r = await api.request('/c/notes', 'POST', { title: this.data.title, body: this.data.body })
      this.setData({ title: '', body: '', pubMsg: r.msg + (r.secMock ? '（联调机审直通）' : '') })
      this.fetch()
    } catch (e) { wx.showToast({ title: e.msg || '发布失败', icon: 'none' }) }
  },
  // 笔记转发：好友打开带笔记 id（详情页 P1 上线后直达）
  onShareAppMessage() {
    return { title: '向往的自由 · 旅行笔记', path: '/pages/home/index' }
  },
  onShareTimeline() {
    return { title: '向往的自由 · 旅行笔记', query: '' }
  },
})
