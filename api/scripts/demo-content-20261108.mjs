// 默认预览；--apply 通过后台实体接口新增，不直写业务库。仅限本机演示环境。
import fs from 'node:fs'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const base = process.env.API_BASE || 'http://127.0.0.1:8080'
const apply = process.argv.includes('--apply')
if (base !== 'http://127.0.0.1:8080' || process.env.NODE_ENV === 'production') throw new Error('仅允许本机8080非生产演示环境')
const oldPhotos = new Set(['water-town','bamboo','garden','cloth','tea','zongzi','camp'])
const image = name => '/uploads/reference-' + name + (oldPhotos.has(name) ? '-20261107.jpg' : '-20261108.jpg')
const disclaimer = '本内容为演示样例，不提供实际履约；摄影为场景参考图，并非本商品实物或服务现场。图片来源、作者与许可见小程序关于页。'
const rows = [
  ['朱家角寻灯记 · 水巷沉浸探案','script','310118',238,1,46,3,'zjj-canal','半日 · 4小时','12周岁以上','水巷寻踪 / 石桥解谜 / 茶馆复盘'],
  ['课植园来信 · 古镇建筑解谜','script','310118',198,1,46,43,'kezhi','半日 · 3小时','10周岁以上','园林观察 / 建筑解谜 / 故事分享'],
  ['安吉竹海 · 森林呼吸与轻瑜伽','yoga','330523',368,2,45,47,'bamboo-path','一日 · 6小时','16—65周岁','竹林慢行 / 基础舒展 / 呼吸练习'],
  ['余村慢生活 · 山野茶修周末','yoga','330523',598,2,47,48,'tea-manor','2天1夜','16—65周岁','茶山漫步 / 静心品茶 / 晨间拉伸'],
  ['青西自然课 · 亲子湿地观察','family','310118',168,1,6,44,'wetland-egret','一日 · 5小时','6—12周岁儿童与监护人','自然观察 / 叶片拓印 / 无痕野餐'],
  ['安吉竹林小队 · 亲子自然探索','family','330523',258,2,45,47,'bamboo-explore','一日 · 6小时','6—14周岁儿童与监护人','竹林寻宝 / 植物手账 / 亲子协作'],
  ['耦园拾光 · 好友园林摄影散步','sister','320508',298,3,44,45,'couple-garden','半日 · 4小时','12周岁以上','园林赏景 / 构图练习 / 午后茶叙'],
  ['平江路慢游 · 蓝印手作与茶会','sister','320508',328,3,44,46,'pingjiang','一日 · 6小时','12周岁以上','古街漫步 / 蓝印手作 / 好友茶会'],
  ['江南蓝印 · 手作体验预约','shop','320508',98,3,44,46,'indigo','到店体验 · 90分钟','8周岁以上','纹样讲解 / 手作体验 / 一份练习作品'],
  ['安吉白茶 · 山间品茗双人席','shop','330523',128,2,47,48,'tea-cups','到店体验 · 60分钟','12周岁以上','双人茶席 / 冲泡讲解 / 三轮品饮'],
  ['水乡家味 · 手包粽子体验','shop','310118',88,1,5,3,'zongzi-pair','到店体验 · 90分钟','6周岁以上，儿童须陪同','食材认识 / 手包练习 / 四枚粽子'],
  ['竹林野餐 · 双人装备预约包','shop','330523',158,2,45,47,'camp','到店领取 · 当日归还','18周岁以上领取','双人野餐垫 / 保温壶 / 营地使用指引'],
]
export const content = rows.map(([title,cat,city_code,price_from,merchant_id,supplier_id,scenic_id,photo,days_desc,age_range,steps]) => ({
  title, subtitle: '演示样例 · ' + steps.replaceAll(' / ',' · '), cat, city_code, price_from, merchant_id, supplier_id, scenic_id,
  days_desc, age_range, bean_gift: Math.round(price_from), group_size: cat === 'shop' ? '按预约人数到店' : '6—12人精品小团',
  suitable: cat === 'family' ? ['family'] : ['friends','couple'], tags: ['演示体验', cat === 'shop' ? '到店预约' : '小团慢游'],
  images: [image(photo)], share_image: image(photo), share_title: title, keywords: [title.split(' · ')[0], cat === 'shop' ? '到店体验' : '周末出游'],
  intro: '<p>' + title + '，将' + steps.replaceAll(' / ','、') + '串成一段轻松的在地体验。</p><p>' + disclaimer + '</p>',
  highlights: steps.split(' / '), itinerary: steps.split(' / ').map((title,i) => ({time: ['09:30','11:00','14:00'][i], title, desc: '演示安排；实际时间与内容待运营方确认。'})),
  transport: '自行前往集合点；以步行为主，不包含往返交通',
  meeting_point: ['','朱家角游客服务中心（演示集合点）','安吉门店服务台（演示集合点）','苏州门店服务台（演示集合点）'][merchant_id],
  includes: cat === 'shop' ? steps.split(' / ') : ['带队讲解与活动材料','行程所列体验'],
  excludes: ['往返交通','未列明的餐饮及门票','个人消费'],
  notice: '<p>'+disclaimer+'</p><p>请提前预约，到店或出发前15分钟集合。儿童须监护人陪同；雨天安排需提前确认。退改按平台统一规则。</p>',
  safety_note: '演示内容不提供真实履约。穿防滑鞋，临水及林间路段注意安全；身体不适请及时停止活动，儿童全程由监护人照看。',
  insurance_note: '本演示不提供实际承保，不另收保险费用。',
}))

