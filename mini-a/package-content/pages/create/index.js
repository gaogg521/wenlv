// 创作中心（小红书化改造）：发布与编辑迁至 compose 页，本页保留约稿任务/作品管理/举报申诉
const api = require('../../../utils/api')

Page({
  data: {
    notes: [], worksCols: [[], [], []], workFilter: 'all', worksEmpty: false, workTabs: [
      { k: 'all', name: '全部' }, { k: '2', name: '已发布' }, { k: '01', name: '审核中' }, { k: '3', name: '未通过' }, { k: '4', name: '已下架' },
    ],
    reports: [], loadError: '', appealNoteId: null, appealReason: '', appealBusy: false, appealMsg: '', tasks: { open: [], mine: [] },
    busy: false,
  },
  async onShow() { await this.fetch(); this.fetchTasks() },

  async fetch() {
    try {
      await api.ensureLogin()
      const [notes,reports]=await Promise.all([api.request('/c/notes'),api.request('/c/content-reports')])
      const decorated=notes.map(n=>({...n,statusText:({0:'机审中',1:'人工审核中',2:'已发布',3:'未通过',4:'已下架'})[n.status]||'处理中',
        badgeClass:({2:'ok',3:'bad',4:'off'})[n.status]||'ing',
        cover:n.cover||'',coverChar:(n.title||'无题').slice(0,2),hasVideo:!!n.hasVideo,
        appealText:n.appeal_status==null?'':({0:'申诉复核中',1:'申诉通过，恢复展示',2:'申诉未通过，维持下架'})[n.appeal_status]}))
      this.setData({loadError:'',notes:decorated,reports:reports.map(r=>({...r,statusText:r.status===2&&r.note_status===2?'处理后经复核恢复展示':({0:'待处理',1:'举报不成立',2:'已处理下架'})[r.status]}))})
      this.applyWorkFilter()
    } catch (e) {
      // A-18：失败必须给可重试的错误态；不展示假数据
      this.setData({ loadError: e.msg || '加载失败，请检查网络后重试', notes: [], reports: [] })
    }
  },
  // 我的作品：三列网格 + 状态筛选（数据全在 JS 预计算，wxml 只取值）
  applyWorkFilter() {
    const f = this.data.workFilter
    const shown = this.data.notes.filter(n => f === 'all' || (f === '01' ? [0, 1].includes(n.status) : n.status === Number(f)))
    const cols = [[], [], []]
    shown.forEach((n, i) => cols[i % 3].push(n))
    // 驳回/下架原因默认折叠只展示最近 1 条，根治原因卡把页面撑长
    const rejectTips = this.data.notes.filter(n => (n.status === 3 && n.reject_reason) || (n.status === 4 && (n.offline_reason || n.appealText)))
    this.rejectTips = rejectTips
    this.setData({ worksCols: cols, worksEmpty: shown.length === 0, ...this.rejectSlice() })
  },
  rejectSlice() {
    const tips = this.rejectTips || []
    const showAll = this.data.rejectShowAll
    return { rejectTips: tips, rejectShown: showAll ? tips : tips.slice(0, 1), rejectHidden: showAll ? 0 : Math.max(0, tips.length - 1) }
  },
  toggleRejectTips() { this.setData({ rejectShowAll: !this.data.rejectShowAll, ...this.rejectSlice() }) },
  onWorkFilter(e) { this.setData({ workFilter: e.currentTarget.dataset.k }); this.applyWorkFilter() },
  openWork(e) {
    const n = this.data.notes.find(n => n.id === e.currentTarget.dataset.id)
    if (!n) return
    if (n.status === 2) return wx.navigateTo({ url: '/package-content/pages/note/index?id=' + n.id })
    wx.navigateTo({ url: '/package-content/pages/compose/index?id=' + n.id })
  },
  onWorkLongPress(e) {
    const id = e.currentTarget.dataset.id
    const n = this.data.notes.find(n => n.id === id)
    if (!n) return
    const items = ['编辑作品']
    if (n.status === 2) items.push('查看详情')
    if (n.can_appeal) items.push('申请复核')
    wx.showActionSheet({ itemList: items, success: r => {
      if (items[r.tapIndex] === '编辑作品') wx.navigateTo({ url: '/package-content/pages/compose/index?id=' + id })
      else if (items[r.tapIndex] === '查看详情') wx.navigateTo({ url: '/package-content/pages/note/index?id=' + id })
      else if (items[r.tapIndex] === '申请复核') this.setData({ appealNoteId: id, appealReason: '', appealMsg: '' })
    } })
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
