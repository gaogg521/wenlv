const api = require('../../../utils/api')
Page({
  data:{subjects:[],resources:[],current:null,error:'',note:'',loading:true},
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
    this.setData({current:null,resources:[],error:'',note:''})
    try {const d=await api.request('/c/work-contexts/'+id);if(seq!==this.seq)return;const labels={merchant:'履约门店',supplier:'供应商',cocreator:'共创项目'};this.setData({current:d.subject,resources:d.resources.map(r=>({...r,label:labels[r.kind]})),note:d.note})}
    catch(e){if(seq===this.seq)this.setData({error:e.msg || '授权已变更，请重新进入'})}
  },
})
