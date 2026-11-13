// UGC 创作页：富文本编辑器（标题/粗体/斜体/列表/引用/换行）+ 实时预览
const api = require('../../../utils/api')

Page({
  data: {
    notes: [], reports: [], loadError: '', appealNoteId: null, appealReason: '', appealBusy: false, appealMsg: '', tasks: { open: [], mine: [] },
    title: '', bodyHtml: '', bodyText: '', images: [], relatedProductId: null, relatedName: '',
    pubMsg: '', video: '', videoSrc: '', imageUrls: [], editId: null, revision: null, busy: false, showPreview: false, formats: {},
  },
  async onShow() { await this.fetch(); this.fetchTasks() },

  async fetch() {
    try {
      await api.ensureLogin()
      const [notes,reports]=await Promise.all([api.request('/c/notes'),api.request('/c/content-reports')])
      this.setData({loadError:'',notes:notes.map(n=>({...n,statusText:({0:'安全检测中',1:'人工审核中',2:'已发布',3:'未通过审核',4:'已下架'})[n.status]||'处理中',appealText:n.appeal_status==null?'':({0:'申诉复核中',1:'申诉通过，恢复展示',2:'申诉未通过，维持下架'})[n.appeal_status]})),reports:reports.map(r=>({...r,statusText:r.status===2&&r.note_status===2?'处理后经复核恢复展示':({0:'待处理',1:'举报不成立',2:'已处理下架'})[r.status]}))})
    } catch (e) {
      // A-18：失败必须给可重试的错误态（此前 loadError 从不赋值，重试按钮永远出不来）；不展示假数据
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
      t.mine = (t.mine || []).map((m) => ({ ...m, statusText: TASK_ST[m.status] || '待领取' }))
      this.setData({ tasks: t })
    } catch (e) {}
  },

  openTask(e) { wx.navigateTo({ url: '/package-content/pages/task/index?id=' + e.currentTarget.dataset.id }) },
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

  setImages(images) {
    this.setData({ images, imageUrls: images.map(api.img) })
  },
  async editNote(e) {
    if (this.data.busy || this.data.uploading) return
    const id = e.currentTarget.dataset.id
    if (this.data.bodyText.trim() || this.data.images.length || this.data.video) {
      const answer = await new Promise(resolve => wx.showModal({ title: '切换到编辑作品？', content: '当前未提交的内容将被替换。', success: resolve, fail: () => resolve({}) }))
      if (!answer.confirm) return
    }
    this.setData({ busy: true })
    try {
      if (!this.editor) throw { msg: '编辑器尚未就绪，请重试' }
      const n = await api.request('/c/notes/' + id + '/edit')
      await new Promise((resolve,reject) => this.editor.setContents({ html: n.text, success: resolve, fail: reject }))
      this.setData({ editId:id, revision:n.revision,title:n.title || '',bodyHtml:n.text,
        bodyText:n.text.replace(/<[^>]+>/g,' '),relatedProductId:n.relatedProductId,relatedName:n.relatedName || '',
        video:n.video || '',videoSrc:api.img(n.video),pubMsg:'',showPreview:false })
      this.setImages(n.images)
      wx.pageScrollTo({ scrollTop:0 })
    } catch (e) { wx.showToast({ title:e.msg || '作品加载失败',icon:'none' }) }
    finally { this.setData({ busy:false }) }
  },
  resetEditor() {
    this.setData({ editId:null,revision:null,title:'',bodyHtml:'',bodyText:'',video:'',videoSrc:'',
      relatedProductId:null,relatedName:'',showPreview:false,formats:{} })
    this.setImages([])
    if (this.editor) this.editor.clear()
  },
  cancelEdit() {
    wx.showModal({ title:'取消编辑？',content:'本次修改不会保存。',success:r=>{if(r.confirm)this.resetEditor()} })
  },
  async publish() {
    if (this.data.busy) return
    if (!this.data.bodyHtml || this.data.bodyText.trim().length < 4) return wx.showToast({ title:'至少写 4 个字',icon:'none' })
    if (this.data.uploading) return wx.showToast({ title:'媒体上传中',icon:'none' })
    this.setData({ busy:true })
    try {
      await api.ensureLogin()
      const {editId,revision,title,bodyHtml,images,video,relatedProductId} = this.data
      const r = await api.request(editId ? '/c/notes/'+editId : '/c/notes',editId ? 'PUT' : 'POST',
        {title,body:bodyHtml,images,video,relatedProductId,revision})
      this.resetEditor()
      this.setData({ pubMsg:r.msg+(r.secMock && r.status===2?'（联调机审直通）':'') })
      await this.fetch()
    } catch (e) { wx.showToast({ title:e.msg || '提交失败',icon:'none' }) }
    finally { this.setData({busy:false}) }
  },
  pickVideo() {
    if (this.data.uploading || this.data.busy) return
    wx.chooseMedia({count:1,mediaType:['video'],sourceType:['album','camera'],maxDuration:30,
      success:async r=>{
        const f=r.tempFiles[0]
        if (!f || f.size > 8*1024*1024 || f.duration > 30) return wx.showToast({title:'请选择 30 秒、8 MB 内的视频',icon:'none'})
        this.setData({uploading:true})
        try {
          await api.ensureLogin()
          const data=wx.getFileSystemManager().readFileSync(f.tempFilePath,'base64')
          const up=await api.request('/c/upload/note-video','POST',{data})
          this.setData({video:up.url,videoSrc:api.img(up.url)})
        } catch(e) { wx.showToast({title:e.msg || '视频上传失败',icon:'none'}) }
        finally { this.setData({uploading:false}) }
      } })
  },
  removeVideo() { if (!this.data.busy && !this.data.uploading) this.setData({video:'',videoSrc:''}) },

  // A-43：配图上传（chooseMedia → /c/upload/note-image → 版本文件名 URL）
  pickImage() {
    if (this.data.uploading || this.data.busy || this.data.images.length >= 9) return
    wx.chooseMedia({ count: 9 - this.data.images.length, mediaType: ['image'], sizeType: ['compressed'],
      success: async (r) => {
        this.setData({ uploading: true })
        try {
          await api.ensureLogin()
          for (const f of r.tempFiles) {
            const b64 = wx.getFileSystemManager().readFileSync(f.tempFilePath, 'base64')
            const ext = (f.tempFilePath.split('.').pop() || 'jpg').toLowerCase() === 'png' ? 'png' : 'jpg'
            const up = await api.request('/c/upload/note-image', 'POST', { data: b64, ext })
            this.setImages(this.data.images.concat(up.url))
          }
        } catch (e) { wx.showToast({ title: e.msg || '图片上传失败', icon: 'none' }) }
        finally { this.setData({ uploading: false }) }
      } })
  },
  removeImage(e) { const i = Number(e.currentTarget.dataset.i); if (!this.data.busy && !this.data.uploading) this.setImages(this.data.images.filter((x, k) => k !== i)) },
  pickProduct() {
    api.getTours('all').then((list) => {
      wx.showActionSheet({ alertText: '关联到哪条线路？', itemList: list.slice(0, 6).map((x) => x.title),
        success: (tap) => { const p = list[tap.tapIndex]; this.setData({ relatedProductId: p.id, relatedName: p.title }) }, fail: () => {} })
    }).catch(() => wx.showToast({ title: '线路加载失败', icon: 'none' }))
  },
  goSquare() { wx.navigateTo({ url: '/package-content/pages/square/index' }) },
  onShareAppMessage() {
    return { title: '向往的自由 · 旅行笔记', path: '/pages/home/index' }
  },
  onShareTimeline() {
    return { title: '向往的自由 · 旅行笔记', query: '' }
  },
})
