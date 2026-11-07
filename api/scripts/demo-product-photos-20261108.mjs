// 默认预览；只改本批精确匹配的商品图片，正常上传图不覆盖，修改通过版本化后台API。
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { content } from './demo-content-20261108.mjs'
const apply=process.argv.includes('--apply'),base=process.env.API_BASE || 'http://127.0.0.1:8080'
assert.equal(base,'http://127.0.0.1:8080');assert.notEqual(process.env.NODE_ENV,'production')
const metadata=JSON.parse(fs.readFileSync(new URL('../../docs/摄影素材来源与许可-20261108.json',import.meta.url)))
const targets=content.map(p=>({title:p.title,image:p.images[0]}))
assert.equal(new Set(targets.map(x=>x.image)).size,targets.length,'每项新商品必须有不同摄影封面')
if(!apply)console.log(JSON.stringify({apply:false,targets},null,2))
else {
  assert.ok(process.env.ADMIN_PASSWORD)
  const apiDir=fs.realpathSync(process.env.DEMO_API_DIR || new URL('../',import.meta.url))
  assert.ok(apiDir.replaceAll('\\','/').endsWith('/wanderlust/api'),'明确指定主工作区DEMO_API_DIR')
  const req=async(method,url,body,token)=>{
    const r=await(await fetch(base+url,{method,headers:{'content-type':'application/json',authorization:'Bearer '+(token||'')},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)})).json()
    if(r.code!==0)throw new Error(url+': '+JSON.stringify(r.data || r.msg));return r.data
  }
  // 校验许可目录中的字节，保留旧文件，不重写同名不同内容文件。
  for(const m of metadata){
    const bytes=fs.readFileSync(new URL('../demo-assets/photos/'+m.name+'.jpg',import.meta.url))
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex').toUpperCase(),m.sha256)
    const dst=path.join(apiDir,'static',m.file)
    if(fs.existsSync(dst))assert.ok(fs.readFileSync(dst).equals(bytes),'同名照片内容不同')
    else fs.writeFileSync(dst,bytes)
    assert.equal((await fetch(base+m.file)).status,200)
  }
  const {token}=await req('POST','/admin/login',{username:process.env.ADMIN_USER || 'admin',password:process.env.ADMIN_PASSWORD})
  const list=await req('GET','/admin/products',null,token),results=[]
  for(const t of targets){
    const matches=list.filter(x=>x.title===t.title);assert.equal(matches.length,1,'必须精确找到唯一商品：'+t.title)
    const id=matches[0].id,current=await req('GET','/admin/entities/product/'+id,null,token)
    const old=current.values.images || []
    assert.ok(old.every(x=>x.startsWith('/uploads/reference-')),'已有非参考上传图，停止覆盖以供检查')
    const values={images:[t.image],share_image:t.image}
    const changed=old[0]!==t.image || old.length!==1 || current.values.share_image!==t.image
    if(changed)await req('PUT','/admin/entities/product/'+id,{values,expectedVersion:current.version,versionReason:'按商品主题逐项更换不同的已授权真实摄影封面，保留其他资料'},token)
    results.push({id,...t,changed})
  }
  if(process.env.DEMO_REPORT)fs.writeFileSync(process.env.DEMO_REPORT,JSON.stringify({results},null,2))
  console.log(JSON.stringify({results},null,2))
}
