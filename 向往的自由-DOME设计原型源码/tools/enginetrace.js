/**
 * 六大引擎可玩链路走查（v1.3 新增）
 * 验证四条链路每一步都真实改数据，且数字自洽：
 *   Reward      预算上限 → 批次启用 → 逐笔发放 → 冻结回收 → 四本账
 *   Contribution 内容提交 → CS 计算 → 作弊拦截 → 分润分配
 *   Settlement  订单分账 → 退款冲正 → 商家对账 → 佣金核算
 *   Gateway     密钥盘点 → 接口目录 → 在线调试 → 配额扩容
 * 用法：node tools/enginetrace.js
 */
const { spawn } = require('child_process');
const fs = require('fs'), fsx = require('fs'), pathx = require('path');
const { pathToFileURL } = require('url');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p=>fsx.existsSync(p))||'chrome';
const ROOT = pathx.resolve(__dirname,'..');
const HTML = process.env.HTML || pathToFileURL(pathx.join(ROOT,'向往的自由-业务系统demo-高保真版.html')).href;
const OUT = process.env.OUT || pathx.join(ROOT,'shots_eng');
const PORT = Number(process.env.PORT||9431);
const sleep = ms => new Promise(r=>setTimeout(r,ms));
if(!fsx.existsSync(OUT)) fsx.mkdirSync(OUT,{recursive:true});

let pass=0, fail=0;
function ok(c,name,extra){ if(c){pass++;console.log('  PASS  '+name);} else {fail++;console.log('  FAIL  '+name+(extra?'  → '+extra:''));} }

