// 小红书式发布页：先选图（九宫格）→ 编辑（图集轮播 + 标题 + 正文 + 话题 + 关联线路）→ 发布
// 与旧版图文混排的差异：图片/视频独立于正文（图库模型），正文为纯文本块，服务端天然兼容。
// WXML 铁律：只做取值与单三元，全部逻辑在此预计算。
const api = require('../../../utils/api')

const HOT_TOPICS = ['亲子出游', '周末遛娃', '小众路线', '露营日记', '美食探店', '古镇漫步', '山水风光', '人文历史']

Page({
  data: {
    title: '', titleLen: 0, bodyText: '', bodyHtml: '',
    topics: [], hotTopics: HOT_TOPICS, showTopicSheet: false,
    images: [], video: null, coverIndex: 0, current: 0,
    hasMedia: false, canAddMore: true, mediaLabel: '', coverKey: '',
    relatedProductId: null, relatedName: '',
    editId: null, revision: null, textMode: false, loaded: false,
    uploadingCount: 0, hasFailed: false, barHint: '', canPublish: false, bodyLen: 0,
    formats: {}, busy: false,
  },

  onLoad(q) {
    this.seq = 0
    this.plainLenValue = 0 // 正文纯文本长度（editor 是唯一事实源，编辑回填也能正确计数）
    this.imageUploads = new Map() // src → /uploads 原始路径（预览渲染用）
    if (q && q.id) { this.setData({ editId: Number(q.id) }) }
  },
  onReady() {
    if (this.data.editId) this.loadForEdit()
    else this.pickImages()
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
    for (const it of items) {
      this.bump(1)
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
    this.patchItem(it.key, { uploading: false, failed: false, url: up.url })
    this.refresh()
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
    const images = this.data.images.filter(x => x.key !== key)
    let coverIndex = this.data.coverIndex
    if (idx < coverIndex) coverIndex--
    else if (idx === coverIndex) coverIndex = 0
    this.setData({ images, coverIndex, current: Math.min(this.data.current, Math.max(images.length - 1, 0)) })
    this.refresh()
  },
  removeVideo() { this.setData({ video: null }); this.refresh() },
  onSwiper(e) { this.setData({ current: e.detail.current }) },
  setCover() { this.setData({ coverIndex: this.data.current }); this.refresh() },
  previewCurrent(e) {
    const i = e.currentTarget.dataset.i
    wx.previewImage({ urls: this.data.images.map(x => x.src), current: this.data.images[i] ? this.data.images[i].src : '' })
  },

  /* ---------- 派生状态（WXML 只取值） ---------- */
  refresh() {
    const d = this.data
    const cover = d.images[d.coverIndex]
    const coverKey = cover ? cover.key : ''
    // isCover 预计算进 item：wxml 不做等值比较（分包 WXML 铁律）
    const images = d.images.some(x => x.isCover !== (x.key === coverKey))
      ? d.images.map(x => x.isCover === (x.key === coverKey) ? x : { ...x, isCover: x.key === coverKey })
      : d.images
    const imgs = images
    const canPublish = this.plainLenValue >= 4 && d.uploadingCount === 0 && !d.hasFailed
      && (d.editId !== null || d.textMode || imgs.length > 0 || !!d.video)
    this.setData({
      images: imgs,
      hasMedia: imgs.length > 0 || !!d.video || d.editId !== null || d.textMode,
      canAddMore: !d.video && imgs.length < 9,
      mediaLabel: imgs.length ? (d.current + 1) + '/' + imgs.length : '',
      hasFailed: imgs.some(x => x.failed) || !!(d.video && d.video.failed),
      bodyLen: this.plainLenValue,
      barHint: d.uploadingCount > 0 ? '正在上传媒体 ' + d.uploadingCount + ' 个…'
        : (imgs.some(x => x.failed) || (d.video && d.video.failed) ? '有媒体上传失败，请重试或删除' : ''),
      canPublish,
    })
  },

  /* ---------- 文字编辑 ---------- */
  onTitle(e) { this.setData({ title: e.detail.value, titleLen: e.detail.value.length }) },
  onEditorReady() {
    this.createSelectorQuery().select('#bodyEditor').context(r => { this.editor = r.context }).exec()
    if (this.pendingHtml) { const html = this.pendingHtml; this.pendingHtml = ''; this.editor.setContents({ html }); this.plainLenValue = this.plainLen(html); this.refresh() }
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
      const images = imgUrls.map(u => { const src = api.img(u); this.imageUploads.set(src, u)
        return { key: 'm' + (++this.seq), kind: 'image', src, uploading: false, failed: false, url: u } })
      const video = videoUrl ? { key: 'm' + (++this.seq), kind: 'video', src: api.img(videoUrl), uploading: false, failed: false, url: videoUrl } : null
      const coverIndex = Math.min(Number(n.coverIndex) || 0, Math.max(images.length - 1, 0))
      this.pendingHtml = textBlocks.join('')
      this.plainLenValue = this.plainLen(this.pendingHtml)
      if (this.editor && this.pendingHtml) { this.editor.setContents({ html: this.pendingHtml }); this.pendingHtml = '' }
      this.setData({ title: n.title || '', titleLen: (n.title || '').length, topics: n.topics || [],
        images, video, coverIndex, revision: n.revision,
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
    const html = this.editor ? await new Promise(r => this.editor.getContents({ success: c => r(c.html), fail: () => r('') })) : ''
    if (this.plainLen(html) < 4) return wx.showToast({ title: '至少写 4 个字', icon: 'none' })
    const imageUrls = this.data.images.filter(x => x.url && !x.failed).map(x => x.url)
    if (this.data.images.some(x => !x.url)) return wx.showToast({ title: '图片还在上传或已失败', icon: 'none' })
    if (this.data.video && !this.data.video.url) return wx.showToast({ title: '视频还在上传或已失败', icon: 'none' })
    this.setData({ busy: true })
    try {
      await api.ensureLogin()
      const { editId, revision, title, topics, coverIndex, relatedProductId } = this.data
      const blocks = [{ type: 'text', html }]
      const payload = { title: title.trim(), blocks, images: imageUrls, video: this.data.video ? this.data.video.url : null,
        topics, coverIndex, relatedProductId }
      const r = await api.request(editId ? '/c/notes/' + editId : '/c/notes', editId ? 'PUT' : 'POST', { ...payload, revision })
      wx.showToast({ title: r.status === 2 ? '已发布' : r.msg || '已提交审核', icon: 'success' })
      setTimeout(() => wx.navigateBack({ fail: () => wx.reLaunch({ url: '/package-content/pages/create/index' }) }), 900)
    } catch (e) { wx.showToast({ title: e.msg || '提交失败', icon: 'none' }) }
    finally { this.setData({ busy: false }) }
  },

  onShareAppMessage() { return { title: '向往的自由 · 发布旅行笔记', path: '/pages/home/index' } },
  onShareTimeline() { return { title: '向往的自由 · 发布旅行笔记', query: '' } },
})
