// 临时副本、隔离库内复核预订页补贴布局；正式项目与真实资金不操作。
import automator from 'miniprogram-automator'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import {assertIsolatedDb} from './_guard.mjs'
import {jwtSign} from '../src/auth.mjs'
assertIsolatedDb('phase2-ui-mini')
const out=process.env.PHASE2_EVIDENCE;assert.ok(out,'PHASE2_EVIDENCE required');fs.mkdirSync(out,{recursive:true})
const mini=await automator.connect({wsEndpoint:process.env.AUTO_WS||'ws://127.0.0.1:9434'})
async function wait(fn){for(let i=0;i<40;i++){try{const x=await fn();if(x)return x}catch{}await new Promise(r=>setTimeout(r,500))}throw new Error('等待页面条件超时')}
try{
 await wait(async()=>(await mini.currentPage())?.path)
 await mini.evaluate(token=>{getApp().globalData.token=token;wx.setStorageSync('token',token)},jwtSign({uid:Number(process.env.PHASE2_UID||2),end:'c'}))
 await mini.reLaunch('/package-tour/pages/booking/index?id=1')
 await wait(async()=>{const p=await mini.currentPage();return p.path==='package-tour/pages/booking/index'&&(await p.data('freedomRows'))?.length&&!(await p.data('pricing'))})
 let p=await mini.currentPage()
 await mini.callWxMethod('pageScrollTo',{selector:'.bk-benefit',offsetTop:-70,duration:0})
 await new Promise(r=>setTimeout(r,250))
 await mini.screenshot({path:path.join(out,'booking-benefit-unselected.png')})
 await mini.evaluate(()=>{const p=getCurrentPages().at(-1),i=p.data.freedomRows.findIndex(r=>r.eligible);if(i<0)throw new Error('无适用权益');p.chooseFreedom({detail:{value:i+1}})})
 await wait(async()=>!(await (await mini.currentPage()).data('pricing')))
 p=await mini.currentPage();assert.ok(!(await p.data('freedomError')))
 const title=await p.$('.bk-benefit-top .bk-fee-title'),picker=await p.$('.bk-benefit-picker'),rule=await p.$('.bk-benefit-rule'),amount=await p.$('.bk-benefit-amount')
 const metrics={title:{offset:await title.offset(),size:await title.size(),text:await title.text()},picker:{offset:await picker.offset(),size:await picker.size(),text:await picker.text()},rule:{offset:await rule.offset(),size:await rule.size(),text:await rule.text()},amount:{offset:await amount.offset(),size:await amount.size(),text:await amount.text()}}
 assert.ok(!metrics.picker.text.includes('满'),'选择按钮不能再拼接整段权益名称')
 assert.ok(Number(metrics.title.offset.left)+Number(metrics.title.size.width)<Number(metrics.picker.offset.left),'标题与更换按钮不得重叠')
 assert.ok(Number(metrics.rule.offset.left)+Number(metrics.rule.size.width)<=Number(metrics.amount.offset.left),'满减说明与减免金额不得重叠')
 assert.ok(metrics.rule.text.includes('满100元'));assert.ok(metrics.rule.text.includes('减50元'));assert.ok(metrics.amount.text.includes('50.00'))
 assert.equal((await p.data('useBean')),false)
 await mini.screenshot({path:path.join(out,'booking-benefit-selected.png')})
 fs.writeFileSync(path.join(out,'booking-benefit-metrics.json'),JSON.stringify(metrics,null,2));console.log(JSON.stringify(metrics,null,2));console.log('预订页补贴选择/已选状态、金额与按钮布局实际模拟器通过')
}finally{await mini.disconnect()}
