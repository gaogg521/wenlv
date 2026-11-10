const api=require('./api')
module.exports=async function capture(q){
 let scene=''
 try{scene=q.scene?decodeURIComponent(q.scene):''}catch(e){throw {msg:'推广参数无效'}}
 if(!scene)return {id:q.id}
 if(!/^[pm][0-9a-z-]{1,31}$/i.test(scene))throw {msg:'推广参数无效'}
 let id=q.id
 if(!id){const d=await api.request('/c/promote/landing?scene='+encodeURIComponent(scene));id=d.productId}
 await api.ensureLogin()
 const visit=await api.request('/c/promote/visit','POST',{productId:Number(id),scene})
 wx.setStorageSync('promoScene',scene)
 wx.setStorageSync('promoProductId',visit.productId||0)
 return {id,scene}
}
