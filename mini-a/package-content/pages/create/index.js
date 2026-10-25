const api = require('../../../utils/api')
Page({
  data: { notes: [], tasks: { open: [], mine: [] }, title: '', body: '', pubMsg: '' },
  onShow() { this.fetch(); this.fetchTasks() },
  async fetch() {
    try { await api.ensureLogin(); this.setData({ notes: await api.request('/c/notes') }) } catch (e) {}
  },
  async fetchTasks() {
    try {
      const t = await api.request('/c/tasks')
      const TASK_ST = { 0: '待领取', 1: '进行中', 2: '审核中', 3: '已完成' } // wxml 只取值，嵌套三元会炸分包（教训已付过学费）
      t.mine = (t.mine || []).map((m) => ({ ...m, statusText: TASK_ST[m.status] || '待领取' }))
      this.setData({ tasks: t })
    } catch (e) {}
  },
  async claim(e) {
    try {
      await api.request('/c/tasks/' + e.currentTarget.dataset.id + '/claim', 'POST', {})
      wx.showToast({ title: '已领取，去发布吧' })
      this.fetchTasks()
    } catch (err) { wx.showToast({ title: err.msg || '领取失败', icon: 'none' }) }
  },
  async submitTask(e) {
    const id = e.currentTarget.dataset.id
    const mine = this.data.tasks.mine.find((t) => t.id === id)
    const myNote = (this.data.notes || []).find((n) => n.user_id || true)
    if (!this.data.notes.length) return wx.showToast({ title: '先发布一篇笔记', icon: 'none' })
    try {
      await api.request('/c/tasks/' + id + '/submit', 'POST', { noteId: this.data.notes[0].id })
      wx.showToast({ title: '已提交审核' })
      this.fetchTasks()
    } catch (err) { wx.showToast({ title: err.msg || '提交失败', icon: 'none' }) }
  },
  goNote(e) { wx.navigateTo({ url: '/package-content/pages/note/index?id=' + e.currentTarget.dataset.id }) },
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
