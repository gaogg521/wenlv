// 演示升级只读对账；仅输出行数和摘要，不泄露账号哈希、凭据或配置原文。
import { q, closeDb } from '../src/db.mjs'
import fs from 'node:fs/promises'
import crypto from 'node:crypto'
if(process.env.DB_NAME!=='wanderlust')throw Error('Explicit demo database required for read-only snapshot')
const tables={orders:'id',user_account:'id',admin_user:'id',tour_product:'id',content_note:'id',app_secret:'k',rule_config:'k'}
try{
 const out={}
 for(const [table,key]of Object.entries(tables)){
  const rows=await q(`SELECT * FROM ${table} ORDER BY ${key}`)
  if(table==='admin_user')for(const row of rows)delete row.last_login_at
  out[table]={count:rows.length,sha256:crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex')}
 }
 out.migrations=(await q('SELECT version FROM schema_migration ORDER BY version')).map(r=>r.version)
 await fs.writeFile(process.argv[2],JSON.stringify(out,null,2));console.log('Saved read-only counts and SHA-256 summaries')
}finally{await closeDb()}
