const api=require('./api')
module.exports=async function receipt(url,stillCurrent=()=>true){
 try{
  const r=await api.request(url),file=wx.env.USER_DATA_PATH+'/'+r.name
  if(!stillCurrent())return
  wx.getFileSystemManager().writeFileSync(file,r.data,'base64')
  if(r.contentType==='application/pdf')wx.openDocument({filePath:file,showMenu:true})
  else wx.previewImage({urls:[file]})
 }catch(e){wx.showToast({title:e.msg||'回单暂不可用',icon:'none'})}
}
