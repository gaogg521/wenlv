// UGC 创作页：富文本编辑器（标题/粗体/斜体/列表/引用/换行）+ 实时预览
const api = require('../../../utils/api')

Page({
  data: {
    notes: [], tasks: { open: [], mine: [] },
    title: '', bodyHtml: '', bodyText: '',
    pubMsg: '', showPreview: false,
  },
  onShow() { this.fetch(); this.fetchTasks() },

  async fetch() {
    try { await api.ensureLogin(); this.setData({ notes: await api.request('/c/notes') }) } catch (e) {}
  },
  async fetchTasks() {
    try {
      const t = await api.request('/c/tasks')
      const TASK_ST = { 0: '待领取', 1: '进行中', 2: '审核中', 3: '已完成' }
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
    if (!this.data.notes.length) return wx.showToast({ title: '先发布一篇笔记', icon: 'none' })
    try {
      await api.request('/c/tasks/' + id + '/submit', 'POST', { noteId: this.data.notes[0].id })
      wx.showToast({ title: '已提交审核' })
      this.fetchTasks()
    } catch (err) { wx.showToast({ title: err.msg || '提交失败', icon: 'none' }) }
  },

  goNote(e) { wx.navigateTo({ url: '/package-content/pages/note/index?id=' + e.currentTarget.dataset.id }) },
  onTitle(e) { this.setData({ title: e.detail.value }) },

  // ── 富文本编辑器：textarea 输入时同步 bodyHtml + bodyText ──
  onBodyInput(e) {
    const html = e.detail.value
    const text = html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
    this.setData({ bodyHtml: html, bodyText: text })
  },

  // ── 工具栏：在光标处插入 HTML 标签 ──
  rtCmd(e) {
    const tag = e.currentTarget.dataset.tag
    const textarea = this.selectComponent('#bodyInput')
    if (!textarea) return
    const start = textarea.data.selectionStart || 0
    const end = textarea.data.selectionEnd || start
    const before = this.data.bodyHtml.substring(0, start)
    const sel = this.data.bodyHtml.substring(start, end) || '文字'
    const after = this.data.bodyHtml.substring(end)

    let wrap = ''
    if (tag === 'h2') wrap = '<h2>' + sel + '</h2>'
    else if (tag === 'b') wrap = '<b>' + sel + '</b>'
    else if (tag === 'i') wrap = '<i>' + sel + '</i>'
    else if (tag === 'ul') wrap = '<ul><li>' + sel + '</li></ul>'
    else if (tag === 'quote') wrap = '<blockquote>' + sel + '</blockquote>'
    else if (tag === 'br') wrap = '<br/>'
    else if (tag === 'h3') wrap = '<h3>' + sel + '</h3>'
    else wrap = sel

    const newHtml = before + wrap + after
    const text = newHtml.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ')
    this.setData({ bodyHtml: newHtml, bodyText: text })
    textarea.setData({ value: newHtml })
  },

  togglePreview() {
    this.setData({ showPreview: !this.data.showPreview })
  },

  async publish() {
    if (!this.data.bodyHtml || this.data.bodyText.length < 4) return wx.showToast({ title: '至少写 4 个字', icon: 'none' })
    try {
      // 存 HTML 原文；列表展示用纯文本
      const r = await api.request('/c/notes', 'POST', { title: this.data.title, body: this.data.bodyHtml })
      this.setData({ title: '', bodyHtml: '', bodyText: '', pubMsg: r.msg + (r.secMock ? '（联调机审直通）' : '') })
      this.fetch()
    } catch (e) { wx.showToast({ title: e.msg || '发布失败', icon: 'none' }) }
  },

  onShareAppMessage() {
    return { title: '向往的自由 · 旅行笔记', path: '/pages/home/index' }
  },
  onShareTimeline() {
    return { title: '向往的自由 · 旅行笔记', query: '' }
  },
})
