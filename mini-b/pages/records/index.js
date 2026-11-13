const api = require('../../utils/api')
const { day, periodQuery } = require('../../utils/period')
Page({
  data: { list: [], loaded: false, periodIndex:0, periodNames:['全部历史','今日','近7天','近30天','指定日期'], customDate:day(), today:day(), page:1, hasMore:false },
  onShow() { this.fetch() },
  onPullDownRefresh() { this.fetch().then(()=>wx.stopPullDownRefresh()) },
  filterPeriod(e) { this.setData({periodIndex:Number(e.detail.value)});this.fetch() },
  selectDate(e) { this.setData({customDate:e.detail.value});this.fetch() },
  loadMore() { if (!this.data.loading) this.fetch(true) },
  retry() { this.fetch() },
  async fetch(append = false) {
    const requestId=this._requestId=(this._requestId||0)+1
    if (!getApp().globalData.token) return this.setData({list:[],loaded:true,hasMore:false})
    const page=append?this.data.page+1:1;this.setData({loading:true,error:''})
    try {
      const list=await api.request('/m/verify/records?page='+page+'&pageSize=20&'+periodQuery(this.data.periodIndex,this.data.customDate,true))
      if(requestId!==this._requestId)return
      const rows = list.map(r => ({ ...r, codeText: r.order_no || ('凭证 #' + r.pass_id) }))
      this.setData({list:append?this.data.list.concat(rows):rows,page,loaded:true,loading:false,hasMore:list.length===20})
    }catch(e){if(requestId===this._requestId)this.setData({loaded:true,loading:false,error:e.msg||'记录加载失败，请重试'})}
  },
})
