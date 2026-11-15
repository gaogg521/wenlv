// 旅行笔记广场（小红书化改造）：双列瀑布流——3:4 封面卡 + 标题两行 + 作者行 + 点赞
// WXML 铁律：左右两列与点赞态全部在 JS 预计算，wxml 只做取值与单三元
const api = require('../../../utils/api')
Page({
  data: { leftItems: [], rightItems: [], page: 1, pageSize: 20, loading: true, error: '', demo: false, hasMore: false },
  onShow() { if (!this.data.leftItems.length && !this.data.rightItems.length) this.fetch(true) },
  retry() { this.fetch(true) },
  // bindtap 会把事件对象传进 reset 位——单独包一层，保证翻页语义正确
  more() { this.fetch(false) },
  // 奇偶分列：封面统一 3:4，无需按高度精确配平；标题行数差异由卡片自适应
  split(items) {
    const left = [], right = []
    items.forEach((x, i) => (i % 2 ? right : left).push(x))
    return { leftItems: left, rightItems: right }
  },
  fetch(reset) {
    const page = reset ? 1 : this.data.page + 1
    this.setData({ loading: true, error: '' })
    api.request('/c/notes/feed?page=' + page + '&pageSize=' + this.data.pageSize).then((d) => {
      const raw = (reset ? d.items : this.all().concat(d.items)).map((x) => ({
        ...x, productText: x.productTitle ? ' · ' + x.productTitle : '',
        cover: x.cover || '', avatar: x.avatar || '', authorChar: (x.author || '旅').slice(0, 1),
      }))
      this.setData({ page, loading: false, hasMore: d.items.length >= d.pageSize, demo: false, ...this.split(raw) })
    }).catch((e) => {
      if (api.demoAllowed()) this.setData({ loading: false, demo: true, error: '' })
      else this.setData({ loading: false, demo: false, error: e.msg || '加载失败，请检查网络后重试' })
    })
  },
  all() { return this.data.leftItems.concat(this.data.rightItems) },
  like(e) {
    const id = Number(e.currentTarget.dataset.id)
    const liked = e.currentTarget.dataset.liked
    api.request('/c/notes/' + id + '/like', liked ? 'DELETE' : 'POST').then((r) => {
      const patch = (x) => x.id === id ? { ...x, liked: r.liked, likeCount: r.likeCount } : x
      this.setData({ leftItems: this.data.leftItems.map(patch), rightItems: this.data.rightItems.map(patch) })
    }).catch((e2) => wx.showToast({ title: e2.msg || '操作失败', icon: 'none' }))
  },
  goNote(e) { wx.navigateTo({ url: '/package-content/pages/note/index?id=' + e.currentTarget.dataset.id }) },
  goCreate() { wx.navigateTo({ url: '/package-content/pages/compose/index' }) },
})