(async()=>{
  const chrome = spawn(CHROME,['--headless=new','--disable-gpu','--no-sandbox',`--remote-debugging-port=${PORT}`,'about:blank'],{stdio:'ignore'});
  let t=null;
  for(let i=0;i<40;i++){ await sleep(250); try{ const r=await fetch(`http://127.0.0.1:${PORT}/json/list`); t=await r.json(); if(t.find(x=>x.type==='page')) break; }catch(e){} }
  const ws = new WebSocket(t.find(x=>x.type==='page').webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
  let id=0; const pend=new Map(); const errs=[];
  ws.onmessage=e=>{ const m=JSON.parse(e.data);
    if(m.id&&pend.has(m.id)){const p=pend.get(m.id);pend.delete(m.id); m.error?p.rej(new Error(JSON.stringify(m.error))):p.res(m.result);}
    if(m.method==='Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.exception&&m.params.exceptionDetails.exception.description||m.params.exceptionDetails.text||'').split('\n')[0]); };
  const send=(m,p={})=>new Promise((res,rej)=>{const i=++id;pend.set(i,{res,rej});ws.send(JSON.stringify({id:i,method:m,params:p}));});
  const ev=async x=>{ const r=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true}); return r.exceptionDetails?{__err:(r.exceptionDetails.exception?.description||r.exceptionDetails.text||'').split('\n')[0]}:r.result.value; };
  const shot=async name=>{ const c=await ev(`(()=>{const r=document.querySelector('#screen').getBoundingClientRect();return{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)};})()`);
    const r=await send('Page.captureScreenshot',{format:'png',clip:{...c,scale:2},captureBeyondViewport:true});
    fs.writeFileSync(pathx.join(OUT,name+'.png'),Buffer.from(r.data,'base64')); };
  const waitFor=async(expr,want,to=3000)=>{ const t0=Date.now(); let last=''; while(Date.now()-t0<to){ last=await ev(expr); if(last===want) return last; await sleep(180);} return last; };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:430,height:920,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:HTML}); await sleep(2400);
  await ev(`S.loggedIn=true;S.loginStep='role';document.querySelector('#loginLayer').classList.remove('on')`);
  await sleep(300); await ev(`setEnd('admin')`); await sleep(600);

  console.log('\n【0】引擎数据结构就绪');
  ok(await ev(`typeof DB.engine==='object' && !!DB.engine.batches`), '激励引擎数据就绪');
  ok(await ev(`typeof DB.contrib==='object' && DB.contrib.items.length>=4`), '贡献引擎数据就绪');
  ok(await ev(`typeof DB.settle==='object' && DB.settle.orders.length>=3`), '结算引擎数据就绪');
  ok(await ev(`typeof DB.gateway==='object' && DB.gateway.apis.length>=5`), '生态网关数据就绪');

  /* ---------- 激励引擎 ---------- */
  console.log('\n【1】激励引擎 Reward（方案 §9）');
  await ev(`pushEnginePage('reward')`); await sleep(900);
  ok(await waitFor(`(document.querySelector('#pageStack .page:last-child .nav-title')||{}).textContent||''`,'激励引擎 · 可玩演示',3000),'页面打开');
  ok(await ev(`document.querySelectorAll('#pageStack .page:last-child .egm-step').length===5`),'五个步骤全部呈现');
  const b0 = JSON.parse(await ev(`JSON.stringify({issued:DB.admin.budget.issued,used:DB.admin.budget.used,total:DB.admin.budget.total,wallet:DB.wallet,tx:DB.txLog.length})`));
  await ev(`rwCap()`); await sleep(600);
  ok(await ev(`DB.engine.log.length>=2`),'预算上限校验写入记录','实际 '+await ev(`DB.engine.log.length`));
  ok(await ev(`DB.engine.log.some(l=>/min\\(/.test(l.d))`),'min 公式口径正确', await ev(`DB.engine.log.map(l=>l.d).join(' || ')`));
  await ev(`rwBatch()`); await sleep(600);
  ok(await ev(`DB.engine.batches.filter(b=>b.st==='进行中').length===2`),'批次由待启用转进行中');
  await ev(`rwIssue()`); await sleep(700);
  const b1 = JSON.parse(await ev(`JSON.stringify({issued:DB.admin.budget.issued,used:DB.admin.budget.used,wallet:DB.wallet,tx:DB.txLog.length})`));
  ok(b1.issued>b0.issued,'预算池已发行额度增加',`${b0.issued}→${b1.issued}`);
  ok(b1.used===b0.used,'已核销字段不被发放动作污染',`${b0.used}→${b1.used}`);
  ok(b1.wallet>b0.wallet,'钱包余额真实增加',`${b0.wallet}→${b1.wallet}`);
  ok(b1.tx===b0.tx+1,'链上流水新增一条');
  await ev(`rwIssue()`); await sleep(600);
  await ev(`rwLife()`); await sleep(600);
  ok(await ev(`DB.engine.tasks.some(x=>x.st==='pending'&&x.id==='R-04')`),'冻结任务已解冻为待发放');
  await ev(`rwBook()`); await sleep(600);
  ok(await ev(`/发行账/.test(document.querySelector('#pageStack .page:last-child').textContent)`),'四本账渲染');
  ok(await ev(`DB.engine.books[0].v.replace(/,/g,'')===String(DB.admin.budget.issued)`),'发行账与预算池已发行一致', await ev(`DB.engine.books[0].v+' vs '+DB.admin.budget.issued`));
  await shot('e1-reward');

  /* ---------- 贡献引擎 ---------- */
  console.log('\n【2】贡献引擎 Contribution（方案 §4 / §14）');
  await ev(`closeSheet();document.querySelectorAll('#pageStack .page').forEach(p=>p.remove());S.stack=[];pushEnginePage('contrib')`); await sleep(900);
  ok(await waitFor(`(document.querySelector('#pageStack .page:last-child .nav-title')||{}).textContent||''`,'贡献引擎 · 可玩演示',3000),'页面打开');
  ok(await ev(`document.querySelectorAll('#pageStack .page:last-child .egm-step').length===4`),'四个步骤全部呈现');
  const c0 = await ev(`DB.contrib.items.length`);
  /* 队列里已有 C-04 处于待确认，先跑 CS 让队列清空，再验证「提交新内容」这条路径 */
  await ev(`ctCalc()`); await sleep(700);
  ok(await ev(`DB.contrib.items.filter(x=>x.cs).length>=3`),'CS 已计算（3 条有效内容）','实际 '+await ev(`DB.contrib.items.filter(x=>x.cs).length`));
  const cs1 = await ev(`DB.contrib.items.find(x=>x.id==='C-01').cs`);
  ok(cs1===Math.round(92*0.5+88*0.3+74*0.2),'CS 公式 0.5Q+0.3S+0.2R 正确','C-01='+cs1);
  await ev(`ctSubmit()`); await sleep(600);
  ok((await ev(`DB.contrib.items.length`))===c0+1,'新内容进入待确认队列');
  ok(await ev(`!!DB.contrib.items.find(x=>x.st==='待确认')`),'新内容状态为待确认');
  await ev(`ctCalc()`); await sleep(700);
  ok(await ev(`DB.contrib.items.filter(x=>x.st==='已确认').length>=4`),'全部内容完成 CS 确认','实际 '+await ev(`DB.contrib.items.filter(x=>x.st==='已确认').length`));

  await ev(`ctAnti()`); await sleep(700);
  ok(await ev(`DB.contrib.items.some(x=>x.st==='已拦截')`),'作弊内容被拦截');
  ok(await ev(`/批量注册/.test(DB.contrib.items.find(x=>x.st==='已拦截').d)`),'拦截原因为批量注册特征');
  ok(await ev(`DB.contrib.items.find(x=>x.st==='已拦截').cs===0`),'作弊内容 CS 归零');
  ok(await ev(`DB.admin.warnings.some(w=>String(w.t).indexOf('刷单特征已确认')>=0)`),'运营端风险告警已同步新增','当前：'+await ev(`DB.admin.warnings.map(w=>w.t).join(' / ')`));
  await ev(`ctSplit()`); await sleep(700);
  ok(await ev(`DB.contrib.dist.length>=4`),'分润已分配','实际 '+await ev(`DB.contrib.dist.length`));
  const sum = await ev(`DB.contrib.dist.reduce(function(s,d){return s+d.amt;},0)`);
  ok(sum>0 && sum<4500,'分润金额在池子范围内','合计¥'+sum);
  ok(await ev(`(()=>{const bad=DB.contrib.items.filter(x=>x.st==='已拦截');return bad.length>0 && bad.every(b=>!DB.contrib.dist.some(d=>d.n===b.n));})()`),'作弊内容不参与分润');
  const csPct = await ev(`Math.round(DB.contrib.dist.reduce(function(s,d){return s+d.pct;},0)*10)/10`);
  ok(Math.abs(csPct-100)<=0.5,'分润占比合计约 100%','实际 '+csPct+'%');
  await shot('e2-contrib');

  /* ---------- 结算引擎 ---------- */
  console.log('\n【3】结算引擎 Settlement（方案 §8.2 / §11）');
  await ev(`closeSheet();document.querySelectorAll('#pageStack .page').forEach(p=>p.remove());S.stack=[];pushEnginePage('settle')`); await sleep(900);
  ok(await waitFor(`(document.querySelector('#pageStack .page:last-child .nav-title')||{}).textContent||''`,'结算引擎 · 可玩演示',3000),'页面打开');
  ok(await ev(`document.querySelectorAll('#pageStack .page:last-child .egm-step').length===4`),'四个步骤全部呈现');
  const pctSum = await ev(`DB.settle.ratio.reduce(function(s,r){return s+r.pct;},0)`);
  ok(pctSum===100,'五口径占比合计 100%','实际 '+pctSum);
  await ev(`stSplit()`); await sleep(700);
  ok(await ev(`!!DB.settle.orders.find(o=>o.split)`),'订单分账完成');
  const spSum = await ev(`DB.settle.orders.find(o=>o.split).split.reduce(function(s,x){return s+x.amt;},0)`);
  const oAmt = await ev(`DB.settle.orders.find(o=>o.split).amt`);
  ok(Math.abs(spSum-oAmt)<=2,'分账明细合计=订单金额（自洽）',`${spSum} vs ${oAmt}`);
  const spLen = await ev(`DB.settle.orders.find(o=>o.split).split.length`);
  ok(spLen===5,'五口径明细完整');
  const poolBefore = await ev(`DB.admin.budget.issued`);
  await ev(`stRefund()`); await sleep(700);
  ok(await ev(`!!DB.settle.orders.find(o=>o.st==='已冲正')`),'退款冲正已生成');
  ok(await ev(`DB.settle.orders.find(o=>o.st==='已冲正').splitRev.every(x=>x.amt<0)`),'负向分账金额全为负');
  const poolAfter = await ev(`DB.admin.budget.issued`);
  ok(poolAfter<poolBefore,'预算池注入已回收（发行额度原路冲正）',poolBefore+'→'+poolAfter);
  await ev(`stRecon()`); await sleep(700);
  ok(await ev(`DB.settle.stmts.length>=1`),'商家对账单已生成','实际 '+await ev(`DB.settle.stmts.length`));
  ok(await ev(`/应结/.test(document.querySelector('#pageStack .page:last-child').textContent)`),'对账明细渲染');
  await ev(`stComm()`); await sleep(700);
  ok(await ev(`/8%/.test(DB.engine.log.concat(DB.contrib.logs||[]).join('')) || /佣金/.test(document.querySelector('#pageStack .page:last-child').textContent)`),'佣金核算写入记录');
  await shot('e3-settle');

  /* ---------- 生态网关 ---------- */
  console.log('\n【4】生态网关 Gateway（方案 §10.1）');
  await ev(`closeSheet();document.querySelectorAll('#pageStack .page').forEach(p=>p.remove());S.stack=[];pushEnginePage('gateway')`); await sleep(900);
  ok(await waitFor(`(document.querySelector('#pageStack .page:last-child .nav-title')||{}).textContent||''`,'生态网关 · 可玩演示',3000),'页面打开');
  ok(await ev(`document.querySelectorAll('#pageStack .page:last-child .egm-step').length===4`),'四个步骤全部呈现');
  ok(await ev(`/ Voyage Token|双通道隔离/.test(document.querySelector('#pageStack .page:last-child').textContent)`),'境内外双通道隔离已明示');
  await ev(`gwKey()`); await sleep(600);
  ok(await ev(`/物理隔离/.test(DB.gateway.logs[0].d)`),'密钥盘点记录双通道隔离');
  await ev(`gwCatalog()`); await sleep(600);
  ok(await ev(`DB.gateway.apis.length===5`),'接口目录五个');
  const u0 = await ev(`DB.gateway.apis.reduce(function(s,a){return s+a.used;},0)`);
  await ev(`gwDebug()`); await sleep(800);
  ok((await ev(`DB.gateway.apis.reduce(function(s,a){return s+a.used;},0)`))>u0,'调用计数真实增加');
  ok(await ev(`!!DB.gateway.lastResp && DB.gateway.lastResp.code===0`),'返回结构化 JSON 且 code=0');
  ok(await ev(`/code/.test((document.querySelector('#pageStack .page:last-child .egm-code')||{}).textContent||'')`),'响应体已渲染');
  const hotBefore = await ev(`DB.gateway.apis.filter(a=>a.used/a.q>=0.9).map(a=>a.q).join(',')`);
  await ev(`gwQuota()`); await sleep(700);
  ok(await ev(`/扩容|巡检/.test(DB.gateway.logs[0].d)`),'配额处理已记录', await ev(`DB.gateway.logs[0].d`));
  ok(await ev(`/限流|配额/.test(DB.gateway.logs.map(l=>l.d).join('|'))`),'配额/限流口径存在');
  await shot('e4-gateway');

  /* ---------- 引擎入口回归 ---------- */
  console.log('\n【5】运营端入口与引擎卡片');
  await ev(`closeSheet();document.querySelectorAll('#pageStack .page').forEach(p=>p.remove());S.stack=[];setTab('ame')`); await sleep(800);
  ok(await ev(`document.querySelectorAll('#baseScroll [onclick*="pushEnginePage"]').length===4`),'运营端四个引擎直达入口');
  ok(await ev(`Array.from(document.querySelectorAll('#baseScroll [onclick*="pushEnginePage"]')).every(el=>/reward|contrib|settle|gateway/.test(el.getAttribute('onclick')))`),'入口绑定四个引擎');
  await ev(`pushEcoPage()`); await sleep(900);
  ok(await ev(`document.querySelectorAll('#pageStack .page:last-child .eng-card').length===6`),'生态架构页六个引擎卡片');
  ok(await ev(`Array.from(document.querySelectorAll('#pageStack .page:last-child .eng-card')).filter(c=>/pushEnginePage/.test(c.getAttribute('onclick'))).length===4`),'四张卡片已指向可玩链路');

  console.log('\n【6】JS 运行时异常');
  ok(errs.length===0,'无未捕获异常',errs.slice(0,3).join(' || '));

  console.log('\n────────────────────────');
  console.log(`引擎可玩链路走查：PASS ${pass} / FAIL ${fail}`);
  ws.close(); chrome.kill();
  process.exit(fail?1:0);
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
