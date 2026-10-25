const { spawn } = require('child_process');
const fs = require('fs');
const fsx = require('fs');
const pathx = require('path');
const { pathToFileURL } = require('url');
const CHROME = process.env.CHROME || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find(function(p){ return fsx.existsSync(p); }) || 'chrome';
const HTML = process.env.HTML || pathToFileURL(
  pathx.resolve(__dirname, '..', '向往的自由-业务系统demo-高保真版.html')
).href;
const PORT = Number(process.env.PORT || 9360);
const VW = 430, VH = 920;
const OUT = process.env.OUT || (function(){
  const d = pathx.resolve(__dirname, 'shots3');
  if(!fsx.existsSync(d)) fsx.mkdirSync(d, { recursive: true });
  return d + pathx.sep;
})();
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

const PROBE = `(function(){
  const scr = document.querySelector('#screen');
  const sr = scr.getBoundingClientRect();
  const issues = [];
  const name = el => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    if (el.className && typeof el.className === 'string') s += '.' + el.className.trim().split(/\\s+/).slice(0,2).join('.');
    return s;
  };
  // 1. 文字/内容溢出被裁
  document.querySelectorAll('#screen *').forEach(el => {
    if (el.closest('svg')) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const txt = (el.textContent || '').trim();
    // 只看有直接文本的元素
    const hasOwnText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (hasOwnText && cs.overflow === 'visible') {
      if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) {
        issues.push({ t: 'text-clip', el: name(el), txt: txt.slice(0, 26), sw: el.scrollWidth, cw: el.clientWidth });
      }
    }
    // 2. 横向越界（超出屏幕可视区）
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > sr.right + 1.5 && cs.position !== 'absolute' && !el.closest('.hsc,.chips,.gslides,.buyer-show,.nft-row')) {
      issues.push({ t: 'overflow-right', el: name(el), d: Math.round(r.right - sr.right) });
    }
  });
  // 3. 滚动区底部是否被 tab 栏压住
  const sc = document.querySelector('#baseScroll');
  const tb = document.querySelector('#tabBar');
  if (sc && tb && sc.innerHTML.trim() && sc.scrollHeight > 0) {
    const prev = sc.scrollTop; sc.scrollTop = sc.scrollHeight;
    const last = sc.lastElementChild;
    if (last) {
      const lr = last.getBoundingClientRect(), tr = tb.getBoundingClientRect();
      if (lr.bottom > tr.top + 1) issues.push({ t: 'tab-occlude', el: name(last), over: Math.round(lr.bottom - tr.top) });
    }
    sc.scrollTop = prev;
  }
  // 4. 检查可见页面底部内容是否被底栏挡住（子页面）
  const pg = document.querySelector('.page.in');
  if (pg) {
    const body = pg.querySelector('.page-body');
    const foot = pg.querySelector('.page-foot');
    if (body && foot) {
      const br = body.getBoundingClientRect(), fr = foot.getBoundingClientRect();
      if (br.bottom > fr.top + 2) issues.push({ t: 'foot-occlude', over: Math.round(br.bottom - fr.top) });
    }
  }
  // 5. 元素相互重叠（同一父级下块级兄弟）
  // 只检测明显的：flex 容器子项宽度和超过容器
  document.querySelectorAll('#screen *').forEach(el => {
    const cs = getComputedStyle(el);
    if (cs.display !== 'flex' || cs.overflow !== 'hidden') return;
    const kids = [...el.children].filter(k => {
      const kc = getComputedStyle(k);
      return kc.display !== 'none' && kc.position !== 'absolute' && kc.position !== 'fixed';
    });
    if (kids.length < 2) return;
    const need = kids.reduce((a, k) => a + k.getBoundingClientRect().width, 0);
    const have = el.getBoundingClientRect().width;
    if (need > have + 4) issues.push({ t: 'flex-squeeze', el: name(el), need: Math.round(need), have: Math.round(have) });
  });
  return JSON.stringify(issues);
})()`;

