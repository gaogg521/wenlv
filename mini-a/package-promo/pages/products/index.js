const api=require('../../../utils/api')
Page({
 data:{rows:[],page:1,total:0,error:'',loading:false,material:null,qrcode:'',poster:'',qual:'',emptyDesc:'可推广的线路由平台运营授权后出现在这里\n授权到期或产品停售时会暂时下架',
  // 6001=推广资格未生效/暂停（无资格态不给重试，给说明与去处）；其余为普通失败态
  deniedReasons:[
   {q:'这是什么',a:'平台授权线路的推广素材库：专属推广码、转发文案、产品海报都在这里获取'},
   {q:'为什么现在不能用',a:'推广资格未生效或已暂停，暂时取不到可推广的产品'},
   {q:'怎么开通',a:'点下方按钮联系平台客服咨询；资格生效后，运营授权的产品会自动出现在这里'},
  ]},
 onShow(){this.load(1)},
 async load(page){
  if(this.data.loading)return
  this.setData({loading:true,error:'',material:null,qrcode:'',poster:''})
  try{await api.ensureLogin();const d=await api.request('/c/promote/products?page='+page);this.setData({rows:d.rows.map(p=>({...p,rateText:(p.rate.rateBp/100)+'%',sessions:p.sessions.map(s=>({...s,priceText:((s.priceNow||s.price_adult)/100).toFixed(2)}))})),total:d.total,page:d.page,hasNext:d.page*d.pageSize<d.total,qual:'',error:''})}
  catch(e){
   if(Number(e.code)===6001)this.setData({rows:[],qual:'denied',error:''})
   else this.setData({rows:[],qual:'',error:e.msg||'加载失败，请稍后重试'})
  }finally{this.setData({loading:false})}
 },
 retry(){this.load(this.data.page)},prev(){if(this.data.page>1)this.load(this.data.page-1)},next(){if(this.data.hasNext)this.load(this.data.page+1)},
 async makeMaterial(e){
  if(this.making)return;this.making=true;this.setData({material:null,qrcode:'',poster:''})
  try{const d=await api.request('/c/promote/products/'+e.currentTarget.dataset.id+'/material','POST',{channel:'mini'});this.setData({material:d,qrcode:d.image?'data:image/png;base64,'+d.image:''})}
  catch(e){wx.showToast({title:e.msg||'生成失败',icon:'none'})}finally{this.making=false}
 },
 copy(){if(this.data.material)wx.setClipboardData({data:this.data.material.text})},
 onShareAppMessage(){const d=this.data.material;return d?{title:d.text,path:d.path,imageUrl:d.cover||undefined}:{title:'向往的自由',path:'/pages/home/index'}},
 async makePoster(){
  if(!this.data.material||!this.data.qrcode)return wx.showToast({title:'真实小程序码配置后可制作海报',icon:'none'})
  try{
   const file=wx.env.USER_DATA_PATH+'/promo-code.png';wx.getFileSystemManager().writeFileSync(file,this.data.material.image,'base64')
   const ctx=wx.createCanvasContext('poster',this),m=this.data.material
   ctx.setFillStyle('#fffaf0');ctx.fillRect(0,0,600,800);ctx.setFillStyle('#235b43');ctx.setFontSize(28);ctx.fillText('向往的自由 · 主题游',32,65)
   ctx.setFillStyle('#222');ctx.setFontSize(25);const title=m.title||'';for(let i=0;i<Math.ceil(title.length/18);i++)ctx.fillText(title.slice(i*18,i*18+18),32,120+i*38)
   ctx.drawImage(file,130,270,340,340);ctx.setFontSize(20);ctx.fillText('扫码查看实时团期与价格',32,665);ctx.setFontSize(17);ctx.fillText('推广授权至 '+m.validTo,32,710);ctx.fillText('价格以订单为准，停售或授权失效后请重新生成',32,750)
   await new Promise(resolve=>ctx.draw(false,resolve))
   const r=await new Promise((resolve,reject)=>wx.canvasToTempFilePath({canvasId:'poster',width:600,height:800,destWidth:600,destHeight:800,success:resolve,fail:reject},this));this.setData({poster:r.tempFilePath})
  }catch(e){wx.showToast({title:'海报制作失败，请重试',icon:'none'})}
 },
 save(){if(!this.data.poster)return;wx.saveImageToPhotosAlbum({filePath:this.data.poster,success:()=>wx.showToast({title:'已保存'}),fail:()=>wx.showModal({title:'未能保存',content:'可在设置中允许保存到相册后重试',confirmText:'打开设置',success:r=>{if(r.confirm)wx.openSetting({})}})})},
})
