const { spawn } = require('child_process');
const fs = require('fs');
const pathx = require('path');
const { pathToFileURL } = require('url');
const CHROME = process.env.CHROME || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find(p => fs.existsSync(p)) || 'chrome';
const HTML = process.env.HTML || pathToFileURL(
  pathx.resolve(__dirname, '..', '向往的自由-业务系统demo-高保真版.html')
).href;
const PORT = Number(process.env.PORT || 9350);
const W = Number(process.env.VW || 430), H = Number(process.env.VH || 900);
const TAG = process.env.TAG || 'n';
const OUT = process.env.OUT || pathx.resolve(__dirname, 'shots2') + pathx.sep;
const sleep = ms => new Promise(r => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${PORT}`, 'about:blank'], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 40; i++) { await sleep(250); try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); targets = await r.json(); if (targets.find(t => t.type === 'page')) break; } catch (e) {} }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let msgId = 0; const pending = new Map(); const errs = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').slice(0, 200));
    else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errs.push('[log] ' + m.params.entry.text.slice(0, 160));
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const id = ++msgId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  const evalJS = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text }; return r.result.value; };
  const shot = async (name) => {
    const c = await evalJS(`(()=>{const e=document.querySelector('#screen');const r=e.getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)};})()`);
    if (!c || c.__error) return;
    const r = await send('Page.captureScreenshot', { format: 'png', clip: { ...c, scale: 2 }, captureBeyondViewport: true });
    fs.writeFileSync(OUT + TAG + '-' + name + '.png', Buffer.from(r.data, 'base64'));
  };

  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: HTML });
  await sleep(2200);
  await shot('00-login');
  // 登录
  await evalJS(`(()=>{const i=document.querySelector('#phoneInput');i.value='13800006666';i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await evalJS(`document.querySelector('#btnGetCode').click()`); await sleep(400);
  await shot('01-code');
  await evalJS(`(()=>{const i=document.querySelector('#codeInput');i.value='123456';i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await sleep(1000);
  await shot('02-role');
  await evalJS(`document.querySelector('.role-card').click()`); await sleep(500);
  await shot('03-home');

  const endKeys = JSON.parse(await evalJS(`JSON.stringify(Object.keys(ENDS).reduce((a,k)=>{a[k]=ENDS[k].tabs.map(t=>t.k);return a;},{}))`) || '{}');
  for (const end of Object.keys(endKeys)) {
    await evalJS(`setEnd('${end}')`); await sleep(500);
    const tl = endKeys[end] || [];
    for (let i = 0; i < tl.length; i++) {
      const k = tl[i];
      await evalJS(`setTab('${k}')`); await sleep(560);
      await shot(end + '-tab' + i + '-' + k);
    }
  }
  // 关键子页（游客端）
  await evalJS(`setEnd('tourist')`); await sleep(400);
  const sub = [
    ['tid', `pushTravelIdPage()`],
    ['tourdetail', `pushTourDetail(6)`],
    ['script', `pushScriptPage(6)`],
    ['scan', `pushScanPage(1)`],
    ['category', `pushCategoryPage('yoga')`],
    ['search', `pushSearchPage()`],
    ['badges', `pushBadgesPage()`],
    ['orders', `pushMyOrdersPage()`],
    ['create', `pushCreateCenter()`],
    ['missions', `pushMissionsPage()`],
    ['beanuse', `pushBeanUsePage('travel')`],
    ['settings', `pushSettingsPage()`],
    ['about', `pushAboutPage()`],
  ];
  for (const [name, code] of sub) {
    await evalJS('clearStack()'); await sleep(150);
    const r = await evalJS(code); await sleep(650);
    if (r && r.__error) { console.log('ERR ' + name + ': ' + String(r.__error).slice(0, 120)); continue; }
    await shot('sub-' + name);
  }
  await evalJS('clearStack()');
  // 推广中心子页（v1.14：原「合伙人端」并入小程序 A 的推广中心）
  await evalJS(`setEnd('tourist')`); await sleep(400);
  for (const [name, code] of [['center', "pushPromoCenter();promoTabSwitch('earn')"], ['invite', "openPromoTab('invite')"], ['team', "openPromoTab('team')"], ['me', 'pushPromoMePage()'], ['earn', 'pushEarnDetailPage()'], ['level', 'pushLevelRulePage()'], ['types', 'pushTypesPage()'], ['poster', 'pushPosterPage()'], ['downline', 'pushDownlineDetail(0)']]) {
    await evalJS('clearStack()'); await sleep(150);
    const r = await evalJS(code); await sleep(600);
    if (r && r.__error) { console.log('ERR ' + name + ': ' + String(r.__error).slice(0, 120)); continue; }
    await shot('promo-' + name);
  }
  await evalJS('clearStack()');
  // 商户子页
  await evalJS(`setEnd('merch')`); await sleep(400);
  for (const [name, code] of [['verify', 'openVerifySheet(0)'], ['stock', 'pushStockPage()'], ['redeem', 'pushRedeemPage()'], ['statement', 'pushStatementPage()'], ['order', 'pushMerchOrderDetail(0)']]) {
    await evalJS('clearStack()'); await sleep(150);
    const r = await evalJS(code); await sleep(600);
    if (r && r.__error) { console.log('ERR ' + name + ': ' + String(r.__error).slice(0, 120)); continue; }
    await shot('merch-' + name);
    await evalJS(`document.querySelectorAll('#sheet,#dialog').forEach(x=>x.classList.remove('show'));document.querySelector('#mask').classList.remove('show');`);
  }
  await evalJS('clearStack()');
  console.log('errors:', errs.length ? errs.slice(0, 6).join(' || ') : 'none');
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