const call = async (method, path, body, token) => {
  const res = await fetch(base + path, {method, headers:{'content-type':'application/json',authorization:'Bearer '+(token||'')},body:body ? JSON.stringify(body):undefined, signal:AbortSignal.timeout(20000)})
  const r = await res.json()
  if (!res.ok || r.code !== 0) throw new Error(path+': '+JSON.stringify(r.data || r.msg || r))
  return r.data
}
async function main() {
if (!apply) { console.log(JSON.stringify({apply:false,products:content},null,2)) }
else {
  assert.ok(process.env.ADMIN_PASSWORD, '请通过ADMIN_PASSWORD提供演示后台现有密码')
  const {token} = await call('POST','/admin/login',{username:process.env.ADMIN_USER || 'admin',password:process.env.ADMIN_PASSWORD})
  const existing = await call('GET','/admin/products',null,token)
  const results=[]
  for(const values of content) {
    const found=existing.find(p=>p.title===values.title)
    let id=found?.id
    if(!id) { const created=await call('POST','/admin/entities/product',{values},token); id=created.id; assert.ok(id,'创建返回缺少id'); existing.push({id,title:values.title}) }
    const current = await call('GET',`/admin/entities/product/${id}`,null,token)
    const repairedMissingPhoto = !(current.values.images || []).length
    if (repairedMissingPhoto) await call('PUT',`/admin/entities/product/${id}`,{values:{images:values.images},expectedVersion:current.version,versionReason:'为同名演示草稿补齐缺失摄影封面，保留其他已录入字段'},token)
    // 精确同标题复跑只补缺失团期，不覆盖已编辑的资料或价格。
    const {sessions}=await call('GET',`/admin/products/${id}/sessions`,null,token)
    const newSessions=[]
    for(const depart_date of ['2026-11-14','2026-11-21','2026-12-05']) {
      if(sessions.some(s=>String(s.depart_date).slice(0,10)===depart_date))continue
      const created=await call('POST','/admin/entities/session',{parentId:id,values:{depart_date,quota:values.cat==='shop'?30:12,min_go:values.cat==='shop'?1:6,price_adult:values.price_from,status:'1',gather_time:'09:30',end_time:'16:00',note:'演示可预约日期，不提供实际履约。',internal_note:'DEMO-CONTENT-20261108'}},token)
      newSessions.push(created.id)
    }
    if(!found || Number(found.status)!==1) await call('POST',`/admin/products/${id}/status`,{status:1},token)
    const detail=await call('GET','/c/tours/'+id)
    assert.equal(detail.title,values.title)
    assert.ok(detail.images.length, '缺少摄影封面')
    results.push({id,title:values.title,cat:values.cat,merchantId:values.merchant_id,created:!found,repairedMissingPhoto,newSessions})
    console.log('OK',id,values.title)
  }
  const out={base,operation:'backend-entity-api',results}
  if(process.env.DEMO_REPORT)fs.writeFileSync(process.env.DEMO_REPORT,JSON.stringify(out,null,2))
  console.log(JSON.stringify(out,null,2))
}
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main()
