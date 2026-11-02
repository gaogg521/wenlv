import { q,one,tx,BizError } from '../db.mjs'
import { requireUser } from '../auth.mjs'
import { requireAdmin,audit,apiImg } from './_shared.mjs'
import { findBanned } from '../domain/wording.mjs'
import { noteView } from '../domain/task-review.mjs'
function reasonOf(v) {
  const s=String(v||'').trim()
  if(s.length<4||s.length>300) throw new BizError(1001,'请填写 4 至 300 字的具体原因')
  if(findBanned(s)) throw new BizError(1001,'原因含不适合展示的用语，请调整后提交')
  return s
}
function visitor(req) { const u=requireUser(req);if(u.end!=='c')throw new BizError(1003,'仅游客账号可操作');return u }
async function staff(req) {
  const a=await requireAdmin(req,['super','ops','review','city_partner'])
  if(a.role==='city_partner'&&!a.scopeCity)throw new BizError(1003,'城市账号未绑定城市')
  return a
}
function scope(a,city,current) { if(a.scopeCity&&(a.scopeCity!==city||a.scopeCity!==current))throw new BizError(1003,'仅可处理本城内容') }
async function locked(c,id,a) {
  const n=await c.one('SELECT n.*,p.city_code FROM content_note n LEFT JOIN tour_product p ON p.id=n.related_product_id WHERE n.id=? FOR UPDATE',[id])
  if(!n)throw new BizError(1004,'笔记不存在')
  if(a)scope(a,n.city_code,n.city_code)
  return n
}
async function remove(c,n,a,reason) {
  if(Number(n.status)!==2)throw new BizError(2002,'仅已发布笔记可下架，请刷新状态')
  const actor='admin:'+a.name
  const id=await c.ins('INSERT INTO content_moderation(note_id,city_code,reason,snapshot,actor) VALUES (?,?,?,?,?)',[n.id,n.city_code||null,reason,JSON.stringify({title:n.title,body:n.body}),actor])
  await c.upd('UPDATE content_note SET status=4,moderation_id=? WHERE id=?',[id,n.id])
  await c.q('UPDATE content_report SET status=2,moderation_id=?,resolution=?,actor=?,resolved_at=NOW(3) WHERE note_id=? AND status=0',[id,reason,actor,n.id])
  await audit(c,actor,'content','takedown','note-'+n.id,{status:n.status},{status:4,moderationId:id,reason})
  return id
}
function pageOf(req) {
  const page=Number(req.query.page||1)
  if(!Number.isSafeInteger(page)||page<1||page>1000000)throw new BizError(1001,'页码无效')
  return {page,size:20,offset:(page-1)*20}
}
const TABLES={reports:{table:'content_report',join:'JOIN content_note n ON n.id=x.note_id LEFT JOIN tour_product p ON p.id=n.related_product_id',city:'x.city_code'},
  appeals:{table:'content_appeal',join:'JOIN content_moderation m ON m.id=x.moderation_id JOIN content_note n ON n.id=m.note_id LEFT JOIN tour_product p ON p.id=n.related_product_id',city:'m.city_code'}}
