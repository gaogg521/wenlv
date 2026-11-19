const api = require('../../utils/api')
const { orderView, money } = require('../../utils/catalog-view')
const { day, periodQuery } = require('../../utils/period')
Page({
  data: { emptyDesc: '换个关键词、状态或日期范围再试\n游客下单后 1 分钟内会出现在这里',  orders: [], visibleOrders: [], loaded: false, kw: '', status: 'all', page: 1, presetDepart: '', periodIndex: 0, periodNames: ['全部历史','今日','近7天','近30天','指定日期'], customDate: day(), today: day(), filters: [{k:'all',n:'全部'},{k:'waiting',n:'待接待'},{k:'done',n:'已核销/完成'},{k:'refund',n:'退款'},{k:'refund_pending',n:'退款中'}] },
  retry() { this.fetch() },
  onShow() {
    // B2 工作台「待接待/异常待处理」下钻预设：一次性消费（depart=今日出发 / status=refund）
    const preset = wx.getStorageSync('ordersPreset') || null
    if (preset) {
      wx.removeStorageSync('ordersPreset')
      this.setData({ status: preset.status || 'all', presetDepart: preset.depart || '', periodIndex: 0, kw: '' })
    } else if (this._consumed) {
      this.setData({ presetDepart: '' })
    }
    this._consumed = true
    this.fetch()
  },
  onPullDownRefresh() { this.fetch().then(() => wx.stopPullDownRefresh()) },
  async fetch(append = false) {
    const requestId = this._requestId = (this._requestId || 0) + 1
    if (!getApp().globalData.token) { this.setData({ orders: [], loaded: true, hasMore:false, waitingCount:0 }); this.applyFilters(); return }
    const page = append ? this.data.page + 1 : 1
    this.setData({ loadingMore: true })
    try {
      const depart = this.data.presetDepart || ''
      const rows = await api.request('/m/orders?page='+page+'&pageSize=12&state='+this.data.status+'&kw='+encodeURIComponent(this.data.kw)+(depart?'&depart='+depart:'')+'&'+periodQuery(this.data.periodIndex,this.data.customDate,true))
      if (requestId !== this._requestId) return
      // X-01：statusText 由服务端字典下发（商户视角），页面不再自建状态表
      const mapped = rows.map(x => Object.assign({}, x, { isDemo:String(x.contact_name || '').startsWith('演示样例'), contactLabel:String(x.contact_name || '').startsWith('演示样例') ? '演示游客' : x.contact_name || '游客', priceLabel: money(x.amount_pay), statusText: x.statusText || '处理中' }))
      const orders = append ? this.data.orders.concat(mapped) : mapped
      this.setData({ orders, page, hasMore: rows.length === 12, loadingMore: false, waitingCount: orders.filter(o => [20,30].includes(Number(o.status))).length, loaded: true, error: '' }); this.applyFilters()
    } catch (e) { if (requestId === this._requestId) { this.setData({ loaded: true, loadingMore: false, errCode: Number(e.code) || 0, error: e.msg || '订单加载失败' }); if (!append) { this.setData({orders:[]}); this.applyFilters() } } }
  },
  applyFilters() { const v = orderView(this.data.orders, this.data.kw, this.data.status, this.data.orders.length); this.setData({visibleOrders:v.visibleOrders,matchedCount:v.matchedCount}) },
  onSearch(e) { this.setData({ kw: e.detail.value }); clearTimeout(this._searchTimer); this._searchTimer=setTimeout(()=>this.fetch(),250) },
  filterStatus(e) { this.setData({ status: e.currentTarget.dataset.k }); this.fetch() },
  // 清除「今日出发」下钻预设，恢复常规列表
  clearPreset() { this.setData({ presetDepart: '' }); this.fetch() },
  filterPeriod(e) { this.setData({periodIndex:Number(e.detail.value)}); this.fetch() },
  selectDate(e) { this.setData({customDate:e.detail.value}); this.fetch() },
  loadMore() { if (!this.data.loadingMore) this.fetch(true) },
  onUnload() { clearTimeout(this._searchTimer); this._requestId=(this._requestId||0)+1 },
  goDetail(e) { wx.navigateTo({ url: '/pages/order-detail/index?no=' + e.currentTarget.dataset.no }) },
})
