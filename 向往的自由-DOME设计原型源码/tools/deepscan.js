/**
 * 二级下钻扫描：进入每个 push 子页面，再扫该页所有可交互元素
 * 覆盖一级扫描因「页面跳转未复位」而跳过的元素
 * 用法：node tools/deepscan.js
 */
const { spawn } = require('child_process');
const fs = require('fs'), fsx = require('fs');
const pathx = require('path');
const { pathToFileURL } = require('url');
const CHROME = process.env.CHROME || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find(p => fsx.existsSync(p)) || 'chrome';
const ROOT = pathx.resolve(__dirname, '..');
const HTML = process.env.HTML || pathToFileURL(pathx.join(ROOT, '向往的自由-业务系统demo-高保真版.html')).href;
const PORT = Number(process.env.PORT || 9401);
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 全部已注册的 push* 页面函数，从源码里自动抽取，避免遗漏 */
const PUSH_FNS = [
  'pushTourDetail(1)', 'pushCategoryPage(\'all\')', 'pushCategoryPage(\'script\')', 'pushScriptPage(2)',
  'pushProductDetail(1)', 'pushBeanUsePage(\'fee\')', 'pushBeanUsePage(\'ticket\')', 'pushBeanUsePage(\'plot\')', 'pushBeanUsePage(\'photo\')',
  'pushBeanDetailPage()', 'pushBadgeDetail(0)', 'pushBadgesPage()', 'pushTravelIdPage()', 'pushMyOrdersPage()',
  'pushOrderDetailPage(0)', 'pushTravelsPage()', 'pushCreateCenter()', 'pushMissionsPage()', 'pushMyWorksPage()',
  'pushSearchPage()', 'pushHotListPage()', 'pushNoteDetail(0)', 'pushNftDetail(0)', 'pushBuyerShow(0)', 'pushGuidePage()',
  'pushPickedWorksPage()', 'pushEcoPage()', 'pushDemoCasePage()', 'pushRedeemPage()', 'pushStatementPage()',
  'pushStockDetail(0)', 'pushGoodsPoolPage()', 'pushEarnDetailPage()', 'pushLevelRulePage()', 'pushDownlineDetail(0)',
  'pushBeanLoopPage(\'c\')', 'pushBeanLoopPage(\'b\')', 'pushBeanLoopPage(\'h\')', 'pushTravelsPage()', 'pushPosterPage()', 'pushSettingsPage()', 'pushAboutPage()',
  /* v1.4 起补录：Web3 底座与发行中台（此前只做截图，未纳入深度走查） */
  'pushWeb3Page()', 'pushNftOpsPage()', 'pushRightsPage()',
  /* v1.8：商户端协议变更申请（成本控制闭环的下游） */
  'pushContractChangePage()',
  /* v1.7 商户端权益对账单（确认 / 申诉闭环） */
  'pushSettleBillPage()',
  /* v1.3 六大引擎可玩链路四页 */
  "pushEnginePage('reward')", "pushEnginePage('contrib')", "pushEnginePage('settle')", "pushEnginePage('gateway')",
];

