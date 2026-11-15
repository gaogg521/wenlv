// 笔记详情（小红书式）：图集 swiper → 作者行 → 标题正文 → 话题 → 评论区（盖楼展开/回复@/点赞/图片评论/删除）→ 底部操作栏
// 数据全在 JS 预计算，wxml 只做取值（分包 WXML 铁律）
const api = require('../../../utils/api')
Page({
  data: {
    n: null, loadTxt: '加载中…',
    reporting: false, reportReason: '', reportMsg: '', reportBusy: false,
    comments: [], commentTotal: 0, commentNext: null, commentMsg: '',
    commentDraft: '', commentBusy: false,
    replyTarget: null,           // {id, label} 回复对象；null=发一级评论
    pendingImage: null,          // {kind:'image', src, data} 待发送的图片评论附件
    liked: false, likeCount: 0, current: 0, mediaLabel: '', hasGallery: false,
  },
  onLoad(q) { this.id = q.id; this.cursor = null },
  onShow() { if (this.id) { this.fetch(); this.fetchComments(true) } },
  async fetch() {
    try {
      await api.ensureLogin()
      const n = await api.request('/c/notes/' + this.id)
      const imgs = (n.images || []).map(api.img)
      const blocks = Array.isArray(n.blocks)
        ? n.blocks.map(b => b.type === 'text' ? { ...b, isText: true } : { ...b, isText: false })
        : null
      this.setData({
        liked: n.liked, likeCount: n.likeCount,
        n: { ...n, when: String(n.published_at || '').replace('T', ' ').slice(0, 16), html: n.text || '',
          imagesFull: imgs, blocksReady: blocks, topicsReady: n.topics || [] },
        hasGallery: imgs.length > 0 && !n.video,
        mediaLabel: imgs.length ? '1/' + imgs.length : '',
      })
    } catch (e) { this.setData({ n: null, loadTxt: e.msg || '内容暂未加载，请重试' }) }
  },
  onSwiper(e) {
    const label = (e.detail.current + 1) + '/' + (this.data.n ? this.data.n.imagesFull.length : 0)
    this.setData({ current: e.detail.current, mediaLabel: label })
  },
  previewImage(e) { const urls = this.data.n.imagesFull; wx.previewImage({ urls, current: urls[e.currentTarget.dataset.i] || urls[0] }) },
  previewCommentImage(e) { wx.previewImage({ urls: [e.currentTarget.dataset.url] }) },

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

  /* ---------- 评论区（V87 社交层） ---------- */
  // 评论项预计算：头像字、作者标、时间；一级评论带 replies 数组（展开后内嵌）
  decorate(r) {
    return { ...r, avatarChar: (r.author || '旅').slice(0, 1), when: String(r.created_at || '').replace('T', ' ').slice(0, 16), replies: r.replies || [] }
  },
  async fetchComments(reset) {
    try {
      await api.ensureLogin()
      const qs = reset ? '' : (this.data.commentNext ? '&before=' + this.data.commentNext : '')
      const d = await api.request('/c/notes/' + this.id + '/comments' + (qs ? '?' + qs.slice(1) : ''))
      const roots = d.items.map(r => ({ ...this.decorate(r), replies: [], repliesCount: Number(r.replies) || 0, repliesLeft: Number(r.replies) || 0, expanded: false, more: null }))
      this.cursor = d.next
      this.setData({
        comments: reset ? roots : this.data.comments.concat(roots),
        commentTotal: Number(d.total) || 0, commentNext: d.next || null,
      })
    } catch (e) { /* 评论加载失败不阻塞正文 */ }
  },
  loadMoreComments() { if (this.data.commentNext) this.fetchComments(false) },
  // 楼内回复：服务端倒序拉取，展示按时间正序；repliesLeft = 总数 - 已载入
  async expandReplies(e) {
    const rootId = e.currentTarget.dataset.root
    try {
      await api.ensureLogin()
      const d = await api.request('/c/notes/' + this.id + '/comments?root=' + rootId)
      const replies = d.items.map(r => this.decorate(r)).reverse()
      const comments = this.data.comments.map(c => c.id === rootId
        ? { ...c, replies, expanded: true, more: d.next || null, repliesLeft: Math.max(0, (Number(c.repliesCount) || 0) - replies.length) } : c)
      this.setData({ comments })
    } catch (err) { wx.showToast({ title: err.msg || '回复加载失败', icon: 'none' }) }
  },
  async moreReplies(e) {
    const rootId = e.currentTarget.dataset.root
    const root = this.data.comments.find(c => c.id === rootId)
    if (!root || !root.more) return
    try {
      await api.ensureLogin()
      const d = await api.request('/c/notes/' + this.id + '/comments?root=' + rootId + '&before=' + root.more)
      const older = d.items.map(r => this.decorate(r)).reverse()
      const comments = this.data.comments.map(c => c.id === rootId
        ? { ...c, replies: older.concat(c.replies), more: d.next || null, repliesLeft: Math.max(0, (Number(c.repliesCount) || 0) - older.length - c.replies.length) } : c)
      this.setData({ comments })
    } catch (err) { wx.showToast({ title: err.msg || '回复加载失败', icon: 'none' }) }
  },
  // 回复某条评论（回复楼内回复也挂同一楼一层）
  startReply(e) {
    const { id, root, author } = e.currentTarget.dataset
    this.setData({ replyTarget: { id, root: root || id, label: author || '评论' } })
  },
  cancelReply() { this.setData({ replyTarget: null }) },
  onCommentInput(e) { this.setData({ commentDraft: e.detail.value }) },

  // 图片评论：选 1 张（≤700KB）→ 上传 → 随评论发送
  pickCommentImage() {
    wx.chooseMedia({ count: 1, mediaType: ['image'], sizeType: ['compressed'],
      success: r => {
        const f = r.tempFiles[0]
        if (!f) return
        if (f.size > 700 * 1024) return wx.showToast({ title: '图片需 700KB 内', icon: 'none' })
        this.setData({ pendingImage: { kind: 'image', src: f.tempFilePath, data: '', uploading: true } })
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
      this.setData({ pendingImage: null })
    }
  },
  removePendingImage() { this.setData({ pendingImage: null }) },

  async submitComment() {
    if (this.data.commentBusy) return
    const body = String(this.data.commentDraft || '').trim()
    const img = this.data.pendingImage
    if (img && (img.uploading || !img.data)) return wx.showToast({ title: '图片还在上传', icon: 'none' })
    if (!body && !img) return wx.showToast({ title: '说点什么或发张图吧', icon: 'none' })
    if (body.length > 500) return wx.showToast({ title: '评论最多 500 字', icon: 'none' })
    this.setData({ commentBusy: true, commentMsg: '' })
    try {
      await api.ensureLogin()
      const me = await api.getMe().catch(() => null)
      const payload = { body, replyTo: this.data.replyTarget ? this.data.replyTarget.id : 0 }
      if (img) payload.media = { kind: 'image', data: img.data }
      const r = await api.request('/c/notes/' + this.id + '/comments', 'POST', payload)
      const mine = { id: r.id, body, author: (me && me.nickname) || '我', avatar: me && me.avatarUrl ? api.img(me.avatarUrl) : null,
        avatarChar: ((me && me.nickname) || '我').slice(0, 1), when: '刚刚', mediaKind: img ? 'image' : null,
        mediaUrl: img ? api.img(img.data) : '', likes: 0, liked: false, mine: true, byAuthor: false, replyAuthor: this.data.replyTarget ? this.data.replyTarget.label : null }
      if (this.data.replyTarget) {
        const tid = this.data.replyTarget.root || this.data.replyTarget.id
        const comments = this.data.comments.map(c => {
          if (c.id !== tid) return c
          const replies = c.replies.concat(this.decorate({ ...mine, replyAuthor: this.data.replyTarget.label }))
          return { ...c, replies, repliesCount: (Number(c.repliesCount) || 0) + 1, repliesLeft: Math.max(0, (Number(c.repliesCount) || 0) + 1 - replies.length) }
        })
        this.setData({ comments, commentTotal: this.data.commentTotal + 1, commentDraft: '', replyTarget: null, pendingImage: null })
      } else {
        this.setData({ comments: [this.decorate({ ...mine, replies: [], repliesLeft: 0 })].concat(this.data.comments),
          commentTotal: this.data.commentTotal + 1, commentDraft: '', pendingImage: null })
      }
      const n = this.data.n
      if (n) this.setData({ n: { ...n, commentCount: Number(n.commentCount || 0) + 1 } })
      wx.showToast({ title: r.pending ? '图片审核中，通过后展示' : '评论已发布', icon: 'success' })
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
      this.setData({ comments: this.data.comments.map(patchTree) })
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
        this.setData({ comments: this.data.comments.map(strip).filter(Boolean), commentTotal: Math.max(0, this.data.commentTotal - 1) })
        const n = this.data.n
        if (n) this.setData({ n: { ...n, commentCount: Math.max(0, Number(n.commentCount || 0) - 1) } })
        wx.showToast({ title: '已删除' })
      } catch (err) { wx.showToast({ title: err.msg || '删除失败', icon: 'none' }) }
    } })
  },
  onShareAppMessage() { return { title: (this.data.n && this.data.n.title) || '向往的自由 · 旅行笔记', path: '/pages/home/index' } },
})
