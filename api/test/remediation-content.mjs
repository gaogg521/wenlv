import a from 'miniprogram-automator';import assert from 'node:assert/strict';import fs from 'node:fs';import {one,q} from '../src/db.mjs';import {jwtSign} from '../src/auth.mjs';
if(!/^wanderlust_qa_/.test(process.env.DB_NAME))throw new Error('QA only');
const m=await a.connect({wsEndpoint:'ws://127.0.0.1:9421'});try{
for(let i=0;i<60;i++){if((await m.currentPage())?.path)break;await new Promise(r=>setTimeout(r,1000));}
const stamp=Date.now();const title='原生编辑器实测 · '+stamp;const taskTitle='旅行笔记约稿 · '+stamp;
const user=await one('SELECT id FROM user_account WHERE mini_a_openid=?',['mock-openid-mock-remediation-ui-tourist']);
const id=(await q('INSERT INTO content_task(task_no,title,brief,reward_beans,status) VALUES(?,?,?,200,0)', ['QA-CONTENT-'+stamp,taskTitle,'记录旅程并选择作品提交'])).insertId;
await m.evaluate(token=>{getApp().globalData.apiBase='http://127.0.0.1:8081';getApp().globalData.token=token},jwtSign({uid:user.id,end:'c'}));
await m.navigateTo('/package-content/pages/create/index');const page=await m.currentPage();
for(let i=0;i<50&&!(await page.data()).tasks?.open?.some(t=>Number(t.id)===id);i++)await new Promise(r=>setTimeout(r,200));
await(await page.$('input')).input(title);
for(const b of await page.$$('.v')){if(Number(await b.attribute('data-id'))===id && (await b.text()).includes('领 ')){await b.tap();break;}}
 await (await page.$('#bodyEditor')).tap();
for(const b of await page.$$('.rt-btn')){if(await b.attribute('data-tag')==='b'){await b.trigger('touchend');break;}}
await new Promise(r=>setTimeout(r,300));
await m.evaluate(()=>{const p=getCurrentPages()[getCurrentPages().length-1];p.editor.insertText({text:'沿着水乡的石板路走进故事，在桥边记录这次旅程。'});return true;});
for(let i=0;i<40&&!(await page.data()).bodyText?.includes('石板路');i++)await new Promise(r=>setTimeout(r,150));
let d=await page.data();assert(d.bodyText.includes('石板路'));assert(/strong|font-weight:\s*bold|<b>/.test(d.bodyHtml),d.bodyHtml);
await m.screenshot({path:'test/evidence-20261026/creator-native-editor.png'});
await(await page.$('.btn')).tap();
let published;for(let i=0;i<40&&!published;i++){d=await page.data();published=d.notes.find(n=>n.title===title);await new Promise(r=>setTimeout(r,200));}
assert(published,'笔记发布后应出现在我的作品');
await m.mockWxMethod('showActionSheet',{tapIndex:0});
for(const b of await page.$$('.v'))if(Number(await b.attribute('data-id'))===id && (await b.text()).includes('选择作品提交')){await b.tap();break;}
let task;for(let i=0;i<40&&!task;i++){d=await page.data();task=d.tasks.mine.find(t=>t.title===taskTitle&&t.status===2);await new Promise(r=>setTimeout(r,200));}
assert(task,'任务应进入审核中');const stored=await one('SELECT note_id FROM content_task WHERE id=?',[task.id]);assert.equal(Number(stored.note_id),Number(published.id));
await m.screenshot({path:'test/evidence-20261026/creator-task-submitted.png'});
fs.writeFileSync('test/evidence-20261026/content-result.json',JSON.stringify({noteId:published.id,taskId:task.id,nativeEditorBold:true,published:true,selectedWorkSubmitted:true,limitations:['内容通过原生 EditorContext 插入，非实体键盘输入','作品选择器通过官方自动化 API 选择索引']},null,2));
console.log('CONTENT UI PASS native-editor / bold / publish / choose-work / submitted',task.id,published.id);
}finally{await m.disconnect()}process.exit(0);
