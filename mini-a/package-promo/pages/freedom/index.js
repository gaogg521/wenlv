const api=require('../../../utils/api')
Page({
 data:{rows:[],status:'available',error:'',loading:true,page:1,total:0,
  // 自由豆对所有登录游客开放（无资格门槛，无需「无资格」态）；各筛选的空态文案各不相同（文案放 JS，WXML 只取值）
  emptyMap:{
   available:{title:'还没有可用的自由豆',desc:'官方补贴权益会随活动发放到你的账户\n下单时自动抵扣，无需领取',action:'去商城逛逛可抵现的好物',url:'/pages/shop/index'},
   locked:{title:'没有待支付占用的权益',desc:'使用自由豆下单后未支付时\n权益会先占用，取消订单后自动释放',action:'',url:''},
   used:{title:'还没有使用记录',desc:'下单抵扣成功后，可在这里回看每笔抵扣\n点「查看使用订单」可回到对应订单',action:'看看可用的权益',url:''},
   expired:{title:'没有已过期的权益',desc:'权益有效期以发放时的标注为准\n过期不可恢复，留意到期时间',action:'',url:''},
   revoked:{title:'没有撤销记录',desc:'被撤销的权益会在这里留痕\n如有疑问可联系平台客服核对',action:'',url:''},
  },
  filters:[{id:'available',name:'可用'},{id:'locked',name:'待支付占用'},{id:'used',name:'已用'},{id:'expired',name:'过期'},{id:'revoked',name:'撤销'}]},
 onShow(){this.load(1)},
 // T-02：下拉刷新回到第一页重新加载，完成后收起转圈
 onPullDownRefresh(){Promise.resolve(this.load(1)).then(()=>wx.stopPullDownRefresh()).catch(()=>wx.stopPullDownRefresh())},
 filter(e){this.setData({status:e.currentTarget.dataset.id});this.load(1)},
 retry(){this.load(this.data.page)},prev(){if(this.data.page>1)this.load(this.data.page-1)},next(){if(this.data.hasNext)this.load(this.data.page+1)},
 // 空态文案随当前筛选切换（WXML 只做取值：变量键索引 emptyMap[status] 会炸分包编译，故在这里算好）
 setEmptyTexts(){const t=this.data.emptyMap[this.data.status]||{};this.setData({emptyTitle:t.title||'暂无内容',emptyDesc:t.desc||'',emptyAction:t.action||'',emptyUrl:t.url||''})},
 goEmptyAction(){const t=this.emptyMap[this.data.status];if(t&&t.action==='看看可用的权益'){this.setData({status:'available'});this.load(1)}},
 apply(){this.setData({rows:(this.all||[]).filter(x=>x.status===this.data.status)})},
 async load(page=1){const seq=this.seq=(this.seq||0)+1;this.setEmptyTexts();this.setData({loading:true,error:'',rows:[]});try{await api.ensureLogin();const d=await api.request('/c/freedom?page='+page+'&status='+this.data.status);if(seq!==this.seq)return;this.all=d.rows.map(x=>({...x,thresholdText:(x.threshold/100).toFixed(2),discountText:(x.discount/100).toFixed(2),scopeText:[x.products.length?'指定产品 '+x.products.join('、'):'全部产品',x.cities.length?'城市 '+x.cities.join('、'):'',x.channels.length?'频道 '+x.channels.join('、'):'',x.dates.length?'团期 '+x.dates.join('、'):''].filter(Boolean).join(' · ')}));this.setData({page:d.page,total:d.total,hasNext:d.page*d.pageSize<d.total});this.apply()}catch(e){if(seq===this.seq){this.all=[];this.setData({error:e.msg||'加载失败，请稍后重试'})}}finally{if(seq===this.seq)this.setData({loading:false})}},
 order(e){wx.navigateTo({url:'/package-order/pages/order-detail/index?no='+e.currentTarget.dataset.no})},
})
