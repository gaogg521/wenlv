/**
 * 孤岛死链全量回归走查（v1.3 新增）
 * 目标：确认每端每个 tab 内的可点击元素都不是「点了没反应」的死链
 * 做法：遍历所有 onclick 属性，逐个真实点击，验证产生 DOM 变化 / toast / 页面跳转
 * 用法：node tools/deadlink.js
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
const OUT = process.env.OUT || pathx.join(ROOT, 'shots_dead');
const PORT = Number(process.env.PORT || 9397);
const sleep = ms => new Promise(r => setTimeout(r, ms));
if (!fsx.existsSync(OUT)) fsx.mkdirSync(OUT, { recursive: true });

/* v1.14：端从 4 个改为 3 个客户端。tab 首屏走 setTab；
   二级页（推广中心）走 enter 表达式，可点击元素在 #pageStack 里而不是 #baseScroll。
   v1.14.1：商城回 tabBar 一级位（赵老师拍板），shop 从二级页移回 tab 遍历。 */
const TABS = [
  { end:'tourist', tab:'home',  box:'#baseScroll' },
  { end:'tourist', tab:'theme', box:'#baseScroll' },
  { end:'tourist', tab:'shop',  box:'#baseScroll' },
  { end:'tourist', tab:'wallet',box:'#baseScroll' },
  { end:'tourist', tab:'me',    box:'#baseScroll' },
  { end:'tourist', name:'promo-earn',   enter:`pushPromoCenter();promoTabSwitch('earn')`,   box:'#pageStack .page:last-child .page-body' },
  { end:'tourist', name:'promo-invite', enter:`openPromoTab('invite')`,                    box:'#pageStack .page:last-child .page-body' },
  { end:'tourist', name:'promo-team',   enter:`openPromoTab('team')`,                      box:'#pageStack .page:last-child .page-body' },
  { end:'tourist', name:'promo-me',     enter:`pushPromoMePage()`,                         box:'#pageStack .page:last-child .page-body' },
  { end:'merch',   tab:'work',   box:'#baseScroll' },
  { end:'merch',   tab:'order',  box:'#baseScroll' },
  { end:'merch',   tab:'supply', box:'#baseScroll' },
  { end:'merch',   tab:'mme',    box:'#baseScroll' },
  { end:'admin',   tab:'dash',  box:'#baseScroll' },
  { end:'admin',   tab:'risk',  box:'#baseScroll' },
  { end:'admin',   tab:'audit', box:'#baseScroll' },
  { end:'admin',   tab:'calc',  box:'#baseScroll' },
  { end:'admin',   tab:'ame',   box:'#baseScroll' },
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
  const shot = async name => {
    const c = await ev(`(()=>{const r=document.querySelector('#screen').getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)};})()`);
    const r = await send('Page.captureScreenshot', { format: 'png', clip: { ...c, scale: 2 }, captureBeyondViewport: true });
    fs.writeFileSync(pathx.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
  };
  /** 在页面里注入探针：点击某元素，记录是否产生可观测变化 */
  const PROBE = `
    window.__probe = function(sel){
      const el = document.querySelector(sel);
      if(!el) return { found:false };
      const screen = document.querySelector('#screen');
      const before = screen.innerHTML.length + '|' + (document.querySelector('#toast')||{className:''}).className + '|' + document.querySelectorAll('#pageStack .page').length + '|' + JSON.stringify(DB.wallet)+'|'+JSON.stringify(DB.admin&&DB.admin.todayOrders);
      try{ el.click(); }catch(e){ return { found:true, err:String(e) }; }
      const after = screen.innerHTML.length + '|' + (document.querySelector('#toast')||{className:''}).className + '|' + document.querySelectorAll('#pageStack .page').length + '|' + JSON.stringify(DB.wallet)+'|'+JSON.stringify(DB.admin&&DB.admin.todayOrders);
      const sheetOpen = document.querySelector('#sheet').classList.contains('show');
      const maskOpen = document.querySelector('#mask').classList.contains('show');
      return { found:true, changed: before!==after || sheetOpen || maskOpen, sheet:sheetOpen, mask:maskOpen };
    };`;

  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 920, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: HTML }); await sleep(2200);
  await ev(`S.loggedIn=true;S.loginStep='role';document.querySelector('#loginLayer').classList.remove('on')`);
  await ev(PROBE);
  await sleep(300);

  let total = 0, dead = 0, errs2 = 0;
  const deadList = [];

  for (const it of TABS) {
    const end = it.end, tab = it.tab || it.name;
    await ev(`setEnd('${end}');${it.tab ? "setTab('"+it.tab+"')" : "clearStack();"+it.enter}`);
    await sleep(500);
    // 收集该屏所有可点击元素
    const items = await ev(`(()=>{
      const box = document.querySelector('${it.box}');
      const nodes = [...box.querySelectorAll('[onclick],[oninput],[onchange]')];
      return nodes.map((n,i)=>({ i, tag:n.tagName.toLowerCase(), cls:n.className||'', oc:(n.getAttribute('onclick')||n.getAttribute('oninput')||'').slice(0,70) }));
    })()`);
    if (!items || !items.length) { console.log(`  ${end}:${tab}  —  无可点击元素`); continue; }
    let tabDead = 0, tabMiss = 0;
    for (const it of items) {
      // 复位到该 tab 干净状态
      await ev(`setEnd('${end}');${it.tab ? "setTab('"+it.tab+"')" : "clearStack();"+it.enter}`);
      await sleep(260);
      const res = await ev(`(()=>{
        const box = document.querySelector('${it.box}');
        const nodes = [...box.querySelectorAll('[onclick],[oninput],[onchange]')];
        const el = nodes[${it.i}];
        if(!el) return {found:false};
        const screen = document.querySelector('#screen');
        const snap = () => screen.innerHTML.length + '|' + (document.querySelector('#toast')||{className:''}).className + '|' + document.querySelectorAll('#pageStack .page').length + '|' + JSON.stringify(DB.wallet);
        const before = snap();
        let err=null;
        try{
          if(el.tagName==='INPUT' && (el.type==='range'||el.type==='number')){
            const mid = (parseFloat(el.min||0)+parseFloat(el.max||100))/2;
            el.value = mid;
            if(el.type==='range') el.dispatchEvent(new Event('input',{bubbles:true}));
            else { el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true})); }
          } else el.click();
        }catch(e){ err = String(e); }
        const after = snap();
        const sheetOpen = document.querySelector('#sheet').classList.contains('show');
        const maskOpen = document.querySelector('#mask').classList.contains('show');
        return {found:true, changed: before!==after || sheetOpen || maskOpen, sheet:sheetOpen, err};
      })()`);
      if (!res || !res.found) { tabMiss++; continue; }
      total++;
      if (res.err) { dead++; tabDead++; errs2++; deadList.push(`${end}:${tab} [${it.oc}] → JS错误 ${res.err}`); continue; }
      if (!res.changed) { dead++; tabDead++; deadList.push(`${end}:${tab} [${it.tag}.${String(it.cls).split(' ')[0]}] ${it.oc}`); }
      await sleep(140);
    }
    const mark = tabDead ? '✗ ' + tabDead + ' 处无响应' : '✓';
    const note = tabMiss ? `（${tabMiss} 个元素因页面跳转未复位而跳过）` : '';
    console.log(`  ${mark}  ${end}:${tab}  共 ${items.length} 个可点击元素${note}`);
  }

  console.log('\n────────────────────────');
  console.log(`扫描可点击元素：${total} 个`);
  console.log(`无响应死链：${dead} 个（其中 JS 错误 ${errs2} 个）`);
  if (deadList.length) {
    console.log('\n死链明细：');
    deadList.forEach(d => console.log('  ✗ ' + d));
  }
  if (errs.length) {
    console.log('\n页面级异常：');
    [...new Set(errs)].slice(0, 5).forEach(e => console.log('  ! ' + e));
  }
  ws.close(); chrome.kill();
  process.exit(dead ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });