// UGC 创作页：富文本编辑器（标题/粗体/斜体/列表/引用/换行）+ 实时预览
const api = require('../../../utils/api')

Page({
  data: {
    notes: [], tasks: { open: [], mine: [] },
    title: '', bodyHtml: '', bodyText: '',
    pubMsg: '', showPreview: false, formats: {},
  },
  async onShow() { await this.fetch(); this.fetchTasks() },

  async fetch() {
    try { await api.ensureLogin(); this.setData({ notes: (await api.request('/c/notes')).map(n => ({ ...n, statusText: ({0:'安全检测中',1:'人工审核中',2:'已发布',3:'未通过审核'})[n.status] || '处理中' })) }) } catch (e) {}
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
    const choices = this.data.notes.filter(n => n.status === 2)
    if (!choices.length) return wx.showToast({ title: '先发布一篇笔记', icon: 'none' })
    const choice = await new Promise(resolve => wx.showActionSheet({ itemList: choices.map(n => n.title || '未命名笔记'), success: r => resolve(r.tapIndex), fail: () => resolve(null) }))
    if (choice === null) return
    try {
      await api.request('/c/tasks/' + id + '/submit', 'POST', { noteId: choices[choice].id })
      wx.showToast({ title: '已提交审核' })
      this.fetchTasks()
    } catch (err) { wx.showToast({ title: err.msg || '提交失败', icon: 'none' }) }
  },

  goNote(e) { const n = this.data.notes.find(n => n.id === e.currentTarget.dataset.id); if (n && n.status !== 2) return wx.showToast({ title: n.statusText, icon: 'none' }); wx.navigateTo({ url: '/package-content/pages/note/index?id=' + e.currentTarget.dataset.id }) },
  onTitle(e) { this.setData({ title: e.detail.value }) },

  onEditorReady() {
    this.createSelectorQuery().select('#bodyEditor').context(r => { this.editor = r.context }).exec()
  },
  onEditorStatus(e) { this.setData({ formats: e.detail }) },
  onEditorInput(e) { this.setData({ bodyHtml: e.detail.html, bodyText: e.detail.text }) },
  rtCmd(e) {
    if (!this.editor) return
    const tag = e.currentTarget.dataset.tag
    const formats = { h2: ['header', 2], h3: ['header', 3], b: ['bold', !this.data.formats.bold], i: ['italic', !this.data.formats.italic], ul: ['list', 'bullet'], quote: ['indent', '+1'] }
    if (tag === 'br') this.editor.insertText({ text: '\n' })
    else if (formats[tag]) this.editor.format(...formats[tag])
  },
  togglePreview() {
    this.setData({ showPreview: !this.data.showPreview })
  },

  async publish() {
    if (!this.data.bodyHtml || this.data.bodyText.length < 4) return wx.showToast({ title: '至少写 4 个字', icon: 'none' })
    try {
      await api.ensureLogin()
      // 存 HTML 原文；列表展示用纯文本
      const r = await api.request('/c/notes', 'POST', { title: this.data.title, body: this.data.bodyHtml })
      this.setData({ title: '', bodyHtml: '', bodyText: '', pubMsg: r.msg + (r.secMock ? '（联调机审直通）' : '') })
      if (this.editor) this.editor.clear()
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
