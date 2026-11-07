// 笔记详情独立页（P2）：数据全在 JS 预计算，wxml 只做取值（分包 WXML 铁律）
const api = require('../../../utils/api')
Page({
  data: { n: null, loadTxt: '加载中…', reporting: false, reportReason: '', reportMsg: '', reportBusy: false },
  onLoad(q) { this.id = q.id },
  onShow() { if(this.id)this.fetch() },
  async fetch() {
    try {
      await api.ensureLogin()
      const n = await api.request('/c/notes/' + this.id)
      this.setData({ liked: n.liked, likeCount: n.likeCount, n: { ...n, when: String(n.published_at || '').replace('T', ' ').slice(0, 16), html: n.text || n.body || '' } })
    } catch (e) { this.setData({ n: null, loadTxt: '内容暂未加载（演示模式）' }) }
  },
  async toggleLike() {
    try {
      const r = await api.request('/c/notes/' + this.id + '/like', this.data.liked ? 'DELETE' : 'POST')
      this.setData({ liked: r.liked, likeCount: r.likeCount })
    } catch (e) { wx.showToast({ title: e.msg || '操作失败', icon: 'none' }) }
  },
  toggleReport() { this.setData({reporting:!this.data.reporting,reportMsg:''}) },
  onReportReason(e) { this.setData({reportReason:e.detail.value}) },
  async submitReport() {
    if(this.data.reportBusy)return
    this.setData({reportBusy:true,reportMsg:''})
    try { const r=await api.request('/c/notes/'+this.id+'/report','POST',{reason:this.data.reportReason});this.setData({reporting:false,reportReason:'',reportMsg:r.duplicate?'你已举报过该笔记，可在创作中心查看结果':'举报已提交，可在创作中心查看结果'}) }
    catch(e){this.setData({reportMsg:e.msg||'提交失败，请重试'})}
    finally{this.setData({reportBusy:false})}
  },
})
