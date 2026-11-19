// 旅行笔记广场（小红书化改造）：双列瀑布流——3:4 封面卡 + 标题两行 + 作者行 + 点赞
// 三期①话题聚合：?topic= / ?scenic= 进页即过滤；搜索框可改话题；卡片话题可点再聚合
// WXML 铁律：左右两列与点赞态全部在 JS 预计算，wxml 只做取值与单三元
const api = require('../../../utils/api')

function decodeFilterParam(value = '') {
  try { return decodeURIComponent(value) } catch { return value }
}
Page({
  data: {
    leftItems: [], rightItems: [], page: 1, pageSize: 20, loading: true, error: '', demo: false, hasMore: false,
    topic: '', topicInput: '', scenicId: 0, scenicName: '',
  },
  onLoad(q) {
    // 详情页话题/景区可点跳转进来的聚合视图
    this.applyFilter(decodeFilterParam(q.topic), Number(q.scenic) || 0, decodeFilterParam(q.scenicName))
    this.setData({ topicInput: this.data.topic })
  },
  // 过滤头/空态文案全部预计算（wxml 只取值）
  applyFilter(topic, scenicId, scenicName) {
    const hasFilter = Boolean(topic || scenicId)
    // 景区与话题可同时生效：过滤头两部分都展示
    const parts = []
    if (scenicId) parts.push('📍 ' + (scenicName || ('景区 #' + scenicId)))
    if (topic) parts.push('#' + topic)
    this.setData({
      topic: topic || '', scenicId: scenicId || 0, scenicName: scenicName || '',
      hasFilter,
      filterLabel: parts.join(' · '),
      emptyText: hasFilter ? '这个范围还没有公开笔记' : '还没有公开笔记 · 抢先发一篇',
    })
  },
  onShow() {
    // A3 返回保留浏览位置：从作品详情/发布器返回时恢复离开前的滚动位置
    // （数据与筛选本来随页面实例保留；首次进入 _st 为空不触发）
    if (this._st > 0 && (this.data.leftItems.length || this.data.rightItems.length) && this._returned) {
      wx.pageScrollTo({ scrollTop: this._st, duration: 0 })
      this._returned = false
    }
    if (!this.data.leftItems.length && !this.data.rightItems.length) this.fetch(true)
  },
  onPageScroll(e) { this._st = e.scrollTop },
  onHide() { this._returned = true },
  retry() { this.fetch(true) },
  // bindtap 会把事件对象传进 reset 位——单独包一层，保证翻页语义正确
  more() { this.fetch(false) },
  onTopicInput(e) { this.setData({ topicInput: e.detail.value }) },
  searchTopic() {
    const t = String(this.data.topicInput || '').trim().replace(/^#+/, '').slice(0, 20)
    this.applyFilter(t, 0, '')
    this.fetch(true)
  },
  clearTopic() {
    this.setData({ topicInput: '' })
    this.applyFilter('', 0, '')
    this.fetch(true)
  },
  goTopic(e) {
    const t = e.currentTarget.dataset.topic
    if (!t || t === this.data.topic) return
    this.setData({ topicInput: t })
    this.applyFilter(t, 0, '')
    this.fetch(true)
  },
  // 奇偶分列：封面统一 3:4，无需按高度精确配平；标题行数差异由卡片自适应
  split(items) {
    const left = [], right = []
    items.forEach((x, i) => (i % 2 ? right : left).push(x))
    return { leftItems: left, rightItems: right }
  },
  fetch(reset) {
    const page = reset ? 1 : this.data.page + 1
    this.setData({ loading: true, error: '' })
    const topic = this.data.topic || ''
    const scenic = this.data.scenicId || 0
    const qs = 'page=' + page + '&pageSize=' + this.data.pageSize + '&topic=' + encodeURIComponent(topic) + '&scenic=' + scenic
    return api.request('/c/notes/feed?' + qs).then((d) => {
      if (topic !== (this.data.topic || '') || scenic !== (this.data.scenicId || 0)) return // 已切话题，丢弃旧响应
      const raw = (reset ? d.items : this.all().concat(d.items)).map((x) => ({
        ...x, productText: x.productTitle ? ' · ' + x.productTitle : '',
        cover: x.cover || '', avatar: x.avatar || '', authorChar: (x.author || '旅').slice(0, 1),
        excerpt: (x.title || '无标题笔记').slice(0, 24),
        cardTopics: (x.topics || []).slice(0, 2),
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
  // T-02：下拉刷新回到第一页重新加载，完成后收起转圈
  onPullDownRefresh() {
    Promise.resolve(this.fetch(true)).then(() => wx.stopPullDownRefresh()).catch(() => wx.stopPullDownRefresh())
  },
  // T-05：分享（带当前话题/景区过滤参数）
  onShareAppMessage() {
    const topic = this.data.topic || ''
    const scenic = this.data.scenicId || 0
    let path = '/package-content/pages/square/index'
    if (topic || scenic) {
      path += '?topic=' + encodeURIComponent(topic) + '&scenic=' + scenic
      if (this.data.scenicName) path += '&scenicName=' + encodeURIComponent(this.data.scenicName)
    }
    return { title: '旅行笔记广场', path }
  },
  onShareTimeline() { return { title: '旅行笔记广场' } }
})
