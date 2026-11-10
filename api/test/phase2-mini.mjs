// 仅隔离库、临时小程序副本；不修改正式AppID/上传版本。
import automator from 'miniprogram-automator'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {assertIsolatedDb} from './_guard.mjs'
import {one,closeDb} from '../src/db.mjs'
import {jwtSign} from '../src/auth.mjs'
assertIsolatedDb('phase2-mini')
const out=process.env.PHASE2_EVIDENCE
assert.ok(out,'设置 PHASE2_EVIDENCE')
fs.mkdirSync(out,{recursive:true})
const mini=await automator.connect({wsEndpoint:process.env.AUTO_WS||'ws://127.0.0.1:9433'})
async function wait(fn){for(let i=0;i<35;i++){try{const r=await fn();if(r)return r}catch{}await new Promise(r=>setTimeout(r,600))}throw new Error('模拟器条件超时')}
try{
 await wait(async()=>(await mini.currentPage())?.path)
 console.log('模拟器首屏就绪')
 const uid=Number(process.env.PHASE2_UID||2),token=jwtSign({end:'c',uid})
 await mini.evaluate(token=>{getApp().globalData.token=token;wx.setStorageSync('token',token)},token)
 console.log('隔离登录已设置')
 const paths=[
  ['/package-promo/pages/products/index','products',async p=>(await p.data('rows'))?.length>0],
  ['/package-promo/pages/freedom/index','freedom',async p=>(await p.data('rows'))?.length>0],
  ['/package-promo/pages/records/index?kind=commissions','commissions',async p=>!(await p.data('loading'))],
  ['/package-promo/pages/records/index?kind=withdrawals','withdrawals',async p=>!(await p.data('loading'))],
  ['/package-promo/pages/work/index','cooperation',async p=>!(await p.data('loading'))],
  ['/package-tour/pages/booking/index?id=1','booking',async p=>!!(await p.data('priceSummary'))&&!(await p.data('pricing'))],
 ]
 for(const [url,name,ready]of paths){
  console.log('打开 '+name)
  await mini.reLaunch(url);await wait(async()=>{const p=await mini.currentPage();return p.path===url.slice(1).split('?')[0]&&await ready(p)})
  const p=await mini.currentPage();assert.ok(!(await p.data('error')),name+': '+(await p.data('error')))
  if(name==='products'){
   const button=await wait(()=>p.$('.card button'));await button.tap();await wait(async()=>!!(await p.data('material')));const m=await p.data('material');assert.ok(m.path.includes('id=1'));console.log('产品素材：真实码模式='+!m.mock)
  }
  if(name==='booking'){
   const rights=await p.data('freedomRows');assert.ok(rights.length);const usable=rights.find(x=>x.eligible);assert.ok(usable,'需准备适用补贴')
   await mini.evaluate(id=>{const p=getCurrentPages()[getCurrentPages().length-1];const i=p.data.freedomRows.findIndex(r=>r.id===id);p.chooseFreedom({detail:{value:i+1}})},usable.id);await wait(async()=>!(await p.data('pricing')));assert.ok(!(await p.data('freedomError')));assert.equal(await p.data('freedomDiscount'),'50.00')
  }
  await mini.screenshot({path:path.join(out,'mini-a-'+name+'.png')});console.log('✓ 实际模拟器 '+name+' 渲染与数据通过')
 }
}finally{await mini.disconnect();await closeDb()}
