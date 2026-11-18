// A-03：旅行笔记一级 tab 页（方案 A：旅豆并入我的资产摘要，笔记升一级位）
// 数据复用首页作品区同款接口 /c/notes/feed；未登录/失败态不影响页面结构。
const api = require('../../utils/api')
Page({
  data: { notes: [], page: 1, loading: true, error: '', hasMore: false, introShown: false },
  onShow() { if (!this.data.notes.length) this.fetch(true) },
  onPullDownRefresh() { this.fetch(true).then(() => wx.stopPullDownRefresh()) },
  retry() { this.fetch(true) },
  fetch(reset) {
    if (reset) this.setData({ page: 1, loading: true, error: '' })
    else this.setData({ loading: true })
    const page = reset ? 1 : this.data.page + 1
    return api.request('/c/notes/feed?page=' + page + '&pageSize=10').then((d) => {
      const items = (d.items || []).map((x) => ({
        id: x.id, title: x.title || '无标题笔记', cover: x.cover || '', video: !!x.hasVideo,
        author: x.author || '', place: x.scenicName || x.productTitle || '',
        excerpt: x.excerpt || (x.title || '').slice(0, 30),
        likes: Number(x.likeCount) || 0, comments: Number(x.commentCount) || 0,
      }))
      this.setData({
        notes: reset ? items : this.data.notes.concat(items),
        page, loading: false, hasMore: items.length >= 10,
        introShown: this.data.introShown || !!items.length,
        error: '',
      })
    }).catch((e) => {
      this.setData({ loading: false, error: e.msg === '未登录' ? '登录后可浏览旅行笔记' : (e.msg || '笔记加载失败，请稍后重试') })
    })
  },
  loadMore() { if (!this.data.loading && this.data.hasMore) this.fetch(false) },
  onCoverError(e) {
    const id = Number(e.currentTarget.dataset.id)
    this.setData({ notes: this.data.notes.map((n) => n.id === id ? { ...n, cover: '' } : n) })
  },
  goCompose() { wx.navigateTo({ url: '/package-content/pages/compose/index' }) },
  goNote(e) { wx.navigateTo({ url: '/package-content/pages/note/index?id=' + e.currentTarget.dataset.id }) },
  goLogin() { wx.navigateTo({ url: '/pages/me/index' }) },
})
