// 仅对已装载月度演示数据的本机模拟器执行，不创建业务数据。
import a from 'miniprogram-automator'
import assert from 'node:assert/strict'
import fs from 'node:fs'
const base=process.env.MP_BASE||'http://127.0.0.1:8080',out='test/evidence-mpolish/'
assert.equal(base,'http://127.0.0.1:8080');fs.mkdirSync(out,{recursive:true})
const auth=await(await fetch(base+'/m/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:'mock-chenjie',merchantId:1})})).json();assert.equal(auth.code,0)
const m=await a.connect({wsEndpoint:'ws://127.0.0.1:9422'})
const wait=()=>new Promise(r=>setTimeout(r,700)),errors=[];m.on('exception',e=>errors.push(e))
try{
  await m.evaluate((b,d)=>Object.assign(getApp().globalData,{apiBase:b,token:d.token,role:d.role,merchant:d.merchant}),base,auth.data)
  let p=await m.reLaunch('/pages/orders/index');await wait();await(await p.$('.search-field input')).input('演示样例·月1108-');await wait()
  let d=await p.data(),pages=1
  while(d.hasMore){assert.ok(pages<=11);await(await p.$('.load-more')).tap();await wait();d=await p.data();pages++}
  assert.equal(d.orders.length,120);assert.equal(new Set(d.orders.map(o=>o.order_no)).size,120)
  await m.screenshot({path:out+'month-orders.png'})
  await(await p.$$('.filter-chip'))[3].tap();await wait();d=await p.data();while(d.hasMore){await(await p.$('.load-more')).tap();await wait();d=await p.data()};assert.equal(d.orders.length,30);assert.ok(d.orders.every(o=>Number(o.status)===70))
  await(await p.$$('.filter-chip'))[0].tap();await wait();await(await p.$('.order-date-filter picker')).trigger('change',{value:4});await wait();await(await p.$$('picker'))[1].trigger('change',{value:'2026-10-10'});await wait();assert.equal((await p.data()).orders.length,4);await m.screenshot({path:out+'month-oldest-day.png'})
  console.log('PASS 120 monthly orders across all pages, 30 refunds, earliest-day four orders')
  p=await m.reLaunch('/pages/supply/index');await wait();await(await p.$('.filter-bottom picker')).trigger('change',{value:3});await wait();d=await p.data();const index=d.groups.findIndex(g=>g.title.includes('月度演示')&&g.count>12);assert.ok(index>=0)
  await(await p.$$('.group-heading'))[index].tap();await wait();d=await p.data();assert.equal(d.groups[index].sessions.length,6);assert.ok(d.groups[index].hasMore)
  await m.evaluate(y=>wx.pageScrollTo({scrollTop:y,duration:0}),200+index*60);await wait()
  await m.screenshot({path:out+'month-stock-six.png'})
  // 使用实际“再显示”入口，避免调用页面方法替代交互。
  let found=false;for(const row of await p.$$('.group-footer'))if((await row.text()).includes('再显示')){await row.tap();found=true;break}assert.ok(found)
  await wait();assert.equal((await p.data()).groups[index].sessions.length,12)
  console.log('PASS historical product group expands six and loads six more')
  p=await m.reLaunch('/pages/index/index');await wait();await(await p.$('.workbench-period picker')).trigger('change',{value:2});await wait();d=await p.data();assert.equal(d.stats.week.length,30);assert.ok(d.stats.week.every(w=>w.orders>=3));assert.equal(d.weekTotal,d.wb.todayOrders)
  await m.screenshot({path:out+'home-history.png'});await m.evaluate(()=>wx.pageScrollTo({scrollTop:800,duration:0}));await wait();await m.screenshot({path:out+'month-trend.png'});await m.evaluate(()=>wx.pageScrollTo({scrollTop:0,duration:0}));await wait()
  assert.equal(errors.length,0,JSON.stringify(errors));fs.writeFileSync(out+'month-ui.json',JSON.stringify({base,monthlyOrders:120,refunds:30,pages,oldestDayOrders:4,groupInitial:6,groupAfterMore:12,trendDays:30,summaryMatchesTrend:true,exceptions:errors},null,2))
  console.log('PASS 30 nonempty trend days and matching dashboard order total')
}finally{await m.disconnect()}
