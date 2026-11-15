// 笔记详情（小红书化改造）：图集 swiper → 作者行 → 标题正文 → 话题 → 评论 → 底部操作栏
// 数据全在 JS 预计算，wxml 只做取值（分包 WXML 铁律）
const api = require('../../../utils/api')
Page({
  data: {
    n: null, loadTxt: '加载中…',
    reporting: false, reportReason: '', reportMsg: '', reportBusy: false,
    comments: [], commentTotal: 0, commentDraft: '', commentBusy: false, commentMsg: '',
    liked: false, likeCount: 0, current: 0, mediaLabel: '', hasGallery: false,
  },
  onLoad(q) { this.id = q.id; this.page = 1 },
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
  previewImage(e) { const urls = this.data.n.imagesFull; wx.previewImage({ urls, current: urls[e.currentTarget.dataset.i] || urls[e.currentTarget.dataset.url] || urls[0] }) },

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

  /* ---------- 评论 ---------- */
  async fetchComments(reset) {
    try {
      const page = reset ? 1 : this.page + 1
      const d = await api.request('/c/notes/' + this.id + '/comments?page=' + page + '&pageSize=20')
      this.page = page
      this.hasMore = d.items.length >= d.pageSize
      this.setData({ comments: reset ? d.items : this.data.comments.concat(d.items) })
    } catch (e) { /* 评论加载失败不阻塞正文 */ }
  },
  onCommentInput(e) { this.setData({ commentDraft: e.detail.value }) },
  async submitComment() {
    if (this.data.commentBusy) return
    const content = String(this.data.commentDraft || '').trim()
    if (content.length < 4 || content.length > 200) return wx.showToast({ title: '评论需 4 至 200 字', icon: 'none' })
    this.setData({ commentBusy: true, commentMsg: '' })
    try {
      await api.request('/c/notes/' + this.id + '/comments', 'POST', { content })
      const me = await api.getMe().catch(() => null)
      this.setData({
        commentDraft: '', commentMsg: '',
        comments: [{ id: 'local-' + Date.now(), content, author: (me && me.nickname) || '我', avatar: me && me.avatarUrl ? api.img(me.avatarUrl) : '', when: '刚刚' }].concat(this.data.comments),
      })
      const n = this.data.n
      if (n) this.setData({ n: { ...n, commentCount: Number(n.commentCount || 0) + 1 } })
      wx.showToast({ title: '评论已发布', icon: 'success' })
    } catch (e) { this.setData({ commentMsg: e.msg || '评论失败，请重试' }) }
    finally { this.setData({ commentBusy: false }) }
  },
  loadMoreComments() { if (this.hasMore) this.fetchComments(false) },
  onShareAppMessage() { return { title: (this.data.n && this.data.n.title) || '向往的自由 · 旅行笔记', path: '/pages/home/index' } },
})
