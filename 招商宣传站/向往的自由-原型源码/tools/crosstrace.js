/**
 * 跨页数据一致性走查（v1.4 新增）
 * 现有 9 套工具都只验证「单链路能不能跑通」，本工具验证「改了数据之后，别的页面显示不显示得对」：
 *   A. 预算池口径体系统一：引擎发放 → issued 增 / used 不动；游客端旅豆页、运营端风控页、引擎页三处显示同源
 *   B. 预算耗尽拦截：额度不足时发放被拒，钱包不变
 *   C. 结算闭环：分账注入占用 issued → 退款原路回收 → 对账净额不为负
 *   D. CS 公式全量复核：每条有分的内容 cs === round(0.5Q+0.3S+0.2R)
 *   E. 网关调试计数与目录显示一致，且能调到热接口
 *   F. resetDemo 全量复位
 * 用法：node tools/crosstrace.js
 */
const { spawn } = require('child_process');
const fs = require('fs'), fsx = require('fs'), pathx = require('path');
const { pathToFileURL } = require('url');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p=>fsx.existsSync(p))||'chrome';
const ROOT = pathx.resolve(__dirname,'..');
const HTML = process.env.HTML || pathToFileURL(pathx.join(ROOT,'向往的自由-业务系统demo-高保真版.html')).href;
const OUT = process.env.OUT || pathx.join(ROOT,'shots_cross');
const PORT = Number(process.env.PORT||9440);
const sleep = ms => new Promise(r=>setTimeout(r,ms));
if(!fsx.existsSync(OUT)) fsx.mkdirSync(OUT,{recursive:true});

