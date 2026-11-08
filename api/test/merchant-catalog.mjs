import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
const require=createRequire(import.meta.url)
const {stockView,orderView,businessDay}=require('../../mini-b/utils/catalog-view.js')
const now=Date.parse('2026-11-07T17:00:00Z')
assert.equal(businessDay(now),'2026-11-08')
const list=[{id:1,product_id:1,title:'同名商品',depart_date:'2026-11-09',quota:12,left_seats:2,status:1,price_adult:12550},{id:2,product_id:1,title:'同名商品',depart_date:'2026-11-21',quota:12,left_seats:6,status:3,price_adult:20000},{id:3,product_id:2,title:'同名商品',depart_date:'2026-11-09',quota:10,left_seats:10,status:1,price_adult:30000},{id:4,product_id:1,title:'同名商品',depart_date:'2026-11-01',quota:12,left_seats:4,status:1,price_adult:10000}]
let v=stockView(list,{},now);assert.equal(v.groups.length,2,'不同ID的同名商品必须独立分组');assert.equal(v.filteredCount,3);assert.ok(v.groups.every(g=>!g.expanded),'默认不堆出全部团期');assert.equal(v.availableSeats,12,'停售和历史名额不能计作可售库存')
v=stockView(list,{kw:'11-21',expandedKey:'1'},now);assert.equal(v.filteredCount,1);assert.equal(v.groups[0].sessions[0].id,2);assert.equal(v.groups[0].expanded,true)
v=stockView(list,{range:'past'},now);assert.equal(v.filteredCount,1);assert.equal(v.groups[0].sessions[0].statusLabel,'已过期')
v=stockView(list,{status:'tight'},now);assert.equal(v.filteredCount,1);assert.equal(v.groups[0].sessions[0].priceLabel,'125.50')
v=stockView(list,{range:'week'},now);assert.equal(v.filteredCount,2)
assert.equal(orderView([{title:'茶会',order_no:'WL123',status:30},{title:'茶会',order_no:'WL456',status:70}], 'WL456','refund').matchedCount,1)
let honor
const fixture={level:{levels:[],metrics:{reviews:0},next:null},groups:[],badges:[0,1,2,3,4,5].map(status=>({id:status,owned:true,granted_at:'2026-11-08',proof:{code:'CODE'+status,status,confirmed:status===2}}))}
vm.runInNewContext(fs.readFileSync(new URL('../../mini-b/pages/honor/index.js',import.meta.url),'utf8'),{Page:p=>{honor=p},require:()=>({request:async()=>fixture}),getApp:()=>({globalData:{token:'fixture'}}),wx:{}})
honor.setData=d=>Object.assign(honor.data,d)
await honor.fetch();assert.equal(honor.data.proofRecords.length,6);assert.equal(honor.data.proofRecords.filter(r=>r.proofState==='已确认').length,1,'排队、封存、重试、人工处理、提交中不能冒充确认完成')
console.log('库存按ID分组、日期交叉筛选、可售余量、展开保持与金额小数：通过')