export const contentGovernance={
  'POST /c/notes/:id/report':async req=>{
    const u=visitor(req),reason=reasonOf(req.body.reason)
    return tx(async c=>{
      const n=await locked(c,req.params.id)
      const old=await c.one('SELECT id,status FROM content_report WHERE note_id=? AND user_id=?',[n.id,u.uid])
      if(old)return {id:old.id,status:old.status,duplicate:true}
      if(Number(n.status)!==2)throw new BizError(1004,'笔记不存在或未发布')
      if(Number(n.user_id)===Number(u.uid))throw new BizError(1001,'不能举报自己的笔记')
      const id=await c.ins('INSERT INTO content_report(note_id,user_id,city_code,reason) VALUES (?,?,?,?)',[n.id,u.uid,n.city_code||null,reason])
      return {id,status:0}
    })
  },
  'GET /c/content-reports':async req=>{
    const u=visitor(req)
    return q('SELECT r.id,n.title,n.status note_status,r.reason,r.status,r.resolution,r.created_at,r.resolved_at FROM content_report r JOIN content_note n ON n.id=r.note_id WHERE r.user_id=? ORDER BY r.id DESC LIMIT 30',[u.uid])
  },
  'POST /c/notes/:id/appeal':async req=>{
    const u=visitor(req),reason=reasonOf(req.body.reason)
    return tx(async c=>{
      const n=await locked(c,req.params.id)
      if(Number(n.user_id)!==Number(u.uid))throw new BizError(1004,'作品不存在')
      if(Number(n.status)!==4||!n.moderation_id)throw new BizError(2002,'当前作品没有可申诉的下架记录')
      const old=await c.one('SELECT id,status FROM content_appeal WHERE moderation_id=?',[n.moderation_id])
      if(old)return {id:old.id,status:old.status,duplicate:true}
      const id=await c.ins('INSERT INTO content_appeal(moderation_id,user_id,reason) VALUES (?,?,?)',[n.moderation_id,u.uid,reason])
      return {id,status:0}
    })
  },
  'GET /admin/content-cases':async req=>{
    const a=await staff(req),kind=String(req.query.kind||'reports'),pg=pageOf(req),spec=TABLES[kind]
    if(!Object.hasOwn(TABLES,kind))throw new BizError(1001,'队列类型无效')
    const status=String(req.query.status||'pending')
    if(!['pending','all'].includes(status))throw new BizError(1001,'状态无效')
    const where=`WHERE 1=1${status==='pending'?' AND x.status=0':''}${a.scopeCity?` AND ${spec.city}=? AND p.city_code=?`:''}`
    const args=a.scopeCity?[a.scopeCity,a.scopeCity]:[]
    const from=`FROM ${spec.table} x ${spec.join} ${where}`
    const total=Number((await one(`SELECT COUNT(*) n ${from}`,args)).n)
    const rows=await q(`SELECT x.id,n.id note_id,n.title,x.reason,x.status,x.resolution,x.created_at,x.resolved_at ${from} ORDER BY x.id DESC LIMIT ? OFFSET ?`,[...args,pg.size,pg.offset])
    return {kind,total,page:pg.page,size:pg.size,rows}
  },
  'GET /admin/content-cases/:kind/:id':async req=>{
    const a=await staff(req),spec=TABLES[req.params.kind]
    if(!Object.hasOwn(TABLES,req.params.kind))throw new BizError(1001,'队列类型无效')
    const row=await one(`SELECT x.id,x.reason,x.status,x.resolution,n.id note_id,n.title,n.body,n.status note_status,p.city_code,${spec.city} scope_city ${req.params.kind==='appeals'?',m.reason offline_reason,m.snapshot':''} FROM ${spec.table} x ${spec.join} WHERE x.id=?`,[req.params.id])
    if(!row)throw new BizError(1004,'记录不存在')
    scope(a,row.scope_city,row.city_code)
    const snapshot=row.snapshot?(typeof row.snapshot==='string'?JSON.parse(row.snapshot):row.snapshot):null
    return {id:row.id,reason:row.reason,status:row.status,resolution:row.resolution,offlineReason:row.offline_reason||null,note:noteView({id:row.note_id,title:row.title,body:row.body,status:row.note_status},u=>apiImg(u,req)),snapshot:snapshot?noteView({id:row.note_id,...snapshot,status:4},u=>apiImg(u,req)):null}
  },
  'POST /admin/content-cases/reports/:id/verdict':async req=>{
    const a=await staff(req),reason=reasonOf(req.body.reason),action=req.body.action
    if(!['dismiss','takedown'].includes(action))throw new BizError(1001,'处理动作无效')
    const r=await one('SELECT note_id FROM content_report WHERE id=?',[req.params.id])
    if(!r)throw new BizError(1004,'举报不存在')
    return tx(async c=>{
      const n=await locked(c,r.note_id,a),rpt=await c.one('SELECT * FROM content_report WHERE id=? FOR UPDATE',[req.params.id])
      scope(a,rpt.city_code,n.city_code)
      if(Number(rpt.status)!==0)throw new BizError(2002,'举报已处理，请刷新')
      if(action==='takedown')return {moderationId:await remove(c,n,a,reason),status:2}
      await c.upd('UPDATE content_report SET status=1,resolution=?,actor=?,resolved_at=NOW(3) WHERE id=?',[reason,'admin:'+a.name,rpt.id])
      await audit(c,'admin:'+a.name,'content','report-dismiss','report-'+rpt.id,null,{reason})
      return {status:1}
    })
  },
  'POST /admin/content/:id/takedown':async req=>{
    const a=await staff(req),reason=reasonOf(req.body.reason)
    return tx(async c=>({moderationId:await remove(c,await locked(c,req.params.id,a),a,reason),status:4}))
  },
  'POST /admin/content-cases/appeals/:id/verdict':async req=>{
    const a=await staff(req),reason=reasonOf(req.body.reason),action=req.body.action
    if(!['restore','uphold'].includes(action))throw new BizError(1001,'复核动作无效')
    const row=await one('SELECT m.note_id FROM content_appeal x JOIN content_moderation m ON m.id=x.moderation_id WHERE x.id=?',[req.params.id])
    if(!row)throw new BizError(1004,'申诉不存在')
    return tx(async c=>{
      const n=await locked(c,row.note_id,a),appeal=await c.one('SELECT x.*,m.city_code FROM content_appeal x JOIN content_moderation m ON m.id=x.moderation_id WHERE x.id=? FOR UPDATE',[req.params.id])
      scope(a,appeal.city_code,n.city_code)
      if(Number(appeal.status)!==0||Number(n.status)!==4||Number(n.moderation_id)!==Number(appeal.moderation_id))throw new BizError(2002,'申诉已处理或下架记录已变化，请刷新')
      const status=action==='restore'?1:2
      await c.upd('UPDATE content_appeal SET status=?,resolution=?,actor=?,resolved_at=NOW(3) WHERE id=?',[status,reason,'admin:'+a.name,appeal.id])
      if(status===1)await c.upd('UPDATE content_note SET status=2,moderation_id=NULL,published_at=COALESCE(published_at,NOW(3)) WHERE id=?',[n.id])
      await audit(c,'admin:'+a.name,'content','appeal-'+action,'note-'+n.id,{status:4},{status:status===1?2:4,appealId:appeal.id,reason})
      return {status}
    })
  },
}
