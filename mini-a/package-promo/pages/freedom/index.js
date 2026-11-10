const api=require('../../../utils/api')
Page({
 data:{rows:[],status:'available',error:'',loading:true,page:1,total:0,filters:[{id:'available',name:'可用'},{id:'locked',name:'待支付占用'},{id:'used',name:'已用'},{id:'expired',name:'过期'},{id:'revoked',name:'撤销'}]},
 onShow(){this.load(1)},filter(e){this.setData({status:e.currentTarget.dataset.id});this.load(1)},retry(){this.load(this.data.page)},prev(){if(this.data.page>1)this.load(this.data.page-1)},next(){if(this.data.hasNext)this.load(this.data.page+1)},
 apply(){this.setData({rows:(this.all||[]).filter(x=>x.status===this.data.status)})},
 async load(page=1){const seq=this.seq=(this.seq||0)+1;this.setData({loading:true,error:'',rows:[]});try{await api.ensureLogin();const d=await api.request('/c/freedom?page='+page+'&status='+this.data.status);if(seq!==this.seq)return;this.all=d.rows.map(x=>({...x,thresholdText:(x.threshold/100).toFixed(2),discountText:(x.discount/100).toFixed(2),scopeText:[x.products.length?'指定产品 '+x.products.join('、'):'全部产品',x.cities.length?'城市 '+x.cities.join('、'):'',x.channels.length?'频道 '+x.channels.join('、'):'',x.dates.length?'团期 '+x.dates.join('、'):''].filter(Boolean).join(' · ')}));this.setData({page:d.page,total:d.total,hasNext:d.page*d.pageSize<d.total});this.apply()}catch(e){if(seq===this.seq){this.all=[];this.setData({error:e.msg||'加载失败'})}}finally{if(seq===this.seq)this.setData({loading:false})}},
 order(e){wx.navigateTo({url:'/package-order/pages/order-detail/index?no='+e.currentTarget.dataset.no})},
})