let pass=0, fail=0;
function ok(c,name,extra){ if(c){pass++;console.log('  PASS  '+name);} else {fail++;console.log('  FAIL  '+name+(extra?'  → '+extra:''));} }
const num = s => Number(String(s).replace(/[^0-9.-]/g,'')) || 0;

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
  const j = async x => JSON.parse(await ev(`JSON.stringify(${x})`));
  const shot=async name=>{ const c=await ev(`(()=>{const r=document.querySelector('#screen').getBoundingClientRect();return{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)};})()`);
    const r=await send('Page.captureScreenshot',{format:'png',clip:{...c,scale:2},captureBeyondViewport:true});
    fs.writeFileSync(pathx.join(OUT,name+'.png'),Buffer.from(r.data,'base64')); };
  const waitFor=async(expr,want,to=3000)=>{ const t0=Date.now(); let last=''; while(Date.now()-t0<to){ last=await ev(expr); if(last===want) return last; await sleep(180);} return last; };
  const clearStack=()=>ev(`closeSheet();document.querySelectorAll('#pageStack .page').forEach(p=>p.remove());S.stack=[];`);

  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:430,height:920,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:HTML}); await sleep(2400);
  await ev(`S.loggedIn=true;S.loginStep='role';document.querySelector('#loginLayer').classList.remove('on')`);
  await sleep(300); await ev(`setEnd('admin')`); await sleep(600);

  /* ============ A. 预算池口径基线 ============ */
  console.log('\n【A】预算池口径基线（引擎/风控页/支付流三处同源）');
  const bd = await j(`{t:DB.admin.budget.total,i:DB.admin.budget.issued,u:DB.admin.budget.used}`);
  ok(bd.t===500000 && bd.i===312800 && bd.u===189400,'字段基线 total=500,000 / issued=312,800 / used=189,400', JSON.stringify(bd));
  const seedBooks = await j(`DB.engine.books.map(b=>({n:b.n,v:b.v}))`);
  ok(seedBooks[0].v==='312,800' && seedBooks[2].v==='189,400','四本账种子与预算池字段一致（发行账=已发行 / 核销账=已核销）', JSON.stringify(seedBooks));

  /* ============ B. 激励引擎：发放 → 三处显示联动 ============ */
  console.log('\n【B】激励引擎发放 → 跨端跨页显示联动');
  await clearStack(); await ev(`pushEnginePage('reward')`); await sleep(900);
  const rw0 = await j(`{i:DB.admin.budget.issued,u:DB.admin.budget.used,w:DB.wallet,tx:DB.txLog.length}`);
  await ev(`rwCap()`); await sleep(500);
  ok(await ev(`DB.engine.log.some(l=>/剩余可发/.test(l.d))`),'预算校验日志用「已发行/剩余可发」口径', await ev(`DB.engine.log[0].d`));
  await ev(`rwIssue()`); await sleep(700);
  const rw1 = await j(`{i:DB.admin.budget.issued,u:DB.admin.budget.used,w:DB.wallet,tx:DB.txLog.length}`);
  ok(rw1.i===rw0.i+120,'发放 120 豆 → 已发行 +120',`${rw0.i}→${rw1.i}`);
  ok(rw1.u===rw0.u,'已核销字段不被发放动作污染',`${rw0.u}→${rw1.u}`);
  ok(rw1.w===rw0.w+120 && rw1.tx===rw0.tx+1,'钱包 +120 且流水 +1');
  /* 引擎页显示 */
  ok(await ev(`/已发行/.test(document.querySelector('#pageStack .page:last-child').textContent)`),'引擎页展示「已发行」口径');
  ok(num(await ev(`(()=>{const m=document.querySelector('#pageStack .page:last-child').textContent.match(/已发行 ([\\d,]+)/);return m?m[1]:'0';})()`))===rw1.i,'引擎页已发行数值 = DB.issued', await ev(`(document.querySelector('#pageStack .page:last-child').textContent.match(/已发行 ([\\d,]+)/)||[])[1]+''`));
  /* 游客端旅豆页 */
  await clearStack(); await ev(`setEnd('tourist');setTab('wallet')`); await sleep(900);
  const walletDom = await ev(`(document.querySelector('#baseScroll .wc-bal span')||{}).getAttribute ? document.querySelector('#baseScroll .wc-bal span').getAttribute('data-count') : 'MISS'`);
  ok(num(walletDom)===rw1.w,'游客端旅豆页余额 = DB.wallet',`DOM ${walletDom} vs DB ${rw1.w}`);
  /* 运营端风控页 */
  await clearStack(); await ev(`setEnd('admin');setTab('risk')`); await sleep(900);
  const riskIssued = await ev(`(()=>{const rows=Array.from(document.querySelectorAll('#baseScroll .bri'));const r=rows.find(x=>/已发行/.test(x.textContent));return r?r.querySelector('b').textContent:'MISS';})()`);
  const riskLeft = await ev(`(()=>{const rows=Array.from(document.querySelectorAll('#baseScroll .bri'));const r=rows.find(x=>/剩余可发行/.test(x.textContent));return r?r.querySelector('b').textContent:'MISS';})()`);
  ok(num(riskIssued)===rw1.i,'风控页「已发行」= DB.issued',`DOM ${riskIssued} vs DB ${rw1.i}`);
  ok(num(riskLeft)===bd.t-rw1.i,'风控页「剩余可发行」= total-issued',`DOM ${riskLeft} vs ${bd.t-rw1.i}`);
  await shot('x1-cross-budget');

  /* ============ C. 预算耗尽拦截 ============ */
  console.log('\n【C】预算耗尽拦截');
  await ev(`DB.admin.budget.issued = DB.admin.budget.total - 10; rwIssue()`); await sleep(700);
  const blk = await j(`{w:DB.wallet,tx:DB.txLog.length,pending:DB.engine.tasks.filter(x=>x.st==='pending').length}`);
  ok(blk.w===rw1.w && blk.tx===rw1.tx,'额度不足时发放被拦截：钱包与流水不变', JSON.stringify(blk));
  ok(await ev(`DB.engine.log.some(l=>/拦截/.test(l.d)&&/不足/.test(l.d))`),'拦截写入 warn 日志');
  await ev(`DB.admin.budget.issued = ${rw1.i}`); /* 还原现场 */

  /* ============ D. 结算闭环 ============ */
  console.log('\n【D】结算引擎：分账注入 → 退款回收 → 对账净额');
  await clearStack(); await ev(`pushEnginePage('settle')`); await sleep(900);
  const st0 = await j(`{i:DB.admin.budget.issued,u:DB.admin.budget.used}`);
  await ev(`stSplit()`); await sleep(700);
  const splitOrder = await j(`DB.settle.orders.find(o=>o.split)`);
  const poolIn = splitOrder.split.find(x=>x.k==='预算池注入').amt;
  ok((await ev(`DB.admin.budget.issued`))===st0.i+poolIn,'分账时预算池注入占用已发行额度',`${st0.i}→${st0.i+poolIn}（注入 ${poolIn}）`);
  await ev(`stRefund()`); await sleep(700);
  const st1 = await j(`{i:DB.admin.budget.issued,u:DB.admin.budget.used,refunded:DB.settle.orders.filter(o=>o.st==='已冲正').length}`);
  ok(st1.i===st0.i && st1.refunded===1,'退款后发行额度原路还原（split→refund 闭环）',`issued=${st1.i}`);
  await ev(`stRecon()`); await sleep(700);
  const nets = await j(`DB.settle.stmts.map(r=>r.net)`);
  ok(nets.length>0 && nets.every(n=>n>=0),'对账净额全部非负（全额退款应结为 0，不再出现负数）', JSON.stringify(nets));
  ok(!await ev(`/应结\\s*-/.test(document.querySelector('#pageStack .page:last-child').textContent)`),'对账页无「应结 -」负数文案');
  await shot('x2-cross-settle');

  /* ============ E. CS 公式全量复核 ============ */
  console.log('\n【E】贡献引擎 CS 公式全量复核');
  await clearStack(); await ev(`pushEnginePage('contrib')`); await sleep(900);
  await ev(`ctCalc()`); await sleep(600);
  await ev(`ctSplit()`); await sleep(600);
  const csBad = await ev(`(()=>{const bad=[];DB.contrib.items.forEach(it=>{if(it.cs>0){const exp=Math.round(it.q*0.5+it.s*0.3+it.r*0.2);if(it.cs!==exp)bad.push(it.id+':'+it.cs+'≠'+exp);}});return bad.join(',');})()`);
  ok(csBad==='','所有计分内容 cs === round(0.5Q+0.3S+0.2R)', csBad||'全部一致');
  const distSum = await ev(`DB.contrib.dist.reduce((s,d)=>s+d.amt,0)`);
  const pctSum = await ev(`Math.round(DB.contrib.dist.reduce((s,d)=>s+d.pct,0)*10)/10`);
  ok(distSum>0 && distSum<=3864,'分润合计在池子范围内',`¥${distSum} / 池 ¥3,864`);
  ok(Math.abs(pctSum-100)<=0.5,'分润占比合计约 100%', pctSum+'%');

  /* ============ F. 网关调试计数与目录显示 ============ */
  console.log('\n【F】生态网关：调试计数跨页一致 + 热接口可达');
  await clearStack(); await ev(`pushEnginePage('gateway')`); await sleep(900);
  const hot0 = await j(`DB.gateway.apis.filter(a=>a.used/a.q>=0.9).map(a=>a.id)`);
  ok(hot0.length>=2,'种子数据中确有接口处于 90%+ 阈值（演示链可触达）', hot0.join(','));
  const used0 = await ev(`DB.gateway.apis.find(a=>a.id==='/v1/verify/redeem').used`);
  await ev(`gwDebug()`); await sleep(800);
  const used1 = await ev(`DB.gateway.apis.find(a=>a.id==='/v1/verify/redeem').used`);
  const lastApi = await ev(`DB.gateway.lastApi`);
  ok(used1===used0+1,'热接口被真实调用（used +1）',`${used0}→${used1} · lastApi=${lastApi}`);
  ok(lastApi==='/v1/verify/redeem' || lastApi==='/v1/contrib/report','gwDebug 优先调阈值内热接口，而非永远打第一个', lastApi);
  const domUsed = await ev(`(()=>{const rows=Array.from(document.querySelectorAll('#pageStack .page:last-child .egm-api'));const r=rows.find(x=>/verify\\/redeem/.test(x.textContent));return r?r.querySelector('.ad').textContent:'MISS';})()`);
  ok(/今日 7,251/.test(domUsed),'接口目录 DOM 显示调用后的使用量', domUsed);
  await ev(`gwQuota()`); await sleep(700);
  const afterQ = await j(`DB.gateway.apis.map(a=>({id:a.id,q:a.q}))`);
  ok(afterQ.find(a=>a.id==='/v1/verify/redeem').q===12000 && afterQ.find(a=>a.id==='/v1/contrib/report').q===1500,'热接口配额扩容 50%（8000→12000 / 1000→1500）', JSON.stringify(afterQ));

  /* ============ I. 商户端对账闭环 → 运营端同步 → 分账实绩回流 ============ */
  console.log('\n【I】商户端对账闭环（确认 / 申诉 → 运营端受理 → 分账实绩回流）');
  await clearStack(); await ev(`setEnd('merch');setTab('mme')`); await sleep(900);
  /* I1 商户端能定位到自己的结算条线 */
  const line = await j(`(function(){var m=sbcMyLine();return {n:m.n,mid:m.mid,st:m.st,cnt:m.cnt,amt:m.amt};})()`);
  ok(line.mid==='M20261018' && line.n==='朱家角景区','商户端按商户号定位到自己的结算条线', JSON.stringify(line));
  /* I2 商户端「我的权益对账单」入口存在 */
  const hasEntry = await ev(`/我的权益对账单/.test(document.querySelector('#baseScroll').textContent)`);
  ok(hasEntry,'商户端「我的」页有「我的权益对账单」入口');
  /* I3 商户端对账页能打开并显示逐笔明细 */
  await ev(`pushSettleBillPage()`); await sleep(800);
  const billDom = await ev(`(()=>{const t=document.querySelector('#pageStack .page:last-child').textContent;return {rows:document.querySelectorAll('#pageStack .page:last-child .sbc-rd').length,hasAmt:/应结金额/.test(t),hasConfirm:/确认本期对账/.test(t),hasAppeal:/提出申诉/.test(t)};})()`);
  ok(billDom.rows===12,'商户端对账单展示 12 笔核销明细', 'rows='+billDom.rows);
  ok(billDom.hasAmt && billDom.hasConfirm && billDom.hasAppeal,'对账单页含应结金额 / 确认 / 申诉三要素', JSON.stringify(billDom));
  /* I4 运营端待确认状态与商户端一致 */
  const stBefore = await j(`DB.rights.merchants.find(m=>m.mid==='M20261018').st`);
  ok(stBefore==='待确认','商户端初始为待确认（与运营端同一数据源）', stBefore);
  /* I5 商户端确认 → 写回 DB → 运营端立即可见 */
  await ev(`sbcConfirm()`); await sleep(700);
  const afterConfirm = await j(`(function(){var m=DB.rights.merchants.find(x=>x.mid==='M20261018');return {st:m.st,by:m.by};})()`);
  ok(afterConfirm.st==='已确认' && afterConfirm.by==='商户端线上','商户端确认写回结算条线（来源标记为商户端线上）', JSON.stringify(afterConfirm));
  await clearStack(); await ev(`setEnd('admin');pushRightsPage()`); await sleep(900);
  const adminDom = await ev(`(()=>{const t=document.querySelector('#pageStack .page:last-child').textContent;return {hasOnline:/商户端线上/.test(t),hasConfirmed:/已确认/.test(t)};})()`);
  ok(adminDom.hasOnline && adminDom.hasConfirmed,'运营端结算页显示「商户端线上」确认来源', JSON.stringify(adminDom));
  /* I6 商户端提交申诉 → 运营端待受理队列可见 */
  const apBefore = await j(`DB.rights.appeals.length`);
  await clearStack(); await ev(`setEnd('merch');pushSettleBillPage()`); await sleep(700);
  await ev(`sbcAppealSheet()`); await sleep(500);
  await ev(`(function(){
    var a=document.querySelector('#sbcAmt'), d=document.querySelector('#sbcDesc');
    if(!a||!d) return 'NOFORM';
    a.value='136'; d.value='核销台记录与平台账单差 4 笔，附截图';
    sbcSubmitAppeal();
    return 'ok';
  })()`); await sleep(800);
  const apAfter = await j(`(function(){var a=DB.rights.appeals[DB.rights.appeals.length-1];return {n:DB.rights.appeals.length,id:a.id,st:a.st,amt:a.amt,m:a.m,st2:DB.rights.merchants.find(x=>x.mid==='M20261018').st};})()`);
  ok(apAfter.n===apBefore+1 && apAfter.st==='待受理','商户端提交申诉进入平台待受理队列', JSON.stringify(apAfter));
  ok(apAfter.m==='朱家角景区' && apAfter.amt===136,'申诉归属与金额正确', JSON.stringify(apAfter));
  /* I7 运营端受理申诉 → 该条线应付上浮 */
  await clearStack(); await ev(`setEnd('admin');pushRightsPage()`); await sleep(800);
  const pre = await j(`(function(){var R=splitRowsReal();return {amt:DB.rights.merchants[0].amt,net:R.z.net,pool:R.rows.filter(w=>w.g==='pool')[0].v,keep:R.rows.filter(w=>w.n==='留存毛利')[0].v,sum:R.sum};})()`);
  await ev(`rsnAcceptAppeal(DB.rights.appeals.length-1)`); await sleep(800);
  const post = await j(`(function(){var R=splitRowsReal();return {amt:DB.rights.merchants[0].amt,net:R.z.net,pool:R.rows.filter(w=>w.g==='pool')[0].v,keep:R.rows.filter(w=>w.n==='留存毛利')[0].v,sum:R.sum,st:DB.rights.appeals[DB.rights.appeals.length-1].st};})()`);
  ok(post.amt===pre.amt+136,'受理申诉后该条线应付上浮 +¥136', `${pre.amt}→${post.amt}`);
  ok(post.net>pre.net,'权益成本合计同步上升', `${pre.net}→${post.net}`);
  ok(post.pool>pre.pool,'分账「权益预留」行按实绩上浮', `${pre.pool}→${post.pool}`);
  ok(post.keep<pre.keep,'分账「留存毛利」行同步扣减（缺口由毛利吸收）', `${pre.keep}→${post.keep}`);
  ok(post.sum===298,'五口径合计恒为 ¥298（实绩口径不破坏总额）', 'sum='+post.sum);
  /* I8 运营端分账页（示范闭环）显示实绩口径 */
  await clearStack(); await ev(`setEnd('admin');pushDemoCasePage()`); await sleep(800);
  const caseDom = await ev(`(()=>{const t=document.querySelector('#pageStack .page:last-child').textContent;return {hasReal:/实绩/.test(t),hasPool:/权益预算/.test(t),hasNote:/回流/.test(t)};})()`);
  ok(caseDom.hasReal && caseDom.hasPool && caseDom.hasNote,'运营端示范闭环分账显示实绩口径与回流说明', JSON.stringify(caseDom));
  /* I9 合伙人端分账视图同源 */
  await clearStack(); await ev(`setEnd('partner');setTab('earn')`); await sleep(900);
  const partDom = await ev(`(()=>{const t=document.querySelector('#baseScroll').textContent;return {hasReal:/实绩/.test(t),hasNote:/回流/.test(t)};})()`);
  ok(partDom.hasReal && partDom.hasNote,'合伙人端分账视图同源显示实绩与回流说明', JSON.stringify(partDom));
  /* I10 驳回一条待受理申诉：应付额不变，条线回到待确认 */
  await clearStack(); await ev(`setEnd('admin');pushRightsPage()`); await sleep(700);
  const rejBefore = await j(`(function(){var i=DB.rights.appeals.findIndex(a=>a.st==='待受理');return {i:i,amt:DB.rights.merchants[0].amt,st:DB.rights.merchants[0].st};})()`);
  await ev(`(function(){var i=DB.rights.appeals.findIndex(a=>a.st==='待受理');rsnRejectAppeal(i);})()`); await sleep(700);
  const rejAfter = await j(`(function(){var a=DB.rights.appeals[0];return {amt:DB.rights.merchants[0].amt,apSt:a.st,mst:DB.rights.merchants[0].st};})()`);
  ok(rejAfter.amt===rejBefore.amt,'驳回申诉维持原应付额', JSON.stringify({before:rejBefore,after:rejAfter}));
  ok(rejAfter.apSt==='已驳回','驳回后申诉状态为已驳回', rejAfter.apSt);
  ok(rejAfter.mst==='待确认','驳回后条线回到待确认（商家可继续核对）', rejAfter.mst);
  /* I11 未清项时不得入分账 */
  await clearStack(); await ev(`setEnd('admin');pushRightsPage()`); await sleep(700);
  const pushGuard = await j(`(function(){rsnPushSplit();return DB.rights.bill.st;})()`);
  ok(pushGuard!=='已入分账','存在未清项时「并入本期分账」被拦截', 'bill='+pushGuard);

  /* ============ G. resetDemo 全量复位 ============ */
  console.log('\n【G】resetDemo 全量复位');
  await ev(`resetDemo()`); await sleep(900);
  const rs = await j(`{i:DB.admin.budget.issued,u:DB.admin.budget.used,w:DB.wallet,tasks:DB.engine.tasks.map(t=>t.st),rec:DB.engine.recycled,vused:DB.gateway.apis.find(a=>a.id==='/v1/verify/redeem').used}`);
  ok(rs.i===312800 && rs.u===189400 && rs.w===1280,'预算池与钱包复位', JSON.stringify({i:rs.i,u:rs.u,w:rs.w}));
  ok(rs.tasks.filter(s=>s==='pending').length===4 && rs.tasks.includes('frozen') && rs.tasks.includes('recycle'),'发放队列复位（4 待发放 + 1 冻结 + 1 待回收）', rs.tasks.join(','));
  ok(rs.rec===3200,'回收账计数复位');
  ok(rs.vused===7250,'网关调用量复位');

  console.log('\n【H】JS 运行时异常');
  ok(errs.length===0,'无未捕获异常',errs.slice(0,3).join(' || '));

  /* ============ J. 成本控制闭环：超支审批 + 协议变更（v1.8）============ */
  console.log('\n【J】超支审批动作流 · 协议变更单');
  await clearStack(); await ev(`setEnd('admin');pushRightsPage()`); await sleep(800);
  const ov0 = await j(`(function(){var o=overrunState();return {gap:o.gap,rate:o.rate,ok:o.okAmt,fuse:o.fuse,lv:overrunLevel(o.gap||o.openAmt),open:o.open};})()`);
  ok(ov0.gap>0,'权益预留池存在超支缺口', `缺口 ¥${ov0.gap} · 超支率 ${(ov0.rate*100).toFixed(1)}%`);
  ok(ov0.fuse===true,'未获处置且破熔断线 → 熔断生效', `fuse=${ov0.fuse}`);
  ok(/财务|CEO/.test(ov0.lv),'超支按分级授权落到对应审批人', ov0.lv);
  const ovDom = await ev(`(()=>{var t=document.querySelector('#pageStack .page:last-child').textContent;return {g:/分级授权/.test(t),a:/超支审批单/.test(t),f:/熔断/.test(t)};})()`);
  ok(ovDom.g&&ovDom.a&&ovDom.f,'运营端渲染分级授权/审批单/熔断三区块', JSON.stringify(ovDom));
  const agrDom = await ev(`(()=>{var t=document.querySelector('#pageStack .page:last-child').textContent;return {a:/协议变更审批/.test(t),b:/同意变更并生效/.test(t)};})()`);
  ok(agrDom.a&&agrDom.b,'运营端渲染协议变更审批区与同意动作', JSON.stringify(agrDom));
  /* 协议变更批准 → 账实应收重算 → 成本/分账联动，但总额恒等 */
  const cp = await j(`(function(){var R=splitRowsReal();return {net:R.z.net,pool:R.rows.filter(w=>w.g==='pool')[0].v,keep:R.rows.filter(w=>w.n==='留存毛利')[0].v,sum:R.sum,amt:DB.rights.merchants[0].amt,price:agrPrice(DB.rights.merchants[0])};})()`);
  await ev(`(function(){var i=DB.rights.contracts.findIndex(c=>c.st==='待审批');agrApprove(i);return i;})()`); await sleep(700);
  const cq = await j(`(function(){var R=splitRowsReal();return {net:R.z.net,pool:R.rows.filter(w=>w.g==='pool')[0].v,keep:R.rows.filter(w=>w.n==='留存毛利')[0].v,sum:R.sum,amt:DB.rights.merchants[0].amt,price:agrPrice(DB.rights.merchants[0])};})()`);
  ok(cq.price===30 && cq.amt===412*30,'协议变更生效 → 账实应收按新单价重算', `单价 ¥${cp.price}→¥${cq.price} · 应收 ¥${cp.amt}→¥${cq.amt}`);
  ok(cq.net<cp.net && Math.abs((cp.net-cq.net)-1648)<1,'权益实付成本随协议价下降 ¥1,648', `¥${cp.net}→¥${cq.net}`);
  ok(cq.pool<cp.pool && cq.keep>cp.keep,'分账权益行与留存毛利反向联动', `权益 ¥${cp.pool}→¥${cq.pool} · 留存 ¥${cp.keep}→¥${cq.keep}`);
  ok(cq.sum===298,'五口径合计仍恒为 ¥298', 'sum='+cq.sum);
  /* 超支全额批准 → 缺口有出处 → 熔断解除 */
  await ev(`(function(){var i=DB.rights.overrun.asks.findIndex(a=>a.st==='待审批');rsnOverApprove(i);return i;})()`); await sleep(600);
  const ov1 = await j(`(function(){var o=overrunState();return {fromKeep:o.fromKeep,fuse:o.fuse,st:DB.rights.overrun.asks[0].st};})()`);
  ok(ov1.fromKeep===0 && ov1.fuse===false,'超支批准后缺口有出处、熔断解除', `未覆盖 ¥${ov1.fromKeep} · fuse=${ov1.fuse}`);
  ok((await j(`splitRowsReal().sum`))===298,'批准只换科目，不破 ¥298 恒等');
  /* 商户端发起协议变更 → 运营端可见 */
  await clearStack(); await ev(`setEnd('merch');pushContractChangePage()`); await sleep(800);
  await ev(`agrSheet()`); await sleep(400);
  await ev(`(function(){document.querySelector('#agrTo').value='29';document.querySelector('#agrWhy').value='自动化回归：成本联动作业';return 1;})()`);
  await ev(`agrSubmit()`); await sleep(700);
  const mg = await j(`(function(){var m=sbcMyLine();var l=agrMyContracts(m);return {n:l.length,last:l[0]?l[0].id:null,st:l[0]?l[0].st:null,to:l[0]?l[0].to:null};})()`);
  ok(mg.n>=1 && mg.st==='待审批','商户端发起协议变更进入待审批队列', JSON.stringify(mg));
  await clearStack(); await ev(`setEnd('admin');pushRightsPage()`); await sleep(700);
  const seen = await ev(`(()=>{var t=document.querySelector('#pageStack .page:last-child').textContent;return t.indexOf('AG-1019-')>=0;})()`);
  ok(seen===true,'运营端可见商户新提交的变更单（跨端同源）');

  console.log('\n【K】下期预算预测 · 事前预警（v1.9）');
  await ev(`resetDemo()`); await sleep(500);
  await clearStack(); await ev(`setEnd('admin');pushRightsPage()`); await sleep(800);
  const fk0 = await j(`(function(){var f=fcState();return {
    net:f.net,perDayAll:f.perDayAll,perDayLast:f.perDayLast,trend:f.trend,fcNext:f.fcNext,
    fcGap:f.fcGap,rate:f.rate,pool:f.pool,bottom:f.bottom,perBuf:f.fcPerBuf,lv:f.lv,
    perPlan:DB.rights.budget.per,
    wSum:f.weeks.reduce(function(a,w){return a+w.amt;},0),
    agrSave:f.agrSave,fcNextAgr:f.fcNextAgr,fcRateAgr:f.fcRateAgr,fcNextCut:f.fcNextCut,fcRateCut:f.fcRateCut,
    limit:f.limit,amber:f.amber,sum:splitRowsReal().sum};})()`);
  ok(fk0.wSum === fk0.net, '周节奏合计 = 本期实付（预测数据自洽）', `三周 ¥${fk0.wSum} = 实付 ¥${fk0.net}`);
  ok(fk0.trend > 0.25, '趋势增速由周节奏得出且显著为正', `近周日均 ¥${fk0.perDayLast} vs 全期 ¥${fk0.perDayAll} → +${(fk0.trend*100).toFixed(1)}%`);
  ok(fk0.fcNext === Math.round(fk0.net*(1+fk0.trend)), '下期预测 = 本期实付 × (1 + 趋势)', `¥${fk0.fcNext}`);
  ok(fk0.rate > fk0.amber, '预测超支率破红灯线 → 点亮红灯', `超支率 ${(fk0.rate*100).toFixed(1)}% > ${(fk0.amber*100)}%`);
  ok(fk0.bottom < 19, '预留池见底日早于账期结束（事前可干预）', `第 ${fk0.bottom.toFixed(1)} 天见底 / 账期 19 天`);
  ok(fk0.perBuf > fk0.perPlan, '建议预留单价高于现行预留', `¥${fk0.perPlan} → 建议 ¥${fk0.perBuf}`);
  ok(fk0.sum === 298, '预测过程不碰 ¥298 恒等式', 'sum='+fk0.sum);
  /* what-if 三动作与真实模型同式 */
  ok(fk0.agrSave === 1648 && fk0.fcNextAgr < fk0.fcNext, 'what-if：待审批调价可降低预测', `省 ¥${fk0.agrSave} → 预测 ¥${fk0.fcNextAgr}`);
  ok(fk0.fcRateCut > fk0.limit, 'what-if：收缩投放 10% 仍破线（必须动价格）', `收缩后 ${(fk0.fcRateCut*100).toFixed(1)}% 仍 > ${(fk0.limit*100)}%`);
  /* 协议变更生效 → 预测联动，且 what-if 预览值 = 批准后实际值 */
  await ev(`(function(){var i=DB.rights.contracts.findIndex(c=>c.st==='待审批');agrApprove(i);return i;})()`); await sleep(700);
  const fk1 = await j(`(function(){var f=fcState();return {fcNext:f.fcNext,rate:f.rate,perBuf:f.fcPerBuf,net:f.net,trend:f.trend,sum:splitRowsReal().sum};})()`);
  ok(fk1.fcNext === fk0.fcNextAgr, 'what-if 预览值 = 批准后的实际值（同式同源）', `预览 ¥${fk0.fcNextAgr} = 实际 ¥${fk1.fcNext}`);
  ok(fk1.fcNext < fk0.fcNext && fk1.rate < fk0.rate, '协议生效后预测成本与超支率同步回落', `¥${fk0.fcNext}→¥${fk1.fcNext} · ${(fk0.rate*100).toFixed(1)}%→${(fk1.rate*100).toFixed(1)}%`);
  ok(Math.abs(fk1.trend - fk0.trend) < 0.0001, '趋势增速不因账面下调而失真（历史事实恒定）', `+${(fk0.trend*100).toFixed(1)}% 恒定`);
  ok(fk1.sum === 298, '协议生效后 ¥298 恒等仍未破', 'sum='+fk1.sum);
  /* 预警分级三态 */
  const g3 = await j(`(function(){var R=DB.rights,out={};R.budget.pool=40000;out.g=fcState().lv;R.budget.pool=32000;out.a=fcState().lv;R.budget.pool=26522;out.r=fcState().lv;return out;})()`);
  ok(g3.g==='green'&&g3.a==='amber'&&g3.r==='red', '预警三态分级正确（绿/黄/红）', JSON.stringify(g3));
  /* 页面渲染与跳转 */
  const fkDom = await ev(`(()=>{var t=document.querySelector('#pageStack .page:last-child').textContent;return {a:/下期预算预测/.test(t),b:/事前预警/.test(t),c:/见底日/.test(t),d:/协议调价（首选）/.test(t),e:/去审批协议变更/.test(t)};})()`);
  ok(fkDom.a&&fkDom.b&&fkDom.c&&fkDom.d&&fkDom.e, '预警区块完整渲染（灯/节奏/见底日/三动作/跳转）', JSON.stringify(fkDom));
  const jmp = await ev(`(function(){fcJump('.ovs-card.agr');return 1;})()`); await sleep(400);
  ok(jmp===1, '预警动作跳转可执行且无 JS 异常');

  console.log('\n────────────────────────');
  console.log(`跨页数据一致性走查：PASS ${pass} / FAIL ${fail}`);
  ws.close(); chrome.kill();
  process.exit(fail?1:0);
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
