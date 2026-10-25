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
const PORT = Number(process.env.PORT || 9370);
const OUT = process.env.OUT || (function(){
  const d = pathx.resolve(__dirname, 'shots3');
  if(!fsx.existsSync(d)) fsx.mkdirSync(d, { recursive: true });
  return d + pathx.sep;
})();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TARGET = process.env.T || 'tourist:home';
(async () => {
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${PORT}`, 'about:blank'], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 40; i++) { await sleep(250); try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); t = await r.json(); if (t.find(x => x.type === 'page')) break; } catch (e) {} }
  const ws = new WebSocket(t.find(x => x.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map(); const errs = [];
  ws.onmessage = e => { const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').slice(0, 300)); };
  const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? { __err: (r.exceptionDetails.exception?.description || r.exceptionDetails.text) } : r.result.value; };
  const shot = async (name) => {
    const c = await ev(`(()=>{const r=document.querySelector('#screen').getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)};})()`);
    const r = await send('Page.captureScreenshot', { format: 'png', clip: { ...c, scale: 2 }, captureBeyondViewport: true });
    fs.writeFileSync(OUT + 'v-' + name + '.png', Buffer.from(r.data, 'base64'));
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 920, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: HTML }); await sleep(2200);
  await ev(`S.loggedIn=true;S.loginStep='role';document.querySelector('#loginLayer').classList.remove('on')`); await sleep(300);
  const [end, tab] = TARGET.split(':');
  await ev(`setEnd('${end}')`); await sleep(400);
  await ev(`setTab('${tab}')`); await sleep(700);
  if (process.env.CMD) { const r = await ev(process.env.CMD); const s = typeof r === 'string' ? r : JSON.stringify(r); console.log('cmd:', (s || 'void').slice(0,80)); await sleep(700); }
  const info = await ev(`JSON.stringify({scenes:document.querySelectorAll('.scene').length, broken:[...document.querySelectorAll('.scene')].filter(s=>s.getBoundingClientRect().width<5).length, prod:document.querySelectorAll('.prod').length, tour:document.querySelectorAll('.tour').length})`);
  console.log(TARGET, info);
  console.log('errors:', errs.length ? errs.slice(0,3).join(' || ') : 'none');
  const total = await ev(`(()=>{const p=document.querySelector('.page.in');const s=p?p.querySelector('.page-body'):document.querySelector('#baseScroll');return s?s.scrollHeight:0;})()`);
  console.log('scrollHeight:', total);
  const step = 780;
  for (let i = 0, y = 0; i < 8 && y < total; i++, y += step) {
    await ev(`(()=>{const p=document.querySelector('.page.in');const s=p?p.querySelector('.page-body'):document.querySelector('#baseScroll');if(s)s.scrollTop=${y};})()`);
    await sleep(320);
    await shot(TARGET.replace(':','-') + '-s' + i);
  }
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
