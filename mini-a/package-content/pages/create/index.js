// 创作中心（小红书化改造）：发布与编辑迁至 compose 页，本页保留约稿任务/作品管理/举报申诉
const api = require('../../../utils/api')

Page({
  data: {
    notes: [], reports: [], loadError: '', appealNoteId: null, appealReason: '', appealBusy: false, appealMsg: '', tasks: { open: [], mine: [] },
    busy: false,
  },
  async onShow() { await this.fetch(); this.fetchTasks() },

  async fetch() {
    try {
      await api.ensureLogin()
      const [notes,reports]=await Promise.all([api.request('/c/notes'),api.request('/c/content-reports')])
      this.setData({loadError:'',notes:notes.map(n=>({...n,statusText:({0:'安全检测中',1:'人工审核中',2:'已发布',3:'未通过审核',4:'已下架'})[n.status]||'处理中',appealText:n.appeal_status==null?'':({0:'申诉复核中',1:'申诉通过，恢复展示',2:'申诉未通过，维持下架'})[n.appeal_status]})),reports:reports.map(r=>({...r,statusText:r.status===2&&r.note_status===2?'处理后经复核恢复展示':({0:'待处理',1:'举报不成立',2:'已处理下架'})[r.status]}))})
    } catch (e) {
      // A-18：失败必须给可重试的错误态；不展示假数据
      this.setData({ loadError: e.msg || '加载失败，请检查网络后重试', notes: [], reports: [] })
    }
  },
  openAppeal(e) {this.setData({appealNoteId:e.currentTarget.dataset.id,appealReason:'',appealMsg:''})},
  onAppealReason(e) {this.setData({appealReason:e.detail.value})},
  async submitAppeal() {
    if(this.data.appealBusy)return
    this.setData({appealBusy:true,appealMsg:''})
    try{const r=await api.request('/c/notes/'+this.data.appealNoteId+'/appeal','POST',{reason:this.data.appealReason});this.setData({appealNoteId:null,appealMsg:r.duplicate?'该次下架已有申诉记录':'申诉已提交，请等待复核'});await this.fetch()}
    catch(e){this.setData({appealMsg:e.msg||'提交失败，请重试'})}
    finally{this.setData({appealBusy:false})}
  },
  async fetchTasks() {
    try {
      const t = await api.request('/c/tasks')
      const TASK_ST = { 0: '待领取', 1: '创作中', 2: '审核中', 3: '已通过' }
      const metaText = (x) => [x.platforms && x.platforms.length ? x.platforms.join('/') : '', x.deadline ? '截止 ' + x.deadline : '', x.slotsLeft !== null && x.slotsLeft !== undefined ? '剩 ' + x.slotsLeft + ' 个名额' : ''].filter(Boolean).join(' · ')
      t.open = (t.open || []).map((x) => ({ ...x, metaText: metaText(x) }))
      t.mine = (t.mine || []).map((m) => ({ ...m, statusText: TASK_ST[m.status] || '待领取', metaText: metaText(m) }))
      this.setData({ tasks: t })
    } catch (e) {}
  },

  openTask(e) { wx.navigateTo({ url: '/package-content/pages/task/index?id=' + e.currentTarget.dataset.id }) },
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
  goCompose() { wx.navigateTo({ url: '/package-content/pages/compose/index' }) },
  editNote(e) {
    if (this.data.busy) return
    const n = this.data.notes.find(n => n.id === e.currentTarget.dataset.id)
    if (!n) return
    wx.navigateTo({ url: '/package-content/pages/compose/index?id=' + n.id })
  },
  goSquare() { wx.navigateTo({ url: '/package-content/pages/square/index' }) },
  onShareAppMessage() {
    return { title: '向往的自由 · 旅行笔记', path: '/pages/home/index' }
  },
  onShareTimeline() {
    return { title: '向往的自由 · 旅行笔记', query: '' }
  },
})
