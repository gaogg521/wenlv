// 小红书式发布页：先选图（九宫格）→ 编辑（图集轮播 + 缩略图条拖拽排序 + 标题 + 正文 + 话题 + 关联线路/景区 + 可见范围）→ 发布
// 与旧版图文混排的差异：图片/视频独立于正文（图库模型），正文为纯文本块，服务端天然兼容。
// 三期新增：可见范围（公开/私密）；云草稿（本地即时存 + 云端防丢，发布成功双清）；素材长按拖拽排序；AI 排版建议（guide）落地
// WXML 铁律：只做取值与单三元，全部逻辑在此预计算。
const api = require('../../../utils/api')
const { GUIDE_STYLES, renderGuide, suggestTitle } = require('./guide-card')

const HOT_TOPICS = ['亲子出游', '周末遛娃', '小众路线', '露营日记', '美食探店', '古镇漫步', '山水风光', '人文历史']

Page({
  data: {
    title: '', titleLen: 0, bodyText: '', bodyHtml: '', confirmTitle: false,
    showGallery: false, showGuide: false, guideBusy: false, guideImage: '', guideHeight: 960,
    guideTitle: '', guideText: '', guidePhoto: '', guideStyle: 0,
    guideStyles: GUIDE_STYLES.map((style, index) => ({ ...style, selected: index === 0 })),
    topics: [], hotTopics: HOT_TOPICS, showTopicSheet: false,
    images: [], video: null, coverIndex: 0, current: 0,
    hasMedia: false, canAddMore: true, mediaLabel: '', coverKey: '',
    relatedProductId: null, relatedName: '',
    visibility: 'public',           // 可见范围（三期 V88）：public=进广场 private=仅自己
    visPublicOn: true, visPrivateOn: false, // wxml 不做等值比较（铁律），预计算进 data
    scenicId: null, scenicName: '', // 关联景区（三期话题聚合）
    editId: null, revision: null, textMode: false, loaded: false,
    uploadingCount: 0, hasFailed: false, barHint: '', canPublish: false, bodyLen: 0,
    formats: {}, busy: false, publishLabel: '发布',
    // ✨ 写作建议（AI 看图成文）
    showIdeas: false, writingIntent: '', visionBusy: false, visionError: '', visionResult: null, canIdeas: false,
    // 本地草稿 + 云草稿（三期 V89）
    draftRestored: false, cloudDraftId: null, cloudDraftRevision: null, cloudSavedAt: '',
    // 拖拽排序（三期）：thumb 条状态
    thumbs: [], dragging: false, dragIndex: -1, dragOverIndex: -1,
    // 视频剪辑（Codex 素材线）+ 实况照片
    videoEdit: null, veBusy: false, livePhotos: [], coverUrl: '',
  },

  onLoad(q) {
    this.seq = 0
    this.plainLenValue = 0 // 正文纯文本长度（editor 是唯一事实源，编辑回填也能正确计数）
    this.imageUploads = new Map() // src → /uploads 原始路径（预览渲染用）
    this.mediaAccess = new Map()  // /uploads 路径 → 带 ticket 的可读 URL（私密预览）
    if (q && q.id) { this.setData({ editId: Number(q.id), publishLabel: '保存并提交审核' }) }
    this.startGuide = q && q.guide === '1'
    if (q && q.draftId) { this.cloudDraftId = Number(q.draftId) } // 从创作中心云草稿进入
  },
  onReady() {
    if (this.data.editId) this.loadForEdit()
    else if (this.cloudDraftId) this.loadCloudDraft(this.cloudDraftId)
    else if (this.startGuide) this.openGuide()
    else if (!this.maybeRestoreDraft()) this.pickImages()
  },
  onHide() {
    if (this.data.editId || this._published) return
    const hasText = this.data.title || this.plainLenValue > 0 || this.data.topics.length
    const hasMedia = this.data.images.length || this.data.video
    if (hasText || hasMedia) {
      this.saveLocalDraft()
      this.syncCloudDraft()
    }
  },

  /* ---------- 本地草稿（文字 + 媒体引用；图片临时路径会失效，不保存） ---------- */
  draftSnapshot() {
    return { title: this.data.title, bodyHtml: this.data.bodyHtml,
      topics: this.data.topics, relatedProductId: this.data.relatedProductId, relatedName: this.data.relatedName,
      visibility: this.data.visibility, scenicId: this.data.scenicId, scenicName: this.data.scenicName, at: Date.now() }
  },
  saveLocalDraft() {
    try { wx.setStorageSync('xhs-compose-draft', this.draftSnapshot()) } catch (e) { /* 存储失败静默 */ }
  },
  maybeRestoreDraft() {
    let d = null
    try { d = wx.getStorageSync('xhs-compose-draft') } catch (e) { d = null }
    if (!d || (!d.title && !d.bodyHtml && !(d.topics || []).length)) return false
    wx.showModal({ title: '检测到未发布的草稿', content: '是否恢复上次编辑的文字？', confirmText: '恢复', cancelText: '不恢复',
      success: r => {
        if (r.confirm) {
          this.pendingHtml = d.bodyHtml || ''
          this.plainLenValue = this.plainLen(this.pendingHtml)
          this.setData({ title: d.title || '', titleLen: (d.title || '').length, topics: d.topics || [],
            relatedProductId: d.relatedProductId || null, relatedName: d.relatedName || '',
            visibility: d.visibility === 'private' ? 'private' : 'public',
            visPublicOn: d.visibility !== 'private', visPrivateOn: d.visibility === 'private',
            scenicId: d.scenicId || null, scenicName: d.scenicName || '',
            loaded: true, textMode: true, draftRestored: true })
          if (this.editor && this.pendingHtml) { this.editor.setContents({ html: this.pendingHtml }); this.pendingHtml = '' }
          this.refresh()
        } else {
          try { wx.removeStorageSync('xhs-compose-draft') } catch (e) { /* 忽略 */ }
          this.pickImages()
        }
      } })
    return true
  },
  clearLocalDraft() { try { wx.removeStorageSync('xhs-compose-draft') } catch (e) { /* 忽略 */ } },

  /* ---------- 云草稿（三期 V89）：onHide 防丢同步 + 创作中心列表进入 + 发布成功双清 ---------- */
  cloudContent() {
    return { title: String(this.data.title || ''), blocks: [{ type: 'text', html: String(this.data.bodyHtml || '') }],
      topics: this.data.topics, visibility: this.data.visibility, scenicId: this.data.scenicId,
      relatedProductId: this.data.relatedProductId, coverKey: this.data.coverKey,
      images: this.data.images.filter(x => x.url).map(x => x.url), video: this.data.video && this.data.video.url ? this.data.video.url : null }
  },
  async syncCloudDraft() {
    if (this.data.busy || this._cloudSyncing) return
    this._cloudSyncing = true
    try {
      await api.ensureLogin()
      const body = { content: this.cloudContent() }
      if (this.data.cloudDraftId != null) { body.id = this.data.cloudDraftId; body.revision = this.data.cloudDraftRevision }
      const r = await api.request('/c/note-drafts', 'POST', body)
      this.setData({ cloudDraftId: r.id, cloudDraftRevision: r.revision, cloudSavedAt: '已云存档' })
    } catch (e) { /* 云端失败不影响本地草稿；不打断编辑 */ }
    finally { this._cloudSyncing = false }
  },
  async loadCloudDraft(id) {
    this.setData({ busy: true })
    try {
      await api.ensureLogin()
      const d = await api.request('/c/note-drafts/' + id)
      const content = d.content || {}
      this.setData({ cloudDraftId: d.id, cloudDraftRevision: d.revision })
      // 云草稿里已上传过的媒体直接按 URL 恢复（无需重新上传）
      const images = (content.images || []).map(u => {
        const src = this.accessUrl(u)
        return { key: 'm' + (++this.seq), kind: 'image', src, uploading: false, failed: false, url: u }
      })
      const video = content.video ? { key: 'm' + (++this.seq), kind: 'video', src: this.accessUrl(content.video), uploading: false, failed: false, url: content.video } : null
      this.pendingHtml = String(content.blocks?.map(b => b.type === 'text' ? b.html : '').join('') || '')
      this.plainLenValue = this.plainLen(this.pendingHtml)
      if (this.editor && this.pendingHtml) { this.editor.setContents({ html: this.pendingHtml }); this.pendingHtml = '' }
      this.setData({ title: content.title || '', titleLen: (content.title || '').length,
        topics: Array.isArray(content.topics) ? content.topics : [],
        visibility: content.visibility === 'private' ? 'private' : 'public',
        visPublicOn: content.visibility !== 'private', visPrivateOn: content.visibility === 'private',
        scenicId: content.scenicId || null, scenicName: '', relatedProductId: content.relatedProductId || null, relatedName: '',
        images, video, coverIndex: Math.min(Number(content.coverIndex) || 0, Math.max(images.length - 1, 0)),
        loaded: true, textMode: !images.length && !video, bodyText: '', draftRestored: true })
      if (content.scenicId) this.lookupScenicName(content.scenicId)
      this.refresh()
    } catch (e) {
      wx.showToast({ title: e.msg || '云草稿加载失败', icon: 'none' })
      this.cloudDraftId = null
      this.setData({ loaded: true })
    } finally { this.setData({ busy: false }) }
  },
  async lookupScenicName(id) {
    try {
      const list = await api.request('/c/note-scenics?kw=')
      const hit = list.find(x => Number(x.id) === Number(id))
      if (hit) this.setData({ scenicName: hit.name })
    } catch (e) { /* 名称取不到不影响编辑 */ }
  },

  /* ---------- 可见范围（三期 V88） ---------- */
  setVisibility(e) {
    const v = e.currentTarget.dataset.v
    if (v !== 'public' && v !== 'private') return
    if (v === 'private') {
      wx.showModal({ title: '设为私密笔记？', content: '仅自己可见，不会出现在广场和话题里。', success: r => { if (r.confirm) this.applyVisibility('private') } })
    } else this.applyVisibility('public')
  },
  applyVisibility(v) { this.setData({ visibility: v, visPublicOn: v === 'public', visPrivateOn: v === 'private' }) },

  /* ---------- 关联景区（三期话题聚合） ---------- */
  pickScenic() {
    wx.showModal({ title: '关联景区', editable: true, placeholderText: '输入景区关键字，如 朱家角', success: r => {
      const kw = String(r.content || '').trim()
      if (!r.confirm) return
      api.request('/c/note-scenics?kw=' + encodeURIComponent(kw)).then(list => {
        if (!list.length) return wx.showToast({ title: '没找到匹配的景区', icon: 'none' })
        const names = list.slice(0, 6).map(x => x.name + (x.city_code ? ' · ' + x.city_code : '')).concat('不关联景区')
        wx.showActionSheet({ alertText: '选择景区', itemList: names, success: tap => {
          if (tap.tapIndex >= Math.min(list.length, 6)) this.setData({ scenicId: null, scenicName: '' })
          else { const s = list[tap.tapIndex]; this.setData({ scenicId: s.id, scenicName: s.name }) }
        } })
      }).catch(e => wx.showToast({ title: e.msg || '景区查询失败', icon: 'none' }))
    } })
  },

  /* ---------- 媒体选择与上传 ---------- */
  pickImages() {
    if (this.data.video) return wx.showToast({ title: '视频与图片不能混用，请先删除视频', icon: 'none' })
    const left = 9 - this.data.images.filter(x => !x.video).length
    if (left <= 0) return wx.showToast({ title: '最多九张图片', icon: 'none' })
    wx.chooseMedia({ count: left, mediaType: ['image'], sizeType: ['compressed'],
      success: r => this.enqueue(r.tempFiles.filter(f => !f.fileType || f.fileType === 'image'), 'image'),
      fail: () => { if (!this.data.loaded) this.setData({ loaded: true }) } })
  },
  pickVideo() {
    const start = () => wx.chooseMedia({ count: 1, mediaType: ['video'], maxDuration: 30,
      success: r => {
        const f = r.tempFiles[0]
        if (!f || (f.fileType && f.fileType !== 'video')) return
        if (f.size > 8 * 1024 * 1024 || (f.duration || 0) > 31) return wx.showToast({ title: '请选 30 秒、8 MB 内的视频', icon: 'none' })
        if (this.data.images.length) {
          wx.showModal({ title: '视频与图片二选一', content: '选择视频将清空已选图片', success: m => { if (m.confirm) { this.setData({ images: [], coverIndex: 0, current: 0 }); this.enqueue([f], 'video') } } })
        } else this.enqueue([f], 'video')
      },
      fail: () => { if (!this.data.loaded) this.setData({ loaded: true }) } })
    if (this.data.video) {
      wx.showModal({ title: '替换视频？', content: '当前视频将被移除。', success: m => { if (m.confirm) { this.setData({ video: null }); start() } } })
    } else start()
  },
  skipMedia() { this.setData({ textMode: true, loaded: true }); this.refresh() },

  // 选择后立即逐张上传，不阻塞文字编辑（小红书同款体验）
  async enqueue(files, type) {
    this.setData({ loaded: true })
    const items = files.map(f => ({ key: 'm' + (++this.seq), kind: type, src: f.tempFilePath, uploading: true, failed: false, url: null, size: f.size || 0 }))
    if (type === 'video') this.setData({ video: items[0] })
    else this.setData({ images: this.data.images.concat(items) })
    this.bump(items.length)
    this.refresh()
    for (const it of items) {
      try { await this.uploadItem(it) } catch (e) { this.markFailed(it.key, e) }
      this.bump(-1)
    }
    this.refresh()
  },
  bump(d) { this.setData({ uploadingCount: Math.max(0, this.data.uploadingCount + d) }) },
  async uploadItem(it) {
    if (it.kind === 'image' && it.size > 2 * 1024 * 1024) throw { msg: '图片超过 2MB，请重新选择' }
    const fs = wx.getFileSystemManager()
    const data = fs.readFileSync(it.src, 'base64')
    const sig = data.slice(0, 8)
    const ext = it.kind === 'video' ? 'mp4' : sig.startsWith('iVBOR') ? 'png' : sig.startsWith('UklGR') ? 'webp' : 'jpg'
    await api.ensureLogin()
    const up = await api.request('/c/upload/note-' + it.kind, 'POST', { data, ext })
    if (it.kind === 'image') this.imageUploads.set(it.src, up.url)
    if (up.access) this.mediaAccess.set(up.url, up.access) // 带 ticket 的可读 URL（私密预览用）
    this.patchItem(it.key, { uploading: false, failed: false, url: up.url })
    this.refresh()
  },
  // /uploads 路径 → 预览 URL：优先带 media ticket（门禁下私密素材可读），退回普通 API 前缀
  accessUrl(path) {
    const ticket = this.mediaAccess.get(path)
    if (ticket) return api.img(ticket)
    return api.img(path)
  },
  patchItem(key, patch) {
    if (this.data.video && this.data.video.key === key) return this.setData({ video: { ...this.data.video, ...patch } })
    this.setData({ images: this.data.images.map(x => x.key === key ? { ...x, ...patch } : x) })
  },
  markFailed(key, e) {
    this.patchItem(key, { uploading: false, failed: true })
    if (e && e.msg) wx.showToast({ title: e.msg, icon: 'none' })
  },
  retryItem(e) {
    const key = e.currentTarget.dataset.key
    const it = this.data.images.find(x => x.key === key) || this.data.video
    if (!it) return
    this.patchItem(key, { uploading: true, failed: false })
    this.bump(1)
    this.uploadItem(it).catch(err => this.markFailed(key, err)).finally(() => this.bump(-1))
  },
  removeImage(e) {
    const key = e.currentTarget.dataset.key
    const idx = this.data.images.findIndex(x => x.key === key)
    if (idx < 0) return
    const removedUrl = this.data.images[idx].url
    const images = this.data.images.filter(x => x.key !== key)
    if (removedUrl) this.setData({ livePhotos: this.data.livePhotos.filter(p => p.photo !== removedUrl) })
    let coverIndex = this.data.coverIndex
    if (idx < coverIndex) coverIndex--
    else if (idx === coverIndex) coverIndex = 0
    this.setData({ images, coverIndex, showGallery: this.data.showGallery && images.length > 0, current: Math.min(this.data.current, Math.max(images.length - 1, 0)) })
    this.refresh()
  },
  removeVideo() { this.setData({ video: null }); this.refresh() },

  /* ---------- 实况照片（Codex 素材线）：为图片绑定 ≤3s 动态片段 ---------- */
  toggleLive(e) {
    if (this.data.veBusy || this.data.busy) return
    const item = this.data.images[e.currentTarget.dataset.i]
    if (!item || !item.url) return
    const hit = this.data.livePhotos.find(p => p.photo === item.url)
    if (hit) {
      this.setData({ livePhotos: this.data.livePhotos.filter(p => p.photo !== item.url) })
      wx.showToast({ title: '已移除实况', icon: 'none' })
      this.refresh()
      return
    }
    wx.chooseMedia({ count: 1, mediaType: ['video'], sourceType: ['album', 'camera'], maxDuration: 3,
      success: async r => {
        const f = r.tempFiles[0]
        if (!f) return
        if ((f.duration || 0) > 3.1) return wx.showToast({ title: '请选 3 秒以内的动态片段', icon: 'none' })
        this.setData({ veBusy: true })
        try {
          await api.ensureLogin()
          const fs = wx.getFileSystemManager()
          const data = fs.readFileSync(f.tempFilePath, 'base64')
          const up = await api.request('/c/upload/note-video', 'POST', { data, ext: 'mp4' })
          if (up.access) this.mediaAccess.set(up.url, up.access)
          const livePhotos = this.data.livePhotos.filter(p => p.photo !== item.url)
          this.setData({ livePhotos: livePhotos.concat([{ photo: item.url, motion: up.url }]) })
          wx.showToast({ title: '已添加实况' })
          this.refresh()
        } catch (err) { wx.showToast({ title: err.msg || '动态片段添加失败', icon: 'none' }) }
        finally { this.setData({ veBusy: false }) }
      } })
  },

  /* ---------- 视频剪辑（Codex 素材线）：裁剪/滤镜/贴纸/字幕/BGM/封面帧 ---------- */
  openVideoEdit() {
    const v = this.data.video
    if (!v || !v.url || v.uploading || v.failed) return wx.showToast({ title: '视频就绪后可剪辑', icon: 'none' })
    this.setData({ videoEdit: { src: v.src, start: 0, end: 0, duration: 0, frame: 0,
      look: 'original', sticker: '', music: false, caption: '', captions: [],
      customSticker: '', customMusic: '', hasStickerAsset: false, hasMusicAsset: false, veError: '' } })
  },
  closeVideoEdit() { if (!this.data.veBusy) this.setData({ videoEdit: null }) },
  onVeMeta(e) {
    const duration = Math.floor(Number(e.detail.duration) * 10) / 10
    if (duration > 0 && this.data.videoEdit && !this.data.videoEdit.duration) {
      this.setData({ 'videoEdit.duration': duration, 'videoEdit.end': duration })
    }
  },
  changeVeTime(e) { this.setData({ ['videoEdit.' + e.currentTarget.dataset.field]: e.detail.value }) },
  changeVeLook(e) { this.setData({ 'videoEdit.look': e.currentTarget.dataset.look }) },
  changeVeSticker(e) { this.setData({ 'videoEdit.sticker': e.currentTarget.dataset.sticker }) },
  changeVeMusic(e) { this.setData({ 'videoEdit.music': e.detail.value }) },
  onVeCaption(e) { this.setData({ 'videoEdit.caption': e.detail.value }) },
  addVeCaption() {
    const ve = this.data.videoEdit
    if (!ve || ve.captions.length >= 12) return
    this.setData({ 'videoEdit.captions': ve.captions.concat([{ i: ve.captions.length + 1, start: ve.start, end: Math.min(ve.end, ve.start + 3), text: '' }]) })
  },
  changeVeCaption(e) {
    const { i, field } = e.currentTarget.dataset
    const captions = this.data.videoEdit.captions.map(c => Number(c.i) === Number(i) ? { ...c, [field]: field === 'text' ? e.detail.value : e.detail.value } : c)
    this.setData({ 'videoEdit.captions': captions })
  },
  removeVeCaption(e) {
    const i = e.currentTarget.dataset.i
    this.setData({ 'videoEdit.captions': this.data.videoEdit.captions.filter(c => Number(c.i) !== Number(i)).map((c, k) => ({ ...c, i: k + 1 })) })
  },
  // 自定义贴纸/音乐：从聊天文件导入（真机路径；automator 不可驱动，服务端已有校验）
  pickVeAsset(e) {
    const kind = e.currentTarget.dataset.kind
    const key = kind === 'sticker' ? 'customSticker' : 'customMusic'
    const flag = kind === 'sticker' ? 'hasStickerAsset' : 'hasMusicAsset'
    const ve = this.data.videoEdit
    if (!ve) return
    if (ve[key]) { this.setData({ ['videoEdit.' + key]: '', ['videoEdit.' + flag]: false }); return }
    wx.chooseMessageFile({ count: 1, type: 'file', extension: [kind === 'sticker' ? 'png' : 'mp3'],
      success: async r => {
        const f = r.tempFiles[0]
        if (!f) return
        if (f.size > 2 * 1024 * 1024) return wx.showToast({ title: '请选择 2 MB 内的文件', icon: 'none' })
        this.setData({ veBusy: true })
        try {
          await api.ensureLogin()
          const data = wx.getFileSystemManager().readFileSync(f.path, 'base64')
          const { asset } = await api.request('/c/note-video/asset', 'POST', { kind, data })
          this.setData({ ['videoEdit.' + key]: asset, ['videoEdit.' + flag]: true })
        } catch (err) { wx.showToast({ title: err.msg || '文件导入失败', icon: 'none' }) }
        finally { this.setData({ veBusy: false }) }
      } })
  },
  async applyVeTrim() {
    const ve = this.data.videoEdit
    const v = this.data.video
    if (!ve || !v || this.data.veBusy) return
    if (Number(ve.end) - Number(ve.start) < 0.5) return wx.showToast({ title: '至少保留半秒视频', icon: 'none' })
    if ((ve.caption && !ve.caption.trim() && ve.captions.some(c => !c.text.trim())) || ve.captions.some(c => !c.text.trim())) {
      return wx.showToast({ title: '字幕内容不能为空', icon: 'none' })
    }
    this.setData({ veBusy: true, 'videoEdit.veError': '' })
    try {
      await api.ensureLogin()
      const r = await api.request('/c/note-video/trim', 'POST', { url: v.url, start: Number(ve.start), end: Number(ve.end),
        look: ve.look, caption: ve.caption || '', captions: ve.captions.map(c => ({ text: c.text, start: Number(c.start), end: Number(c.end) })),
        sticker: ve.sticker, music: ve.music, customSticker: ve.customSticker, customMusic: ve.customMusic })
      if (r.access) this.mediaAccess.set(r.url, r.access)
      this.setData({ video: { ...v, key: v.key, kind: 'video', src: this.accessUrl(r.url), url: r.url, uploading: false, failed: false }, videoEdit: null })
      wx.showToast({ title: '剪辑完成' })
      this.refresh()
    } catch (err) {
      this.setData({ 'videoEdit.veError': err.msg || '视频处理失败，请重试' })
    } finally { this.setData({ veBusy: false }) }
  },
  async useVeFrame() {
    const ve = this.data.videoEdit
    const v = this.data.video
    if (!ve || !v || this.data.veBusy) return
    this.setData({ veBusy: true })
    try {
      await api.ensureLogin()
      const r = await api.request('/c/note-video/cover', 'POST', { url: v.url, start: Number(ve.frame) })
      if (r.access) this.mediaAccess.set(r.url, r.access)
      this.setData({ coverUrl: r.url, videoEdit: null })
      wx.showToast({ title: '已设为封面' })
    } catch (err) { wx.showToast({ title: err.msg || '封面生成失败', icon: 'none' }) }
    finally { this.setData({ veBusy: false }) }
  },
  openGallery(e) {
    if (this.data.dragging || Date.now() < (this.suppressThumbTapUntil || 0)) return
    this.setData({ showGallery: true, current: Number(e.currentTarget.dataset.i) })
    this.refresh()
  },
  closeGallery() { this.setData({ showGallery: false }) },
  onSwiper(e) { this.setData({ current: e.detail.current }); this.refresh() },
  setCover() { this.setData({ coverIndex: this.data.current }); this.refresh() },
  previewCurrent(e) {
    const i = e.currentTarget.dataset.i
    wx.previewImage({ urls: this.data.images.map(x => x.src), current: this.data.images[i] ? this.data.images[i].src : '' })
  },

  /* ---------- 素材长按拖拽排序（三期）：缩略图条 touch 流 ---------- */
  buildThumbs() {
    const d = this.data
    return d.images.map((x, i) => ({ key: x.key, src: x.src, i,
      isCover: i === d.coverIndex, isLive: d.livePhotos.some(p => p.photo === x.url), uploading: x.uploading, failed: x.failed,
      isDragging: d.dragging && i === this.dragFrom,
      isTarget: d.dragging && i === this.dragTarget && this.dragFrom !== this.dragTarget }))
  },
  thumbLongPress(e) {
    const i = Number(e.currentTarget.dataset.i)
    if (i < 0 || this.data.images.length < 2) return
    this.dragFrom = i
    this.dragTarget = i
    this.setData({ dragging: true, dragIndex: i, dragOverIndex: i })
    this.setData({ thumbs: this.buildThumbs() })
    wx.vibrateShort({ type: 'light', fail: () => {} })
  },
  thumbMove(e) {
    if (!this.data.dragging || this.dragFrom < 0) return
    const t = e.touches && e.touches[0]
    if (!t) return
    this.createSelectorQuery().selectAll('.thumb-photo').boundingClientRect(rects => {
      if (!this.data.dragging || !rects.length) return
      const next = rects.findIndex(rect => t.clientX < rect.right)
      const idx = next < 0 ? rects.length - 1 : next
      if (idx !== this.dragTarget) {
        this.dragTarget = idx
        this.setData({ dragOverIndex: idx, thumbs: this.buildThumbs() })
      }
    }).exec()
  },
  thumbEnd() {
    if (!this.data.dragging || this.dragFrom < 0) { this.setData({ dragging: false, dragIndex: -1, dragOverIndex: -1 }); return }
    const from = this.dragFrom, to = this.dragTarget
    this.dragFrom = -1; this.dragTarget = -1
    this.suppressThumbTapUntil = Date.now() + 250
    if (to >= 0 && to !== from && to < this.data.images.length) {
      const images = this.data.images.slice()
      const [moved] = images.splice(from, 1)
      images.splice(to, 0, moved)
      // 封面跟随其所在项移动（key 追踪，不按位置）
      const coverKey = this.data.images[this.data.coverIndex] ? this.data.images[this.data.coverIndex].key : ''
      const nextCover = images.findIndex(x => x.key === coverKey)
      const current = Math.min(to, Math.max(images.length - 1, 0))
      this.setData({ images, coverIndex: nextCover >= 0 ? nextCover : 0, current, dragging: false, dragIndex: -1, dragOverIndex: -1 })
      this.refresh()
      wx.vibrateShort({ type: 'light', fail: () => {} })
    } else {
      this.setData({ dragging: false, dragIndex: -1, dragOverIndex: -1 })
    }
    this.refresh()
  },

  /* ---------- 派生状态（WXML 只取值） ---------- */
  refresh() {
    const d = this.data
    const cover = d.images[d.coverIndex]
    const coverKey = cover ? cover.key : ''
    // isCover 预计算进 item：wxml 不做等值比较（分包 WXML 铁律）
    const liveSet = new Set(d.livePhotos.map(p => p.photo))
    const base = d.images.map(x => ({ ...x, isLive: liveSet.has(x.url) }))
    const images = base.some(x => x.isCover !== (x.key === coverKey))
      ? base.map(x => x.isCover === (x.key === coverKey) ? x : { ...x, isCover: x.key === coverKey })
      : base
    const imgs = images
    const canPublish = this.plainLenValue >= 4 && d.uploadingCount === 0 && !d.hasFailed
      && (d.editId !== null || d.textMode || imgs.length > 0 || !!d.video)
    this.setData({
      images: imgs,
      thumbs: this.buildThumbs(),
      hasMedia: imgs.length > 0 || !!d.video || d.editId !== null || d.textMode,
      canAddMore: !d.video && imgs.length < 9,
      mediaLabel: imgs.length ? (d.current + 1) + '/' + imgs.length : '',
      hasFailed: imgs.some(x => x.failed) || !!(d.video && d.video.failed),
      bodyLen: this.plainLenValue,
      canIdeas: imgs.filter(x => x.url && !x.failed).length > 0,
      barHint: d.uploadingCount > 0 ? '正在上传媒体 ' + d.uploadingCount + ' 个…'
        : (imgs.some(x => x.failed) || (d.video && d.video.failed) ? '有媒体上传失败，请重试或删除' : ''),
      canPublish,
    })
  },

  /* ---------- ✨ 写作建议（AI 看图成文 + 三期②排版建议落地） ---------- */
  openIdeas() {
    if (!this.data.canIdeas) return wx.showToast({ title: '先上传照片，再让 AI 帮你写', icon: 'none' })
    this.setData({ showIdeas: true, visionError: '' })
  },
  closeIdeas() { this.setData({ showIdeas: false }) },
  onIntentInput(e) { this.setData({ writingIntent: e.detail.value }) },
  async genIdeas() {
    if (this.data.visionBusy) return
    const paths = this.data.images.filter(x => x.url && !x.failed).map(x => x.url).slice(0, 3)
    if (!paths.length) return wx.showToast({ title: '先上传照片', icon: 'none' })
    this.setData({ visionBusy: true, visionError: '' })
    try {
      await api.ensureLogin()
      const r = await api.request('/c/note-vision-draft', 'POST', { paths, relatedProductId: this.data.relatedProductId,
        topics: this.data.topics, intent: this.data.writingIntent || '' })
      // guide（三期②）：true=路线攻略（重顺序），false=图文打卡（重画面）——应用时落到话题与提示
      this.setData({ visionResult: { title: r.title || '', text: r.text || '', reason: r.reason || '', guide: r.guide === true, guideLabel: r.guide === true ? '路线攻略' : '图文打卡' } })
    } catch (e) { this.setData({ visionError: e.msg || '生成失败，请稍后重试' }) }
    finally { this.setData({ visionBusy: false }) }
  },
  applyIdea() {
    const r = this.data.visionResult
    if (!r) return
    // 标题直接回填；正文按空行分段写入编辑器（保留用户已有内容时不覆盖——XHS 习惯是覆盖，这里确认）
    const hasBody = this.plainLenValue > 0
    const apply = () => {
      this.pendingHtml = r.text.split(/\n{2,}/).map(s => '<p>' + s.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch])).replace(/\n/g, '<br>') + '</p>').join('')
      this.plainLenValue = this.plainLen(this.pendingHtml)
      if (this.editor) { this.editor.setContents({ html: this.pendingHtml }); this.pendingHtml = '' }
      // 排版建议落地：按 guide 自动补一个对应话题（已有则跳过）
      const guideTopic = r.guide ? '路线攻略' : '旅行打卡'
      const topics = this.data.topics.includes(guideTopic) ? this.data.topics
        : (this.data.topics.length >= 5 ? this.data.topics : this.data.topics.concat(guideTopic))
      const title = this.data.title.trim() ? this.data.title : r.title.slice(0, 20)
      this.setData({ title, titleLen: title.length, topics, showIdeas: false })
      this.refresh()
    }
    if (hasBody) {
      wx.showModal({ title: '应用 AI 文案？', content: '当前已写的正文将被替换。', success: m => { if (m.confirm) apply() } })
    } else apply()
  },

  /* ---------- 攻略图 ---------- */
  openGuide() {
    if (this.data.video || this.data.images.length >= 9) {
      wx.showToast({ title: this.data.video ? '请先移除视频' : '请先腾出一个图片位置', icon: 'none' })
      return
    }
    if (!this.data.guideTitle && !this.data.guideText) {
      this.setData({ guideTitle: (this.data.title.trim() || this.data.scenicName).slice(0, 20), guideText: this.data.bodyText.trim().slice(0, 240) })
    }
    this.setData({ showGuide: true })
  },
  closeGuide() {
    if (!this.data.guideBusy) this.setData({ showGuide: false })
  },
  editGuide(e) {
    this.setData({ [e.currentTarget.dataset.field]: e.detail.value, guideImage: '' })
  },
  selectGuideStyle(e) {
    const guideStyle = Number(e.currentTarget.dataset.index)
    this.setData({ guideStyle, guideImage: '', guideStyles: GUIDE_STYLES.map((style, index) => ({ ...style, selected: index === guideStyle })) })
  },
  pickGuidePhoto() {
    wx.chooseMedia({ count: 1, mediaType: ['image'], success: r => {
      const photo = r.tempFiles[0]
      if (photo) this.setData({ guidePhoto: photo.tempFilePath, guideImage: '' })
    } })
  },
  clearGuidePhoto() { this.setData({ guidePhoto: '', guideImage: '' }) },
  async generateGuide() {
    const { guideTitle, guideText, guidePhoto, guideStyle, guideBusy } = this.data
    if (guideBusy) return
    if (!guideText.trim()) return wx.showToast({ title: '先写几条攻略要点', icon: 'none' })
    this.setData({ guideBusy: true, guideImage: '' })
    try {
      const title = guideTitle.trim() || suggestTitle(guideText)
      const preview = await renderGuide(this, { title, text: guideText, photo: guidePhoto, style: GUIDE_STYLES[guideStyle] })
      this.setData({ guideImage: preview })
    } catch (err) {
      wx.showToast({ title: '攻略图生成失败，请重试', icon: 'none' })
    } finally { this.setData({ guideBusy: false }) }
  },
  insertGuide() {
    const { guideImage, guideBusy, guideText, images, video } = this.data
    if (!guideImage || guideBusy || video || images.length >= 9) return
    if (!this.plainLenValue && !this.data.bodyHtml) {
      const html = guideText.trim().split(/\n+/).map(line => '<p>' + line.replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch])) + '</p>').join('')
      this.plainLenValue = this.plainLen(html)
      this.pendingHtml = html
      if (this.editor) { this.editor.setContents({ html }); this.pendingHtml = '' }
      this.setData({ bodyText: guideText.trim(), bodyHtml: html })
    }
    this.setData({ showGuide: false, guideImage: '' })
    this.enqueue([{ tempFilePath: guideImage }], 'image')
    this.refresh()
  },

  /* ---------- 文字编辑 ---------- */
  onTitle(e) { this.setData({ title: e.detail.value, titleLen: e.detail.value.length }) },
  onEditorReady() {
    this.createSelectorQuery().select('#bodyEditor').context(r => {
      this.editor = r.context
      if (!this.editor || !this.pendingHtml) return
      const html = this.pendingHtml
      this.pendingHtml = ''
      this.editor.setContents({ html })
      this.plainLenValue = this.plainLen(html)
      this.refresh()
    }).exec()
  },
  onEditorStatus(e) { this.setData({ formats: e.detail }) },
  onEditorInput(e) {
    this.plainLenValue = this.plainLen(e.detail.html)
    this.setData({ bodyText: e.detail.text, bodyHtml: e.detail.html })
    this.refresh()
  },
  plainLen(html) { return String(html || '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, '').length },
  rtCmd(e) {
    if (!this.editor) return
    const tag = e.currentTarget.dataset.tag
    const map = { b: ['bold', !this.data.formats.bold], i: ['italic', !this.data.formats.italic], ul: ['list', 'bullet'] }
    if (map[tag]) this.editor.format(...map[tag])
  },

  /* ---------- 话题 ---------- */
  openTopicSheet() { this.setData({ showTopicSheet: true }) },
  closeTopicSheet() { this.setData({ showTopicSheet: false }) },
  noop() {},
  addTopic(e) {
    const t = e.currentTarget.dataset.t
    if (!this.data.topics.includes(t) && this.data.topics.length < 5) this.setData({ topics: this.data.topics.concat(t) })
    this.setData({ showTopicSheet: false })
  },
  removeTopic(e) { this.setData({ topics: this.data.topics.filter(x => x !== e.currentTarget.dataset.t) }) },
  customTopic() {
    wx.showModal({ title: '自定义话题', editable: true, placeholderText: '输入话题名（20 字内）', success: r => {
      const t = String(r.content || '').trim().replace(/^#+/, '').slice(0, 20)
      if (!t) return
      if (this.data.topics.includes(t)) return this.setData({ showTopicSheet: false })
      if (this.data.topics.length >= 5) return wx.showToast({ title: '最多 5 个话题', icon: 'none' })
      this.setData({ topics: this.data.topics.concat(t), showTopicSheet: false })
    } })
  },

  /* ---------- 关联线路 ---------- */
  pickProduct() {
    api.getTours('all').then((list) => {
      wx.showActionSheet({ alertText: '关联到哪条线路？', itemList: list.slice(0, 6).map((x) => x.title),
        success: (tap) => { const p = list[tap.tapIndex]; this.setData({ relatedProductId: p.id, relatedName: p.title }) }, fail: () => {} })
    }).catch(() => wx.showToast({ title: '线路加载失败', icon: 'none' }))
  },

  /* ---------- 编辑回填 ---------- */
  async loadForEdit() {
    this.setData({ busy: true })
    try {
      await api.ensureLogin()
      const n = await api.request('/c/notes/' + this.data.editId + '/edit')
      const blocks = Array.isArray(n.blocks) ? n.blocks : []
      const textBlocks = blocks.filter(b => b.type === 'text').map(b => b.html)
      const imgUrls = [...new Set([...(n.images || []), ...blocks.filter(b => b.type === 'image').map(b => b.url)])]
      const videoUrl = n.video || (blocks.find(b => b.type === 'video') || {}).url || null
      if (n.mediaAccess) for (const [p, t] of Object.entries(n.mediaAccess)) this.mediaAccess.set(p, t)
      // 私密笔记（V88 门禁）：note-editor 票据不放大私密素材读取权——作者编辑走登录态下载临时文件预览
      const local = {}
      if (n.visibility === 'private') {
        for (const p of [...imgUrls, videoUrl].filter(Boolean)) {
          try { local[p] = await api.downloadPrivateMedia(p) } catch (e) { local[p] = '' }
        }
      }
      const images = imgUrls.map(u => { const src = local[u] || this.accessUrl(u); this.imageUploads.set(src, u)
        return { key: 'm' + (++this.seq), kind: 'image', src, uploading: false, failed: false, url: u } })
      const video = videoUrl ? { key: 'm' + (++this.seq), kind: 'video', src: local[videoUrl] || this.accessUrl(videoUrl), uploading: false, failed: false, url: videoUrl } : null
      const coverIndex = Math.min(Number(n.coverIndex) || 0, Math.max(images.length - 1, 0))
      this.pendingHtml = textBlocks.join('')
      this.plainLenValue = this.plainLen(this.pendingHtml)
      if (this.editor && this.pendingHtml) { this.editor.setContents({ html: this.pendingHtml }); this.pendingHtml = '' }
      this.setData({ title: n.title || '', titleLen: (n.title || '').length, topics: n.topics || [],
        images, video, coverIndex, revision: n.revision,
        visibility: n.visibility === 'private' ? 'private' : 'public',
        visPublicOn: n.visibility !== 'private', visPrivateOn: n.visibility === 'private',
        scenicId: n.scenicId || null, scenicName: n.scenicName || '',
        livePhotos: Array.isArray(n.livePhotos) ? n.livePhotos : [], coverUrl: n.cover || '',
        relatedProductId: n.relatedProductId, relatedName: n.relatedName || '', loaded: true, bodyText: '' })
      this.refresh()
    } catch (e) {
      wx.showToast({ title: e.msg || '作品加载失败', icon: 'none' })
      setTimeout(() => wx.navigateBack({ fail: () => {} }), 1200)
    } finally { this.setData({ busy: false }) }
  },

  /* ---------- 发布 ---------- */
  async publish() {
    if (this.data.busy) return
    if (this.data.uploadingCount > 0 || this.data.hasFailed) return wx.showToast({ title: this.data.barHint || '媒体未就绪', icon: 'none' })
    this.setData({ busy: true })
    try {
      const content = this.editor ? await new Promise(r => this.editor.getContents({ success: r, fail: () => r(null) })) : null
      const html = content?.html || this.data.bodyHtml
      if (this.plainLen(html) < 4) return wx.showToast({ title: '至少写 4 个字', icon: 'none' })
      const imageUrls = this.data.images.filter(x => x.url && !x.failed).map(x => x.url)
      if (this.data.images.some(x => !x.url)) return wx.showToast({ title: '图片还在上传或已失败', icon: 'none' })
      if (this.data.video && !this.data.video.url) return wx.showToast({ title: '视频还在上传或已失败', icon: 'none' })
      if (!this.data.title.trim()) {
        const title = suggestTitle(content?.text || this.data.bodyText, this.data.scenicName, this.data.topics[0])
        this.setData({ title, titleLen: title.length, confirmTitle: true, publishLabel: this.data.editId ? '确认提交审核' : '确认发布' })
        return
      }
      await api.ensureLogin()
      const { editId, revision, title, topics, visibility, scenicId, relatedProductId } = this.data
      const coverItem = this.data.images[this.data.coverIndex]
      const blocks = [{ type: 'text', html }]
      const payload = { title: title.trim(), blocks, images: imageUrls, video: this.data.video ? this.data.video.url : null,
        topics, visibility, scenicId, relatedProductId,
        cover: this.data.coverUrl || (coverItem && coverItem.url ? coverItem.url : null),
        livePhotos: this.data.livePhotos }
      if (this.data.cloudDraftId != null && !editId) { payload.draftId = this.data.cloudDraftId; payload.draftRevision = this.data.cloudDraftRevision }
      let r
      try {
        r = await api.request(editId ? '/c/notes/' + editId : '/c/notes', editId ? 'PUT' : 'POST', { ...payload, revision })
      } catch (err) {
        // 云草稿乐观锁冲突（其他设备已改动）：不阻断发布，去掉草稿关联重试一次
        if (payload.draftId != null && err && err.code === 2002) {
          delete payload.draftId; delete payload.draftRevision
          r = await api.request(editId ? '/c/notes/' + editId : '/c/notes', editId ? 'PUT' : 'POST', { ...payload, revision })
        } else throw err
      }
      this.clearLocalDraft()
      // 发布成功后本页任何 onHide 都不再存草稿（否则已发布内容会在下次进页时弹"恢复草稿"）
      this._published = true
      // 云草稿已由服务端在发布事务里原子删除；清空本地状态
      this.setData({ cloudDraftId: null, cloudDraftRevision: null, cloudSavedAt: '' })
      wx.showToast({ title: r.status === 2 ? '已发布' : r.msg || '已提交审核', icon: 'success' })
      setTimeout(() => wx.navigateBack({ fail: () => wx.reLaunch({ url: '/package-content/pages/create/index' }) }), 900)
    } catch (e) { wx.showToast({ title: e.msg || '提交失败', icon: 'none' }) }
    finally { this.setData({ busy: false }) }
  },

  onShareAppMessage() { return { title: '向往的自由 · 发布旅行笔记', path: '/pages/home/index' } },
  onShareTimeline() { return { title: '向往的自由 · 发布旅行笔记', query: '' } },
})
