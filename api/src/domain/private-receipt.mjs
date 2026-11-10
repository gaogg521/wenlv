import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { BizError } from '../db.mjs'
const dir=fileURLToPath(new URL('../../static/receipts/',import.meta.url))
export const validReceipt = u => /^\/receipts\/[\w.-]+\.(jpg|jpeg|png|webp|pdf)$/.test(String(u||''))
export function uploadReceipt(body) {
  const ext=String(body.ext||'jpg').toLowerCase(),b=Buffer.from(String(body.data||''),'base64')
  if(!['jpg','jpeg','png','webp','pdf'].includes(ext)||!b.length||b.length>5*1024*1024)throw new BizError(1001,'选择5MB内图片或PDF回单')
  const signatures={pdf:b.subarray(0,5).toString()==='%PDF-',png:b.subarray(0,8).toString('hex')==='89504e470d0a1a0a',jpg:b[0]===255&&b[1]===216,jpeg:b[0]===255&&b[1]===216,webp:b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP'}
  if(!signatures[ext])throw new BizError(1001,'回单文件类型不匹配')
  fs.mkdirSync(dir,{recursive:true});const name='receipt_'+crypto.randomBytes(16).toString('hex')+'.'+ext;fs.writeFileSync(path.join(dir,name),b)
  return {url:'/receipts/'+name}
}
export function readReceipt(url) {
  if(!validReceipt(url))throw new BizError(1004,'暂无可下载回单')
  const name=path.basename(url),file=path.join(dir,name)
  if(!fs.existsSync(file))throw new BizError(1004,'回单文件不存在，请联系财务')
  return {name,contentType:name.endsWith('.pdf')?'application/pdf':'image/'+(name.endsWith('.jpg')?'jpeg':name.split('.').pop()),data:fs.readFileSync(file).toString('base64')}
}
