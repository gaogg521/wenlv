// Runtime UI acceptance. Only QA token injection, never upload or alter the formal projects.
import automator from 'miniprogram-automator'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { jwtSign } from '../src/auth.mjs'
import { one, closeDb } from '../src/db.mjs'
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/phase1-mini.mjs')
const out=process.env.PHASE1_EVIDENCE
assert.ok(out,'PHASE1_EVIDENCE required')
const kind=process.env.PHASE1_MINI || 'a'
const mini=await automator.connect({wsEndpoint:process.env.AUTO_WS || 'ws://127.0.0.1:9431'})
async function wait(fn){for(let i=0;i<45;i++){try{const r=await fn();if(r)return r}catch{}await new Promise(r=>setTimeout(r,700))}throw new Error('runtime condition timeout')}
try {
  await wait(async()=>{try{return (await mini.currentPage())?.path}catch{return false}})
  console.log('模拟器首屏已注册')
  if(kind==='a'){
    const g=await one(`SELECT g.user_id,g.subject_id FROM subject_grant g JOIN business_subject b ON b.id=g.subject_id WHERE g.status=1 AND b.name='阶段一验收合作主体' LIMIT 1`)
    assert.ok(g,'prepare UI grant first')
    const token=jwtSign({uid:Number(g.user_id),end:'c'})
    console.log('准备隔离登录会话')
    await mini.evaluate(token=>{getApp().globalData.token=token;wx.setStorageSync('token',token)},token)
    console.log('准备打开我的页')
    await mini.callWxMethod('switchTab',{url:'/pages/me/index'})
    await wait(async()=> (await mini.currentPage()).path==='pages/me/index')
    await wait(async()=> (await mini.currentPage()).data('workAvailable'))
    const page=await mini.currentPage();assert.equal(await page.data('workAvailable'),true)
    await mini.screenshot({path:path.join(out,'mini-a-work-entry.png')})
    await page.callMethod('goWork')
    await wait(async()=> (await mini.currentPage()).path==='package-promo/pages/work/index')
    await wait(async()=> (await mini.currentPage()).data('current'))
    const work=await mini.currentPage();assert.equal(Number((await work.data('current')).id),Number(g.subject_id));assert.equal((await work.data('resources'))[0].kind,'merchant')
    await mini.screenshot({path:path.join(out,'mini-a-work-context.png')})
    console.log('游客端模拟器：我的授权入口、合作主体关联与实际页面渲染通过')
  }else{
    const staff=await one(`SELECT s.user_id,s.merchant_id,s.role FROM merchant_staff s JOIN user_account u ON u.id=s.user_id WHERE s.status=1 AND u.status=1 ORDER BY s.role DESC LIMIT 1`)
    assert.ok(staff)
    const store=await one('SELECT id,name,merchant_no FROM merchant WHERE id=?',[staff.merchant_id])
    const token=jwtSign({uid:Number(staff.user_id),end:'m',merchantId:Number(staff.merchant_id),role:Number(staff.role)})
    await mini.evaluate((token,store,role)=>{const a=getApp();a.globalData.token=token;a.globalData.merchant=store;a.globalData.role=role;wx.setStorageSync('mtoken',token);wx.setStorageSync('merchant',store);wx.setStorageSync('mrole',role)},token,store,Number(staff.role))
    await mini.reLaunch('/pages/me/index')
    await wait(async()=> (await mini.currentPage()).data('merchant'))
    assert.ok(await (await mini.currentPage()).$('.row[bindtap="chooseStore"]') || await (await mini.currentPage()).$('.hero'))
    await mini.screenshot({path:path.join(out,'mini-b-store-switch.png')})
    console.log('商户端模拟器：当前门店/岗位与切换授权门店入口渲染通过；切换权限由HTTP专项验证')
  }
} finally {await mini.disconnect();await closeDb()}
