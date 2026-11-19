// X-04 评价闭环 · 商户端评价列表与回复（回复提交后进入平台审核，审核通过游客可见）
// B-05：游客笔记 tab——本店商品关联的已发布公开稿（只读；私密/审核中/驳回/下架不出现）
const api = require('../../utils/api')
Page({
  data: { emptyDesc: '游客完成行程后可以评价本店商品\n在这里回复后经平台审核对游客可见', emptyNotesDesc: '游客发布关联本店商品或景区的公开笔记后\n会出现在这里（私密与审核中的不可见）',
    tab: 'reviews',
    items: [], total: 0, page: 1, pageSize: 20, loading: true, error: '',
    replyStatus: 'all', rating: 0,
    replyFilters: [{ k: 'all', n: '全部' }, { k: 'pending', n: '待回复/被下架' }, { k: 'replied', n: '已回复' }],
    ratingFilters: [{ v: 0, n: '全部评分' }, { v: 5, n: '5 星' }, { v: 4, n: '4 星' }, { v: 3, n: '3 星' }, { v: 2, n: '2 星' }, { v: 1, n: '1 星' }],
    notes: [], notesTotal: 0, notesPage: 1,
  },
  onShow() { this.fetch() },
  onPullDownRefresh() { this.fetch().then(() => wx.stopPullDownRefresh()) },
  retry() { this.fetch() },
  switchTab(e) { this.setData({ tab: e.currentTarget.dataset.k }); this.fetch() },
  async fetch(append = false) {
    if (!append) { this.setData({ loading: true, error: '' }) }
    try {
      if (this.data.tab === 'notes') {
        const page = append ? this.data.notesPage + 1 : 1
        const d = await api.request('/m/notes?page=' + page + '&pageSize=' + this.data.pageSize)
        const notes = append ? this.data.notes.concat(d.items) : d.items
        this.setData({ notes, notesTotal: d.total, notesPage: page, loading: false, error: '', hasMore: page * this.data.pageSize < d.total })
        return
      }
      const page = append ? this.data.page + 1 : 1
      const d = await api.request('/m/reviews?page=' + page + '&pageSize=' + this.data.pageSize +
        '&replyStatus=' + this.data.replyStatus + (this.data.rating ? '&rating=' + this.data.rating : ''))
      const items = append ? this.data.items.concat(d.items) : d.items
      this.setData({ items: items.map(x => ({ ...x, stars: '★★★★★'.slice(0, Number(x.rating)) + '☆☆☆☆☆'.slice(0, 5 - Number(x.rating)), replyStateText: Number(x.reply_status) === 1 ? '已展示' : Number(x.reply_status) === 2 ? '被下架' : (x.reply ? '待审核' : '待回复') })), total: d.total, page, loading: false, error: '', hasMore: page * this.data.pageSize < d.total })
    } catch (e) { this.setData({ loading: false, errCode: Number(e.code) || 0, error: e.msg || '加载失败' }) }
  },
  loadMore() { if (this.data.hasMore && !this.data.loading) this.fetch(true) },
  filterReply(e) { this.setData({ replyStatus: e.currentTarget.dataset.k }); this.fetch() },
  filterRating(e) { this.setData({ rating: Number(e.currentTarget.dataset.v) }); this.fetch() },
  reply(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '回复评价', editable: true, placeholderText: '2-200 字，提交后平台审核通过即对游客展示',
      success: (r) => {
        if (!r.confirm) return
        const content = String(r.content || '').trim()
        if (content.length < 2) return wx.showToast({ title: '至少 2 个字', icon: 'none' })
        api.request('/m/reviews/' + id + '/reply', 'POST', { content })
          .then(() => { wx.showToast({ title: '已提交，待平台审核' }); this.fetch() })
          .catch((err) => wx.showToast({ title: err.msg || '回复失败', icon: 'none' }))
      },
    })
  },
})
