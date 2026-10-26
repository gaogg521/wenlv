import mysql from 'mysql2/promise';
import fs from 'node:fs';
const c=await mysql.createConnection({host:'127.0.0.1',user:'root',password:'root',multipleStatements:true});
const source='wanderlust', target='wanderlust_qa_20261026';
const [exists]=await c.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?',[target]);
if(exists.length) throw new Error('QA database exists; refusing overwrite');
await c.query('CREATE DATABASE `'+target+'` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci');
const [tables]=await c.query('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_TYPE="BASE TABLE"',[source]);
await c.query('SET FOREIGN_KEY_CHECKS=0');
for(const {TABLE_NAME:t} of tables){await c.query('CREATE TABLE `'+target+'`.`'+t+'` LIKE `'+source+'`.`'+t+'`');await c.query('INSERT INTO `'+target+'`.`'+t+'` SELECT * FROM `'+source+'`.`'+t+'`');}
await c.query('USE `'+target+'`');
await c.query(fs.readFileSync('db/migration/V17__settlement_payment_evidence.sql','utf8'));
await c.end();console.log('QA snapshot created; '+tables.length+' tables; source unchanged');
