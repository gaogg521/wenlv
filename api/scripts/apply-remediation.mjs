// 本机演示库升级：完整保留旧库快照，只应用增量 DDL，不重置演示数据。
import mysql from 'mysql2/promise'
import fs from 'node:fs'
if (!process.argv.includes('--apply')) throw new Error('请审阅 V17 迁移后显式使用 --apply')
const source=process.env.DB_NAME || 'wanderlust'
if(source!=='wanderlust')throw new Error('本脚本仅用于本机 wanderlust 演示库')
const backup='wanderlust_backup_20261026_v17'
const c=await mysql.createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER||'root',password:process.env.DB_PASS||'root',database:source,multipleStatements:true})
try{
 const [columns]=await c.query("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME='settlement' AND COLUMN_NAME='payment_ref'",[source])
 if(columns.length)throw new Error('迁移可能已执行，请人工检查；拒绝覆盖快照或重复执行')
 const [exists]=await c.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?',[backup])
 if(exists.length)throw new Error('备份库已存在，拒绝覆盖')
 const [tables]=await c.query("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME",[source])
 const counts={}
 await c.query('CREATE DATABASE `'+backup+'` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci')
 await c.query('SET FOREIGN_KEY_CHECKS=0')
 for(const {TABLE_NAME:t}of tables){
  await c.query('CREATE TABLE `'+backup+'`.`'+t+'` LIKE `'+source+'`.`'+t+'`')
  await c.query('INSERT INTO `'+backup+'`.`'+t+'` SELECT * FROM `'+source+'`.`'+t+'`')
  const [[b]]=await c.query('SELECT COUNT(*) n FROM `'+backup+'`.`'+t+'`');counts[t]=Number(b.n)
 }
 await c.query('SET FOREIGN_KEY_CHECKS=1')
 await c.query(fs.readFileSync(new URL('../db/migration/V17__settlement_payment_evidence.sql',import.meta.url),'utf8'))
 for(const {TABLE_NAME:t}of tables){const [[after]]=await c.query('SELECT COUNT(*) n FROM `'+source+'`.`'+t+'`');if(Number(after.n)!==counts[t])throw new Error('升级前后行数变化：'+t)}
 fs.mkdirSync('test/evidence-20261026',{recursive:true})
 fs.writeFileSync('test/evidence-20261026/migration-main.json',JSON.stringify({source,backup,migration:'V17',tableCount:tables.length,counts,dataRowsPreserved:true,at:new Date().toISOString()},null,2))
 console.log('V17 applied; '+tables.length+' tables preserved; snapshot='+backup)
}finally{await c.end()}
