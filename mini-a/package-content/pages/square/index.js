// 旅行笔记广场（A-43）：已发布笔记的公开内容流——让"发布了"真正"有人看"，举报/点赞由此可达
const api = require('../../../utils/api')
Page({
  data: { items: [], page: 1, pageSize: 20, loading: true, error: '', demo: false, hasMore: false },
  onShow() { if (!this.data.items.length) this.fetch(true) },
  retry() { this.fetch(true) },
  fetch(reset) {
    const page = reset ? 1 : this.data.page + 1
    this.setData({ loading: true, error: '' })
    api.request('/c/notes/feed?page=' + page + '&pageSize=' + this.data.pageSize).then((d) => {
      const raw = reset ? d.items : this.data.items.concat(d.items)
      const items = raw.map((x) => ({ ...x, productText: x.productTitle ? ' · ' + x.productTitle : '' }))
      this.setData({ items, page, loading: false, hasMore: d.items.length >= d.pageSize, demo: false })
    }).catch((e) => {
      if (api.demoAllowed()) this.setData({ loading: false, demo: true, error: '' })
      else this.setData({ loading: false, demo: false, error: e.msg || '加载失败，请检查网络后重试' })
    })
  },
  like(e) {
    const id = Number(e.currentTarget.dataset.id)
    const liked = e.currentTarget.dataset.liked
    api.request('/c/notes/' + id + '/like', liked ? 'DELETE' : 'POST').then((r) => {
      this.setData({ items: this.data.items.map((x) => x.id === id ? { ...x, liked: r.liked, likeCount: r.likeCount } : x) })
    }).catch((e2) => wx.showToast({ title: e2.msg || '操作失败', icon: 'none' }))
  },
  goNote(e) { wx.navigateTo({ url: '/package-content/pages/note/index?id=' + e.currentTarget.dataset.id }) },
  goCreate() { wx.redirectTo({ url: '/package-content/pages/create/index' }) },
})