(async () => {
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${PORT}`, 'about:blank'], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 40; i++) { await sleep(250); try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); t = await r.json(); if (t.find(x => x.type === 'page')) break; } catch (e) {} }
  const ws = new WebSocket(t.find(x => x.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map(); const errs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').slice(0, 160));
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text } : r.result.value; };
  const shot = async (name) => {
    const c = await ev(`(()=>{const r=document.querySelector('#screen').getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)};})()`);
    const r = await send('Page.captureScreenshot', { format: 'png', clip: { ...c, scale: 1 }, captureBeyondViewport: true });
    fs.writeFileSync(OUT + name + '.png', Buffer.from(r.data, 'base64'));
  };
  let report = [];
  const probe = async (label) => {
    const raw = await ev(PROBE);
    let list = [];
    try { list = JSON.parse(raw || '[]'); } catch (e) {}
    if (list.length) report.push({ page: label, issues: list });
    return list;
  };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: VW, height: VH, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: HTML }); await sleep(2200);
  await shot('00-login');
  await probe('login');
  await ev(`(()=>{const i=document.querySelector('#phoneInput');i.value='13800006666';i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await ev(`document.querySelector('#btnGetCode').click()`); await sleep(400);
  await ev(`(()=>{const i=document.querySelector('#codeInput');i.value='123456';i.dispatchEvent(new Event('input',{bubbles:true}));})()`); await sleep(1000);
  await shot('02-role'); await probe('role');
  await ev(`document.querySelector('.role-card').click()`); await sleep(500);
  await ev(`hideSplash()`); await sleep(400);

  const endKeys = JSON.parse(await ev(`JSON.stringify(Object.keys(ENDS).reduce((a,k)=>{a[k]=ENDS[k].tabs.map(t=>t.k);return a;},{}))`) || '{}');
  for (const end of Object.keys(endKeys)) {
    await ev(`setEnd('${end}')`); await sleep(450);
    for (const k of endKeys[end]) {
      await ev(`setTab('${k}')`); await sleep(520);
      await shot(end + '-' + k);
      await probe(end + '/' + k);
    }
  }
  const subs = [
    ['tourist', 'tid', `pushTravelIdPage()`], ['tourist', 'tourdetail', `pushTourDetail(6)`], ['tourist', 'tourdetail-yoga', `pushTourDetail(1)`],
    ['tourist', 'script', `pushScriptPage(6)`], ['tourist', 'scan', `pushScanPage(1)`], ['tourist', 'category', `pushCategoryPage('yoga')`],
    ['tourist', 'search', `pushSearchPage()`], ['tourist', 'badges', `pushBadgesPage()`], ['tourist', 'orders', `pushMyOrdersPage()`],
    ['tourist', 'create', `pushCreateCenter()`], ['tourist', 'missions', `pushMissionsPage()`], ['tourist', 'beanuse', `pushBeanUsePage('fee')`],
    ['tourist', 'beanDetail', `pushBeanDetailPage()`], ['tourist', 'product', `pushProductDetail(1)`],
    ['tourist', 'settings', `pushSettingsPage()`], ['tourist', 'about', `pushAboutPage()`],
    ['partner', 'earnDetail', `pushEarnDetailPage()`], ['partner', 'levelRule', `pushLevelRulePage()`], ['partner', 'types', `pushTypesPage()`],
    ['partner', 'poster', `pushPosterPage()`], ['partner', 'downline', `pushDownlineDetail(0)`],
    ['merch', 'stock', `pushStockPage()`], ['merch', 'redeem', `pushRedeemPage()`], ['merch', 'statement', `pushStatementPage()`], ['merch', 'morder', `pushMerchOrderDetail(0)`],
  ];
  for (const [end, name, code] of subs) {
    await ev(`setEnd('${end}')`); await sleep(300);
    await ev(`clearStack()`); await sleep(120);
    const r = await ev(code); await sleep(600);
    if (r && r.__error) { console.log('CALL-ERR ' + name + ': ' + String(r.__error).split('\n')[0].slice(0, 100)); continue; }
    await shot('sub-' + name);
    await probe(end + '/sub:' + name);
  }
  console.log('\n===== 溢出报告 =====');
  if (!report.length) console.log('无溢出问题');
  report.forEach(p => {
    console.log('[' + p.page + ']');
    p.issues.forEach(i => console.log('   ' + i.t + ' | ' + i.el + (i.txt ? ' | "' + i.txt + '"' : '') + ' | ' + JSON.stringify(Object.assign({}, i, { t: undefined, el: undefined, txt: undefined }))));
  });
  const iconAudit = await ev(`JSON.stringify((()=>{
    const syms = new Set([...document.querySelectorAll('symbol')].map(s=>s.id));
    const uses = [...document.querySelectorAll('svg.ic use, svg use')];
    const bad = {};
    uses.forEach(u=>{ const h=(u.getAttribute('href')||'').replace('#',''); if(h && !syms.has(h)) bad[h]=(bad[h]||0)+1; });
    return { total: uses.length, broken: bad };
  })())`);
  console.log('\n图标体检:', iconAudit);
  console.log('\nJS errors:', errs.length ? errs.slice(0, 5).join(' || ') : 'none');
  fs.writeFileSync(OUT + '_report.json', JSON.stringify(report, null, 1));
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
