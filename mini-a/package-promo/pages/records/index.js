const api=require('../../../utils/api'),receipt=require('../../../utils/receipt')
const money=v=>(Number(v||0)/100).toFixed(2)
Page({
 data:{kind:'commissions',rows:[],total:0,page:1,error:'',loading:false,status:'',from:'',to:'',productId:'',summary:null,qual:'',
  // 6001=推广资格未生效/暂停：无资格态不给重试（deniedReasons 文案放 JS，WXML 只取值）
  deniedReasons:[
   {q:'这是什么',a:'推广业务的钱账记录：逐笔佣金（含观察期与冲正）和提现申请的审批、付款、回单'},
   {q:'为什么现在不能用',a:'推广资格未生效或已暂停，还没有产生属于你的佣金与提现'},
   {q:'怎么开通',a:'点下方按钮联系平台客服咨询；资格生效并产生成交后，记录会逐笔出现在这里'},
  ],
  filters:[{id:'',name:'全部'},{id:0,name:'观察期'},{id:1,name:'已放行'},{id:2,name:'已结算'},{id:3,name:'已冲正'},{id:4,name:'无效'}]},
 onLoad(q){this.setData({kind:q.kind==='withdrawals'?'withdrawals':'commissions'});if(this.data.kind==='withdrawals')this.setData({filters:[{id:'',name:'全部'},{id:0,name:'待审'},{id:3,name:'待付款'},{id:1,name:'已登记付款'},{id:2,name:'驳回'}]});wx.setNavigationBarTitle({title:this.data.kind==='withdrawals'?'提现记录':'佣金明细'});this.setKindTexts();this.load(1)},
 // 空态/错误态文案随 kind 切换（在 JS 里算好，WXML 只取值——绑定串里的 \n 转义会炸分包编译）
 setKindTexts(){const w=this.data.kind==='withdrawals';this.setData({
  errorTitle:w?'提现记录加载失败':'佣金明细加载失败',
  emptyTitle:w?'暂无提现申请':'暂无佣金记录',
  emptyDesc:w?'满足最低申请金额后，可在推广中心发起提现\n审批与付款状态会留在这里':'推广带来真实成交后，佣金会逐笔出现在这里\n观察期结束后可在推广中心申请提现',
  emptyAction:w?'返回推广中心':'去选可推广的产品'})},
 queryInput(e){this.setData({[e.currentTarget.dataset.field]:e.detail.value})},applyQuery(){this.load(1)},
 retry(){this.load(this.data.page)},prev(){if(this.data.page>1)this.load(this.data.page-1)},next(){if(this.data.hasNext)this.load(this.data.page+1)},filter(e){this.setData({status:e.currentTarget.dataset.id});this.load(1)},
 // T-02：下拉刷新回到第一页重新加载，完成后收起转圈
 onPullDownRefresh(){Promise.resolve(this.load(1)).then(()=>wx.stopPullDownRefresh()).catch(()=>wx.stopPullDownRefresh())},
 async load(page){
  const seq=this.seq=(this.seq||0)+1;this.setData({loading:true,error:'',rows:[],detail:null})
  try{await api.ensureLogin();const d=await api.request('/c/promote/'+this.data.kind+'?page='+page+'&status='+this.data.status+'&from='+encodeURIComponent(this.data.from)+'&to='+encodeURIComponent(this.data.to)+'&productId='+encodeURIComponent(this.data.productId));if(seq!==this.seq)return
   const names=this.data.kind==='withdrawals'?{0:'待审核',1:'已登记付款（以银行到账为准）',2:'已驳回',3:'审批通过，等待付款'}:{0:'观察期',1:'已放行',2:'已结算',3:'已冲正',4:'无效'}
   this.setData({rows:d.rows.map(x=>({...x,amountText:money(x.amount),baseText:money(x.base_amount),rateText:Number(x.rate_bp)/100+'%',state:names[x.status]})),page:d.page,total:d.total,hasNext:d.page*d.pageSize<d.total,summary:d.summary?{gmv:money(d.summary.gmv),validOrders:d.summary.validOrders||0,observing:money(d.summary.observing),released:money(d.summary.released),reversed:money(d.summary.reversed)}:null,qual:'',error:''})
  }catch(e){if(seq===this.seq){
   if(Number(e.code)===6001)this.setData({qual:'denied',error:''})
   else this.setData({qual:'',error:e.msg||'查询失败，请稍后重试'})
  }}finally{if(seq===this.seq)this.setData({loading:false})}
 },
 async showDetail(e){try{const d=await api.request('/c/promote/withdrawals/'+e.currentTarget.dataset.id);this.setData({detail:{...d,amountText:money(d.amount)}})}catch(e){wx.showToast({title:e.msg||'查询失败',icon:'none'})}},
 receipt(e){receipt('/c/promote/withdrawals/'+e.currentTarget.dataset.id+'/receipt')},
 async cancel(e){const id=e.currentTarget.dataset.id,r=await new Promise(resolve=>wx.showModal({title:'撤销待审提现',content:'撤销后释放待审占用，原申请保留记录，可在满足条件后重新申请。',success:resolve}));if(!r.confirm)return;try{await api.request('/c/promote/withdrawals/'+id+'/cancel','POST');await this.load(1)}catch(e){wx.showToast({title:e.msg||'撤销失败',icon:'none'})}},
})