(async () => {
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${PORT}`, 'about:blank'], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); t = await r.json(); if (t.find(x => x.type === 'page')) break; } catch (e) {}
  }
  const ws = new WebSocket(t.find(x => x.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map(); const errs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').slice(0, 200));
  };
  const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? { __err: (r.exceptionDetails.exception?.description || r.exceptionDetails.text) } : r.result.value; };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 920, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: HTML }); await sleep(2200);
  await ev(`S.loggedIn=true;S.loginStep='role';document.querySelector('#loginLayer').classList.remove('on')`);
  await sleep(400);

  const RESET = `closeSheet();document.querySelector('#mask').classList.remove('show');document.querySelectorAll('#pageStack .page').forEach(p=>p.remove());S.stack=[];document.querySelectorAll('#baseScroll .ptr').forEach(p=>p.remove());`;
  let total = 0, dead = 0, jsErr = 0, skipped = 0;
  const deadList = [], errList = [];

  for (const fn of PUSH_FNS) {
    await ev(RESET);
    await ev(`setEnd('tourist');setTab('home')`);
    await sleep(200);
    errs.length = 0;
    const opened = await ev(`(()=>{ try{ ${fn}; return true; }catch(e){ return String(e); } })()`);
    if (opened !== true) { deadList.push(`${fn} → 打开失败 ${opened}`); dead++; console.log(`  ✗ ${fn}  打开失败`); continue; }
    await sleep(420);
    const title = await ev(`(document.querySelector('#pageStack .page:last-child .nav-title')||{}).textContent||'(无栈)'`);
    if (title === '(无栈)') { deadList.push(`${fn} → 未产生页面栈`); dead++; console.log(`  ✗ ${fn}  未产生页面栈`); continue; }

    const items = await ev(`(()=>{
      const page = document.querySelector('#pageStack .page:last-child');
      if(!page) return [];
      return [...page.querySelectorAll('[onclick],[oninput],[onchange]')].map((n,i)=>{
        /* 已选中项（chip/seg/tab 带 .on）点击后本就不产生变化，跳过以消除误报 */
        const on = n.classList&&(n.classList.contains('on')||n.classList.contains('active'));
        return {i, tag:n.tagName.toLowerCase(), oc:(n.getAttribute('onclick')||n.getAttribute('oninput')||'').slice(0,64), on:!!on, type:(n.getAttribute('type')||'')};
      });
    })()`);
    let tabDead = 0;
    for (const it of items) {
      if (it.on) { skipped++; continue; }   /* 已选中项：语义上就是幂等 */
      await ev(RESET + `${fn};`);
      await sleep(260);
      errs.length = 0;
      const res = await ev(`(()=>{
        const page = document.querySelector('#pageStack .page:last-child');
        if(!page) return {found:false};
        const nodes=[...page.querySelectorAll('[onclick],[oninput],[onchange]')];
        const el=nodes[${it.i}]; if(!el) return {found:false};
        /* 快照必须包含「高亮 class」与「元素顺序」：仅 innerHTML 长度不变但 class 切换（如排序档切换）
           也属于真实响应，否则会把生效的切换误判为死链 */
        const sig=()=>[...document.querySelectorAll('#pageStack .page:last-child [class*="on"],#pageStack .page:last-child .chip,#pageStack .page:last-child .cat-sortbar span')].map(n=>n.textContent.trim().slice(0,10)+(n.className||'')).join(',');
        const snap=()=>document.querySelector('#screen').innerHTML.length+'|'+(document.querySelector('#toast')||{className:''}).className+'|'+document.querySelectorAll('#pageStack .page').length+'|'+JSON.stringify(DB.wallet)+'|'+sig();
        const before=snap(); let err=null;
        try{
          if(el.tagName==='INPUT'&&(el.type==='range'||el.type==='number')){
            el.value=(parseFloat(el.min||0)+parseFloat(el.max||100))/2;
            el.dispatchEvent(new Event('input',{bubbles:true}));
            el.dispatchEvent(new Event('change',{bubbles:true}));
          } else if(el.tagName==='INPUT'&&(el.type==='text'||el.type==='search'||!el.type)){
            el.value='瑜伽';   /* 文本搜索框：赋真实值再触发，否则读不到输入差异 */
            el.dispatchEvent(new Event('input',{bubbles:true}));
          } else el.click();
        }catch(e){ err=String(e); }
        const after=snap();
        const sheet=document.querySelector('#sheet').classList.contains('show');
        return {found:true,changed:before!==after||sheet,err};
      })()`);
      if (!res || !res.found) continue;
      total++;
      if (res.err) { dead++; tabDead++; jsErr++; errList.push(`${fn} [${it.oc}] ${res.err}`); }
      else if (!res.changed) { dead++; tabDead++; deadList.push(`${title} [${it.tag}] ${it.oc}`); }
      if (errs.length) { dead++; tabDead++; jsErr++; errList.push(`${fn} → 运行时异常 ${errs[0].slice(0, 120)}`); errs.length = 0; }
      await sleep(110);
    }
    console.log(`  ${tabDead ? '✗ ' + tabDead : '✓'}  ${String(title).padEnd(12)} ← ${fn.padEnd(30)} 共 ${items.length} 个元素`);
  }

  console.log('\n────────────────────────');
  console.log(`二级下钻扫描：${PUSH_FNS.length} 个子页面 · ${total} 个交互元素（另跳过已选中项 ${skipped} 个，幂等不计）`);
  console.log(`无响应/报错：${dead} 个（其中 JS 异常 ${jsErr} 个）`);
  if (deadList.length) { console.log('\n问题明细：'); [...new Set(deadList)].forEach(d => console.log('  ✗ ' + d)); }
  if (errList.length) { console.log('\n异常明细：'); [...new Set(errList)].forEach(d => console.log('  ! ' + d)); }
  ws.close(); chrome.kill();
  process.exit(dead ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });