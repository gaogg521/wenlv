const api = require('../../../utils/api')
const receipt=require('../../../utils/receipt')
Page({
  data:{subjects:[],resources:[],current:null,error:'',note:'',loading:true,projects:[],profits:[],payments:[],feedback:[],page:1,total:0,from:'',to:'',productId:''},
  onShow(){this.load()},
  async load(){
    this.seq=(this.seq || 0)+1
    this.setData({subjects:[],resources:[],current:null,error:'',note:'',loading:true})
    try {await api.ensureLogin();const d=await api.request('/c/work-contexts');this.setData({subjects:d.subjects});if(d.subjects.length)await this.select(d.subjects[0].id)}
    catch(e){this.setData({error:e.msg || '加载失败，请重试'})}
    finally{this.setData({loading:false})}
  },
  choose(e){this.select(Number(e.currentTarget.dataset.id))},
  async select(id){
    const seq=this.seq=(this.seq || 0)+1
    this.setData({current:null,resources:[],projects:[],profits:[],payments:[],feedback:[],error:'',note:'',page:1,total:0,from:'',to:'',productId:''})
    try {const d=await api.request('/c/work-contexts/'+id);if(seq!==this.seq)return;const labels={merchant:'履约门店',supplier:'供应商',cocreator:'共创项目'};this.setData({current:d.subject,resources:d.resources.map(r=>({...r,label:labels[r.kind]})),note:d.note});await this.details(1)}
    catch(e){if(seq===this.seq)this.setData({error:e.msg || '授权已变更，请重新进入'})}
  },
  async details(page){
    if(!this.data.current)return
    const sid=this.data.current.id,seq=this.seq,detailSeq=this.detailSeq=(this.detailSeq||0)+1,money=v=>(Number(v||0)/100).toFixed(2)
    this.setData({projects:[],profits:[],payments:[],feedback:[],error:''})
    try{const [projects,profits,feedback]=await Promise.all([api.request('/c/cooperation/'+sid+'/projects?page='+page),api.request('/c/cooperation/'+sid+'/profits?page='+page+'&from='+encodeURIComponent(this.data.from)+'&to='+encodeURIComponent(this.data.to)+'&productId='+encodeURIComponent(this.data.productId)),api.request('/c/cooperation/'+sid+'/feedback')]);if(seq!==this.seq||detailSeq!==this.detailSeq)return
     this.setData({projects:projects.rows.map(p=>({...p,contracts:(p.contracts||[]).map(c=>({...c,investText:money(c.investAmount),shareText:(c.shareBp/100)+'%',roleText:c.role===1?'资金合作':'商品合作'}))})),profits:profits.rows.map(x=>({...x,baseText:money(x.base_amount),amountText:money(x.amount),paidText:money(x.paid_amount),pendingText:money(x.amount-x.paid_amount),adjustText:money(x.adjustments),shareText:x.share_bp==null?'历史未单独快照':(x.share_bp/100)+'%',version:x.rule_snapshot?(typeof x.rule_snapshot==='string'?JSON.parse(x.rule_snapshot):x.rule_snapshot).version:'历史记录',statusText:{0:'待付款/部分付款',1:'已登记结清',2:'已作废'}[x.status]})),feedback:feedback.rows,page,total:profits.total,hasNext:page*profits.pageSize<profits.total||page*projects.pageSize<projects.total,note:profits.note})
    }catch(e){if(seq===this.seq)this.setData({error:e.msg||'查询失败，请重试'})}
  },
  prev(){if(this.data.page>1)this.details(this.data.page-1)},next(){if(this.data.hasNext)this.details(this.data.page+1)},
  async loadPayments(e){const sid=this.data.current.id,seq=this.seq;this.setData({payments:[]});try{const d=await api.request('/c/cooperation/'+sid+'/profits/'+e.currentTarget.dataset.id+'/payments');if(seq!==this.seq)return;this.setData({payments:d.rows.map(x=>({...x,amountText:(x.amount/100).toFixed(2),statusText:{0:'待复核',1:'有效',2:'驳回',3:'被冲正',4:'撤回'}[x.status]}))})}catch(e){wx.showToast({title:e.msg||'加载失败',icon:'none'})}},
  receipt(e){const seq=this.seq;receipt('/c/cooperation/'+this.data.current.id+'/payments/'+e.currentTarget.dataset.id+'/receipt',()=>seq===this.seq)},
  queryInput(e){this.setData({[e.currentTarget.dataset.field]:e.detail.value})},applyQuery(){this.details(1)},
  async sendFeedback(e){const sid=this.data.current.id,pid=e.currentTarget.dataset.id;const r=await new Promise(resolve=>wx.showModal({title:'分润对账反馈',editable:true,placeholderText:'请写明需核对的具体问题（4–500字）',success:resolve}));if(!r.confirm)return;try{await api.request('/c/cooperation/'+sid+'/feedback','POST',{profitId:pid,detail:r.content});if(this.data.current.id===sid)this.details(this.data.page);wx.showToast({title:'已提交核对'})}catch(e){wx.showToast({title:e.msg||'提交失败',icon:'none'})}},
})
