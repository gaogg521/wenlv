// UGC 创作页：富文本编辑器（标题/粗体/斜体/列表/引用/换行）+ 实时预览
const api = require('../../../utils/api')

Page({
  data: {
    blockViews: [], notes: [], reports: [], loadError: '', appealNoteId: null, appealReason: '', appealBusy: false, appealMsg: '', tasks: { open: [], mine: [] },
    title: '', bodyHtml: '', bodyText: '', relatedProductId: null, relatedName: '',
    pubMsg: '', editId: null, revision: null, busy: false, showPreview: false, formats: {},
  },
  async onShow() { await this.fetch(); this.fetchTasks() },

  async fetch() {
    try {
      await api.ensureLogin()
      const [notes,reports]=await Promise.all([api.request('/c/notes'),api.request('/c/content-reports')])
      this.setData({loadError:'',notes:notes.map(n=>({...n,statusText:({0:'安全检测中',1:'人工审核中',2:'已发布',3:'未通过审核',4:'已下架'})[n.status]||'处理中',appealText:n.appeal_status==null?'':({0:'申诉复核中',1:'申诉通过，恢复展示',2:'申诉未通过，维持下架'})[n.appeal_status]})),reports:reports.map(r=>({...r,statusText:r.status===2&&r.note_status===2?'处理后经复核恢复展示':({0:'待处理',1:'举报不成立',2:'已处理下架'})[r.status]}))})
    } catch (e) {
      // A-18：失败必须给可重试的错误态（此前 loadError 从不赋值，重试按钮永远出不来）；不展示假数据
      this.setData({ loadError: e.msg || '加载失败，请检查网络后重试', blockViews: [], notes: [], reports: [] })
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
  editorCall(method, options = {}) {
    if (!this.editor) return Promise.reject({msg:'编辑器尚未就绪，请重试'})
    return new Promise((success,fail)=>this.editor[method]({...options,success,fail}))
  },
  readBlocks(html) {
    const blocks=[]
    const addText=value=>{
      const cleaned=value.replace(/^\s*(?:<\/p>|<\/div>)/,'').replace(/<(p|div)>\s*(?:<br\s*\/?>)?<\/\1>/gi,'')
      if (cleaned.replace(/<[^>]+>|&nbsp;|\s/g,'')) blocks.push({type:'text',html:cleaned})
    }
    let at=0
    const markers=/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>|【视频：([^】]+)】/gi
    for (const match of html.matchAll(markers)) {
      addText(html.slice(at,match.index).replace(/<(?:p|div)>\s*$/i,''))
      const url=match[1] ? this.imageUploads?.get(match[1].replace(/&amp;/g,'&')) : match[2]
      if (!url || (match[2] && !this.videoUploads?.has(url))) throw {msg:'粘贴的媒体需通过工具栏导入'}
      blocks.push({type:match[1]?'image':'video',url})
      at=match.index+match[0].length
    }
    addText(html.slice(at))
    return blocks
  },
  async togglePreview() {
    if (this.data.showPreview) return this.setData({showPreview:false})
    try {
      const {html}=await this.editorCall('getContents')
      const blocks=this.readBlocks(html)
      this.setData({blockViews:blocks.map(b=>b.url?{...b,src:api.img(b.url)}:b),showPreview:true})
    } catch(e) { wx.showToast({title:e.msg || '无法预览，请重试',icon:'none'}) }
  },
  loadArticle(blocks) {
    this.imageUploads=new Map()
    this.videoUploads=new Set()
    const html=blocks.map(b=>{
      if (b.type==='text') return b.html
      if (b.type==='video') {
        this.videoUploads.add(b.url)
        return '<p>【视频：'+b.url+'】</p>'
      }
      const src=api.img(b.url)
      this.imageUploads.set(src,b.url)
      return '<p><img src="'+src.replace(/"/g,'&quot;')+'"></p>'
    }).join('')
    return this.editorCall('setContents',{html})
  },

  async editNote(e) {
    if (this.data.busy || this.data.uploading) return
    const id = e.currentTarget.dataset.id
    if (this.data.bodyText.trim() || this.data.bodyHtml) {
      const answer = await new Promise(resolve => wx.showModal({ title: '切换到编辑作品？', content: '当前未提交的内容将被替换。', success: resolve, fail: () => resolve({}) }))
      if (!answer.confirm) return
    }
    this.setData({ busy: true })
    try {
      if (!this.editor) throw { msg: '编辑器尚未就绪，请重试' }
      const n = await api.request('/c/notes/' + id + '/edit')
      const blocks = n.blocks || [
        ...(n.text ? [{type:'text',html:n.text}] : []),
        ...(n.video ? [{type:'video',url:n.video}] : []),
        ...n.images.map(url=>({type:'image',url}))
      ]
      await this.loadArticle(blocks)
      this.setData({editId:id,revision:n.revision,title:n.title || '',bodyHtml:'',bodyText:'',
        relatedProductId:n.relatedProductId,relatedName:n.relatedName || '',pubMsg:'',showPreview:false})
      wx.pageScrollTo({ scrollTop:0 })
    } catch (e) { wx.showToast({ title:e.msg || '作品加载失败',icon:'none' }) }
    finally { this.setData({ busy:false }) }
  },
  resetEditor() {
    this.setData({ editId:null,revision:null,title:'',bodyHtml:'',bodyText:'',
      relatedProductId:null,relatedName:'',showPreview:false,formats:{} })
    this.imageUploads=new Map()
    this.videoUploads=new Set()
    this.setData({blockViews:[]})
    if (this.editor) this.editor.clear()
  },
  cancelEdit() {
    wx.showModal({ title:'取消编辑？',content:'本次修改不会保存。',success:r=>{if(r.confirm)this.resetEditor()} })
  },
  async publish() {
    if (this.data.busy) return
    if (this.data.uploading) return wx.showToast({ title:'媒体上传中',icon:'none' })
    this.setData({ busy:true })
    try {
      const {html}=await this.editorCall('getContents')
      const blocks=this.readBlocks(html)
      if (blocks.filter(b=>b.type==='text').map(b=>b.html.replace(/<[^>]+>/g,'').trim()).join('').length < 4) {
        return wx.showToast({title:'至少写 4 个字',icon:'none'})
      }
      await api.ensureLogin()
      const {editId,revision,title,relatedProductId}=this.data
      const r = await api.request(editId ? '/c/notes/'+editId : '/c/notes',editId ? 'PUT' : 'POST',
        {title,blocks,relatedProductId,revision})
      this.resetEditor()
      this.setData({ pubMsg:r.msg+(r.secMock && r.status===2?'（联调机审直通）':'') })
      await this.fetch()
    } catch (e) { wx.showToast({ title:e.msg || '提交失败',icon:'none' }) }
    finally { this.setData({busy:false}) }
  },
  pickVideo() { this.pickMedia('video') },
  pickImage() { this.pickMedia('image') },
  pickMedia(type) {
    if (this.data.uploading || this.data.busy) return
    wx.chooseMedia({count:1,mediaType:[type],sizeType:['compressed'],maxDuration:30,
      success:r=>this.insertMediaFiles(type,r.tempFiles)})
  },
  async insertMediaFiles(type, files) {
    if (this.data.uploading || this.data.busy) return
    this.setData({uploading:true})
    try {
      await api.ensureLogin()
      for (const f of files) await this.uploadAndInsert(type,f)
    } catch(e) { wx.showToast({title:e.msg || '媒体插入失败',icon:'none'}) }
    finally { this.setData({uploading:false}) }
  },
  async uploadAndInsert(type,f) {
    const blocks=this.readBlocks((await this.editorCall('getContents')).html)
    const count=blocks.filter(b=>b.type===type).length
    if (count >= (type==='video'?1:9)) throw {msg:type==='video'?'每篇最多一段视频':'每篇最多九张图片'}
    if (type==='video' && (f.size>8*1024*1024 || f.duration>30)) throw {msg:'请选择 30 秒、8 MB 内的视频'}
    const fs=wx.getFileSystemManager()
    const data=fs.readFileSync(f.tempFilePath,'base64')
    const sig=data.slice(0,8)
    const ext=sig.startsWith('iVBOR')?'png':sig.startsWith('UklGR')?'webp':'jpg'
    const up=await api.request('/c/upload/note-'+type,'POST',{data,ext})
    if (type==='video') {
      this.videoUploads ||= new Set()
      this.videoUploads.add(up.url)
      await this.editorCall('insertText',{text:'\n【视频：'+up.url+'】\n'})
    } else {
      const src=api.img(up.url)
      this.imageUploads ||= new Map()
      this.imageUploads.set(src,up.url)
      await this.editorCall('insertImage',{src,alt:'文章图片',width:'100%'})
    }
  },
  onlineMedia() {
    if (this.data.busy || this.data.uploading) return
    wx.showActionSheet({itemList:['在线图片','在线 MP4 视频'],success:r=>{
      wx.showModal({title:'输入 HTTPS 媒体直链',editable:true,placeholderText:'https://…',success:v=>{
        if(v.confirm) this.importOnline(v.content.trim(),r.tapIndex===0?'image':'video')
      }})
    }})
  },
  async importOnline(url,type) {
    if (this.data.uploading || this.data.busy) return
    this.setData({uploading:true})
    try {
      await api.ensureLogin()
      await this.importMediaFile(url,type)
    } catch(e) { wx.showToast({title:e.msg || '下载失败，检查媒体链接和域名',icon:'none'}) }
    finally { this.setData({uploading:false}) }
  },
  async importMediaFile(url,type) {
    if (!/^https:\/\/[^\s]+$/i.test(url)) throw {msg:'仅支持 HTTPS 媒体直链'}
    const file=await new Promise((resolve,reject)=>wx.downloadFile({url,success:r=>{
      if(r.statusCode===200) resolve(r.tempFilePath)
      else reject({msg:'媒体下载失败'})
    },fail:reject}))
    const stat=wx.getFileSystemManager().statSync(file)
    if(stat.size>(type==='video'?8:2)*1024*1024) throw {msg:'媒体文件超过大小限制'}
    await this.uploadAndInsert(type,{tempFilePath:file,size:stat.size})
  },
  async copyArticle() {
    try {
      const {html}=await this.editorCall('getContents')
      const portable=this.readBlocks(html).map(b=>b.type==='text'?b.html:
        '<'+(b.type==='image'?'img':'video')+' src="'+api.img(b.url)+'">').join('')
      wx.setClipboardData({data:portable})
    } catch(e) { wx.showToast({title:e.msg || '复制失败',icon:'none'}) }
  },
  async pasteArticle() {
    if(this.data.busy || this.data.uploading) return
    this.setData({uploading:true})
    try {
      const {data}=await new Promise((success,fail)=>wx.getClipboardData({success,fail}))
      const parts=data.split(/(<(?:img|video)\b[^>]*\bsrc=["'][^"']+["'][^>]*>)/gi)
      await api.ensureLogin()
      for (const part of parts) {
        const media=part.match(/^<(img|video)\b[^>]*\bsrc=["']([^"']+)["']/i)
        if (media) {
          const [,tag,url]=media,type=tag.toLowerCase()==='img'?'image':'video'
          if (type==='image' && this.imageUploads?.has(url)) await this.editorCall('insertImage',{src:url,alt:'文章图片',width:'100%'})
          else if (type==='video' && url.startsWith(api.img('/uploads/')) && this.videoUploads?.has(url.slice(api.img('/').length-1))) {
            const blocks=this.readBlocks((await this.editorCall('getContents')).html)
            if (blocks.some(b=>b.type==='video')) throw {msg:'每篇最多一段视频，请先删除原视频标记'}
            await this.editorCall('insertText',{text:'\n【视频：'+url.slice(api.img('/').length-1)+'】\n'})
          } else await this.importMediaFile(url,type)
        } else if (part) {
          const text=parts.length>1 || /<\/?(?:p|div|strong|h[1-6])\b/i.test(part)
            ? part.replace(/<\/?(?:p|div|h[1-6]|br)\b[^>]*>/gi,'\n').replace(/<[^>]+>/g,'')
            : part
          await this.editorCall('insertText',{text})
        }
      }
    } catch(e) { wx.showToast({title:e.msg || '粘贴失败，请检查剪贴板和媒体域名',icon:'none'}) }
    finally {this.setData({uploading:false})}
  },
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
