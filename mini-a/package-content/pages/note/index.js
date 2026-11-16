// 笔记详情（小红书式）：图集 swiper → 作者行 → 标题正文 → 话题 → 评论区（盖楼展开/回复@/点赞/图片评论/语音评论/删除）→ 底部操作栏
// 三期新增：话题/景区可点聚合跳转；评论骨架屏（初始+展开回复）；语音评论（录制/试听/播放）；私密笔记媒体走登录态下载
// 数据全在 JS 预计算（含播放态/媒体态等值比较），wxml 只做取值与单三元（分包 WXML 铁律）
const api = require('../../../utils/api')
Page({
  data: {
    n: null, loadTxt: '加载中…',
    reporting: false, reportReason: '', reportMsg: '', reportBusy: false,
    comments: [], commentTotal: 0, commentNext: null, commentMsg: '',
    commentsLoading: true,       // 骨架屏：首次评论加载中
    commentDraft: '', commentBusy: false, canSend: false,
    replyTarget: null,           // {id, label} 回复对象；null=发一级评论
    pendingImage: null,          // {kind:'image', src, data} 待发送的图片评论附件
    pendingAudio: null,          // {kind:'audio', path} 待发送的语音评论（临时文件）
    recording: false, playingAudio: '',
    liked: false, likeCount: 0, current: 0, mediaLabel: '', hasGallery: false,
    livePlayer: '', playerLabel: '',
  },
  onLoad(q) { this.id = q.id; this.cursor = null },
  onShow() { if (this.id) { this.fetch(); this.fetchComments(true) } },
  onHide() { if (this.commentPlayer) this.commentPlayer.stop(); if (this.data.recording && this.recorder) this.recorder.stop() },
  onUnload() {
    if (this.commentPlayer) { this.commentPlayer.destroy(); this.commentPlayer = null }
    if (this.recorder && this.recordStopped) { this.recorder.offStop(this.recordStopped); this.recorder.offError(this.recordFailed) }
  },
  async fetch() {
    try {
      await api.ensureLogin()
      const n = await api.request('/c/notes/' + this.id)
      // 私密笔记（三期 V88）：媒体经门禁，直接 src 会 404——统一下载为临时文件再渲染
      if (n.visibility === 'private') {
        const paths = [...new Set([...(n.images || []), ...((n.blocks || []).filter(b => b.type === 'image').map(b => b.url)), n.cover, n.video].filter(Boolean))]
        const local = {}
        for (const p of paths) { try { local[p] = await api.downloadPrivateMedia(p) } catch (e) { local[p] = '' } }
        n.images = (n.images || []).map(u => local[u] || '').filter(Boolean)
        if (n.video) n.video = local[n.video] || ''
        if (Array.isArray(n.blocks)) n.blocks = n.blocks.map(b => b.type === 'image' && local[b.url] ? { ...b, url: local[b.url] } : b)
      }
      // 实况映射（photo 原始路径 → motion 完整 URL）：按原始路径索引，与 imagesFull 一一对应
      const motionByImg = {}
      for (const p of (n.livePhotos || [])) {
        const idx = (n.images || []).indexOf(p.photo)
        if (idx >= 0) motionByImg[idx] = api.img(p.motion)
      }
      const imgs = (n.images || []).map(api.img)
      const blocks = Array.isArray(n.blocks)
        ? n.blocks.map(b => b.type === 'text' ? { ...b, isText: true } : { ...b, isText: false })
        : null
      this.setData({
        liked: n.liked, likeCount: n.likeCount,
        n: { ...n, when: String(n.published_at || '').replace('T', ' ').slice(0, 16), html: n.text || '',
          imagesFull: imgs.map((u, i) => ({ url: u, motion: motionByImg[i] || '' })),
          blocksReady: blocks, topicsReady: n.topics || [], isPrivate: n.visibility === 'private' },
        hasGallery: imgs.length > 0,
        mediaLabel: imgs.length ? '1/' + imgs.length : '',
      })
    } catch (e) { this.setData({ n: null, loadTxt: e.msg || '内容暂未加载，请重试' }) }
  },
  onSwiper(e) {
    const label = (e.detail.current + 1) + '/' + (this.data.n ? this.data.n.imagesFull.length : 0)
    this.setData({ current: e.detail.current, mediaLabel: label })
  },
  previewImage(e) {
    const urls = this.data.n.imagesFull.map(x => x.url)
    wx.previewImage({ urls, current: urls[e.currentTarget.dataset.i] || urls[0] })
  },
  playLive(e) {
    const motion = e.currentTarget.dataset.motion
    if (!motion) return
    this.setData({ livePlayer: motion, playerLabel: '关闭实况' })
  },
  closeLive() { this.setData({ livePlayer: '' }) },
  previewCommentImage(e) { wx.previewImage({ urls: [e.currentTarget.dataset.url] }) },

  /* ---------- 话题/景区聚合跳转（三期①） ---------- */
  goTopic(e) {
    const t = e.currentTarget.dataset.topic
    if (!t) return
    wx.navigateTo({ url: '/package-content/pages/square/index?topic=' + encodeURIComponent(t) })
  },
  goScenic() {
    if (this.data.n && this.data.n.scenic_id) wx.navigateTo({ url: '/package-tour/pages/place/index?kind=scenic&id=' + this.data.n.scenic_id })
  },

  /* ---------- 点赞 / 举报 ---------- */
  async toggleLike() {
    try {
      const r = await api.request('/c/notes/' + this.id + '/like', this.data.liked ? 'DELETE' : 'POST')
      this.setData({ liked: r.liked, likeCount: r.likeCount })
    } catch (e) { wx.showToast({ title: e.msg || '操作失败', icon: 'none' }) }
  },
  toggleReport() { this.setData({ reporting: !this.data.reporting, reportMsg: '' }) },
  onReportReason(e) { this.setData({ reportReason: e.detail.value }) },
  async submitReport() {
    if (this.data.reportBusy) return
    this.setData({ reportBusy: true, reportMsg: '' })
    try { const r = await api.request('/c/notes/' + this.id + '/report', 'POST', { reason: this.data.reportReason }); this.setData({ reporting: false, reportReason: '', reportMsg: r.duplicate ? '你已举报过该笔记，可在创作中心查看结果' : '举报已提交，可在创作中心查看结果' }) }
    catch (e) { this.setData({ reportMsg: e.msg || '提交失败，请重试' }) }
    finally { this.setData({ reportBusy: false }) }
  },

  /* ---------- 评论区（V87 社交层 + 三期骨架屏） ---------- */
  // 评论项预计算：头像字、作者标、时间、语音/图片附件态、媒体审核态——wxml 零比较
  decorate(r) {
    const isAudio = r.media_kind === 'audio'
    const mediaState = Number(r.media_state)
    return { ...r,
      avatarChar: (r.author || '旅').slice(0, 1),
      when: String(r.created_at || '').replace('T', ' ').slice(0, 16),
      isAudio,
      hasImage: !!r.mediaUrl && !isAudio,
      audioOn: this.data.playingAudio === r.mediaUrl,
      mediaPending: !!r.media_kind && mediaState !== 1,
      mediaStateText: mediaState === 0 ? '媒体审核中，通过后展示' : '媒体未通过审核',
      replies: r.replies || [] }
  },
  // 一级评论楼层附加态：展开区/展开更多按钮显隐全预计算
  decorateRoot(r) {
    return { ...this.decorate(r),
      repliesCount: Number(r.replies) || 0, repliesLeft: Number(r.replies) || 0,
      expanded: false, more: null, repliesLoading: false }
  },
  // 楼层派生标志重算（replies/more/loading/expanded 变化后统一走这里）
  rederive(list) {
    return list.map(c => ({ ...c,
      hasReplyArea: c.replies.length > 0 || c.repliesLeft > 0 || c.repliesLoading === true,
      showExpandMore: c.repliesLeft > 0 && !c.expanded && !c.repliesLoading,
      showMoreMore: !!c.more && !c.repliesLoading,
      replies: (c.replies || []).map(x => ({ ...x, audioOn: this.data.playingAudio === x.mediaUrl })) }))
  },
  patchRoot(rootId, patch) {
    this.setData({ comments: this.deriveAll(this.data.comments.map(c => c.id === rootId ? { ...c, ...patch } : c)) })
  },
  deriveAll(list) { return this.rederive(list) },
  async fetchComments(reset) {
    if (reset) this.setData({ commentsLoading: true })
    try {
      await api.ensureLogin()
      const qs = reset ? '' : (this.data.commentNext ? '&before=' + this.data.commentNext : '')
      const d = await api.request('/c/notes/' + this.id + '/comments' + (qs ? '?' + qs.slice(1) : ''))
      const roots = d.items.map(r => this.decorateRoot(r))
      this.cursor = d.next
      this.setData({
        comments: this.deriveAll(reset ? roots : this.data.comments.concat(roots)),
        commentTotal: Number(d.total) || 0, commentNext: d.next || null,
      })
    } catch (e) { /* 评论加载失败不阻塞正文 */ }
    finally { if (reset) this.setData({ commentsLoading: false }) }
  },
  loadMoreComments() { if (this.data.commentNext) this.fetchComments(false) },
  // 楼内回复：服务端倒序拉取，展示按时间正序；repliesLeft = 总数 - 已载入；展开期间骨架行
  async expandReplies(e) {
    const rootId = e.currentTarget.dataset.root
    this.patchRoot(rootId, { repliesLoading: true })
    try {
      await api.ensureLogin()
      const d = await api.request('/c/notes/' + this.id + '/comments?root=' + rootId)
      const replies = d.items.map(r => this.decorate(r)).reverse()
      const root = this.data.comments.find(c => c.id === rootId)
      this.patchRoot(rootId, {
        replies, expanded: true, more: d.next || null,
        repliesLeft: Math.max(0, (Number(root?.repliesCount) || 0) - replies.length),
      })
    } catch (err) { wx.showToast({ title: err.msg || '回复加载失败', icon: 'none' }) }
    finally { this.patchRoot(rootId, { repliesLoading: false }) }
  },
  async moreReplies(e) {
    const rootId = e.currentTarget.dataset.root
    const root = this.data.comments.find(c => c.id === rootId)
    if (!root || !root.more) return
    this.patchRoot(rootId, { repliesLoading: true })
    try {
      await api.ensureLogin()
      const d = await api.request('/c/notes/' + this.id + '/comments?root=' + rootId + '&before=' + root.more)
      const older = d.items.map(r => this.decorate(r)).reverse()
      this.patchRoot(rootId, {
        replies: older.concat(root.replies), more: d.next || null,
        repliesLeft: Math.max(0, (Number(root.repliesCount) || 0) - older.length - root.replies.length),
      })
    } catch (err) { wx.showToast({ title: err.msg || '回复加载失败', icon: 'none' }) }
    finally { this.patchRoot(rootId, { repliesLoading: false }) }
  },
  // 回复某条评论（回复楼内回复也挂同一楼一层）
  startReply(e) {
    const { id, root, author } = e.currentTarget.dataset
    this.setData({ replyTarget: { id, root: root || id, label: author || '评论' } })
  },
  cancelReply() { this.setData({ replyTarget: null }) },
  onCommentInput(e) {
    const v = e.detail.value
    this.setData({ commentDraft: v, canSend: this.computeCanSend(v) })
  },
  computeCanSend(draft) {
    return Boolean((draft && draft.length) || this.data.pendingImage || this.data.pendingAudio)
  },

  // 图片评论：选 1 张（≤700KB）→ 上传 → 随评论发送
  pickCommentImage() {
    wx.chooseMedia({ count: 1, mediaType: ['image'], sizeType: ['compressed'],
      success: r => {
        const f = r.tempFiles[0]
        if (!f) return
        if (f.size > 700 * 1024) return wx.showToast({ title: '图片需 700KB 内', icon: 'none' })
        this.setData({ pendingImage: { kind: 'image', src: f.tempFilePath, data: '', uploading: true },
          pendingAudio: null, canSend: true })
        this.uploadCommentImage(f.tempFilePath)
      } })
  },
  async uploadCommentImage(p) {
    try {
      await api.ensureLogin()
      const fs = wx.getFileSystemManager()
      const data = fs.readFileSync(p, 'base64')
      const sig = data.slice(0, 8)
      const ext = sig.startsWith('iVBOR') ? 'png' : 'jpg'
      const up = await api.request('/c/upload/note-image', 'POST', { data, ext })
      this.setData({ pendingImage: { kind: 'image', src: p, data: up.url, uploading: false } })
    } catch (e) {
      wx.showToast({ title: e.msg || '图片上传失败', icon: 'none' })
      this.setData({ pendingImage: null, canSend: this.computeCanSend(this.data.commentDraft) })
    }
  },
  removePendingImage() { this.setData({ pendingImage: null, canSend: this.computeCanSend(this.data.commentDraft) }) },

  /* ---------- 语音评论（三期）：wx.getRecorderManager → mp3 → 随评论发送 ---------- */
  recordVoice() {
    if (this.data.commentBusy) return
    if (this.data.recording) return this.recorder.stop()
    if (!this.recorder) {
      this.recorder = wx.getRecorderManager()
      this.recordStopped = ({ tempFilePath, duration }) => {
        this.setData({ recording: false })
        if (duration >= 500 && tempFilePath) this.setData({ pendingAudio: { kind: 'audio', path: tempFilePath }, pendingImage: null, canSend: true })
        else wx.showToast({ title: '请录制至少半秒', icon: 'none' })
      }
      this.recordFailed = () => {
        this.setData({ recording: false })
        wx.showToast({ title: '录音失败，请检查麦克风权限', icon: 'none' })
      }
      this.recorder.onStop(this.recordStopped)
      this.recorder.onError(this.recordFailed)
    }
    this.recorder.start({ duration: 30000, format: 'mp3', sampleRate: 16000, numberOfChannels: 1, encodeBitRate: 48000 })
    this.setData({ recording: true })
  },
  removePendingAudio() { this.setData({ pendingAudio: null, canSend: this.computeCanSend(this.data.commentDraft) }) },
  // 试听待发送语音 / 播放列表语音（同一播放器，重复点即停止）
  playCommentAudio(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    if (this.data.playingAudio === url) { this.commentPlayer.stop(); return }
    if (!this.commentPlayer) {
      this.commentPlayer = wx.createInnerAudioContext()
      this.commentPlayer.onEnded(() => this.clearPlaying())
      this.commentPlayer.onStop(() => this.clearPlaying())
      this.commentPlayer.onError(() => { this.clearPlaying(); wx.showToast({ title: '语音播放失败', icon: 'none' }) })
    }
    this.commentPlayer.stop()
    this.commentPlayer.src = url
    this.setData({ playingAudio: url })
    this.refreshAudioOn(url)
    this.commentPlayer.play()
  },
  clearPlaying() {
    this.setData({ playingAudio: '' })
    this.refreshAudioOn('')
  },
  // 播放态变化：仅重算各楼层 audioOn 标志（wxml 不做等值比较）
  refreshAudioOn(url) {
    this.setData({ comments: this.data.comments.map(c => ({
      ...c, audioOn: url === c.mediaUrl, replies: (c.replies || []).map(x => ({ ...x, audioOn: url === x.mediaUrl })) })) })
  },

  async submitComment() {
    if (this.data.commentBusy || this.data.recording) return
    const body = String(this.data.commentDraft || '').trim()
    const img = this.data.pendingImage
    const aud = this.data.pendingAudio
    if (img && (img.uploading || !img.data)) return wx.showToast({ title: '图片还在上传', icon: 'none' })
    if (!body && !img && !aud) return wx.showToast({ title: '说点什么或发张图吧', icon: 'none' })
    if (body.length > 500) return wx.showToast({ title: '评论最多 500 字', icon: 'none' })
    this.setData({ commentBusy: true, commentMsg: '' })
    try {
      await api.ensureLogin()
      const fs = wx.getFileSystemManager()
      let media = null
      if (img) media = { kind: 'image', data: img.data }
      else if (aud) {
        const size = fs.statSync(aud.path).size
        if (size > 700 * 1024) throw { msg: '语音超过 700KB，请重录' }
        media = { kind: 'audio', data: fs.readFileSync(aud.path, 'base64') }
      }
      const me = await api.getMe().catch(() => null)
      const payload = { body, replyTo: this.data.replyTarget ? this.data.replyTarget.id : 0 }
      if (media) payload.media = media
      const r = await api.request('/c/notes/' + this.id + '/comments', 'POST', payload)
      const attachKind = media ? media.kind : null
      const mediaUrl = attachKind === 'image' ? api.img(img.data) : (attachKind === 'audio' ? aud.path : '')
      const mine = this.decorate({ id: r.id, body, author: (me && me.nickname) || '我', avatar: me && me.avatarUrl ? api.img(me.avatarUrl) : null,
        when: '', created_at: '', media_kind: attachKind, mediaUrl, media_state: 1, likes: 0, liked: false, mine: true, byAuthor: false,
        replyAuthor: this.data.replyTarget ? this.data.replyTarget.label : null })
      if (this.data.replyTarget) {
        const tid = this.data.replyTarget.root || this.data.replyTarget.id
        const comments = this.data.comments.map(c => {
          if (c.id !== tid) return c
          const replies = c.replies.concat(mine)
          return { ...c, replies, repliesCount: (Number(c.repliesCount) || 0) + 1, repliesLeft: Math.max(0, (Number(c.repliesCount) || 0) + 1 - replies.length) }
        })
        this.setData({ comments: this.deriveAll(comments), commentTotal: this.data.commentTotal + 1,
          commentDraft: '', canSend: false, replyTarget: null, pendingImage: null, pendingAudio: null })
      } else {
        this.setData({ comments: this.deriveAll([mine].concat(this.data.comments)),
          commentTotal: this.data.commentTotal + 1, commentDraft: '', canSend: false, pendingImage: null, pendingAudio: null })
      }
      const n = this.data.n
      if (n) this.setData({ n: { ...n, commentCount: Number(n.commentCount || 0) + 1 } })
      wx.showToast({ title: r.pending ? (attachKind === 'audio' ? '语音审核中，通过后展示' : '图片审核中，通过后展示') : '评论已发布', icon: 'success' })
    } catch (e) { this.setData({ commentMsg: e.msg || '评论失败，请重试' }) }
    finally { this.setData({ commentBusy: false }) }
  },
  async likeComment(e) {
    const id = e.currentTarget.dataset.id
    const liked = e.currentTarget.dataset.liked
    try {
      const r = await api.request(`/c/notes/${this.id}/comments/${id}/like`, 'PUT', { liked: !liked })
      const patch = x => x.id === id ? { ...x, liked: r.liked, likes: r.likes } : x
      const patchTree = c => {
        const hit = patch(c)
        if (hit !== c) return hit
        if (c.replies && c.replies.some(x => x.id === id)) return { ...c, replies: c.replies.map(patch) }
        return c
      }
      this.setData({ comments: this.deriveAll(this.data.comments.map(patchTree)) })
    } catch (err) { wx.showToast({ title: err.msg || '操作失败', icon: 'none' }) }
  },
  deleteComment(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({ title: '删除评论？', content: '删除后不可恢复。', success: async m => {
      if (!m.confirm) return
      try {
        await api.request(`/c/notes/${this.id}/comments/${id}`, 'DELETE')
        const strip = c => {
          if (c.id === id) return null
          if (c.replies && c.replies.some(x => x.id === id)) return { ...c, replies: c.replies.filter(x => x.id !== id) }
          return c
        }
        this.setData({ comments: this.deriveAll(this.data.comments.map(strip).filter(Boolean)), commentTotal: Math.max(0, this.data.commentTotal - 1) })
        const n = this.data.n
        if (n) this.setData({ n: { ...n, commentCount: Math.max(0, Number(n.commentCount || 0) - 1) } })
        wx.showToast({ title: '已删除' })
      } catch (err) { wx.showToast({ title: err.msg || '删除失败', icon: 'none' }) }
    } })
  },
  onShareAppMessage() {
    if (this.data.n && this.data.n.isPrivate) return { title: '旅行笔记', path: '/package-content/pages/square/index' }
    return { title: (this.data.n && this.data.n.title) || '向往的自由 · 旅行笔记', path: '/package-content/pages/note/index?id=' + this.id }
  },
})
