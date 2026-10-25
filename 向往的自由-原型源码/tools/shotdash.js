/* 驾驶舱多口径截图：node tools/shotdash.js */
const { spawn } = require('child_process');
const fs = require('fs');
const pathx = require('path');
const { pathToFileURL } = require('url');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p)) || 'chrome';
const ROOT = pathx.resolve(__dirname, '..');
const HTML = pathToFileURL(pathx.join(ROOT, '向往的自由-业务系统demo-高保真版.html')).href;
const OUT = pathx.join(ROOT, 'shots_dash');
const PORT = Number(process.env.PORT || 9412);
const sleep = ms => new Promise(r => setTimeout(r, ms));
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const chrome = spawn(CHROME, ['--headless=new','--disable-gpu','--no-sandbox',`--remote-debugging-port=${PORT}`,'about:blank'], { stdio:'ignore' });
  let t = null;
  for (let i = 0; i < 40; i++) { await sleep(250); try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); t = await r.json(); if (t.find(x => x.type === 'page')) break; } catch(e){} }
  const ws = new WebSocket(t.find(x => x.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map(); const errs = [];
  ws.onmessage = e => { const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').slice(0,200)); };
  const send = (m, p={}) => new Promise((res, rej) => { const i = ++id; pend.set(i, {res,rej}); ws.send(JSON.stringify({id:i, method:m, params:p})); });
  const ev = async x => { const r = await send('Runtime.evaluate', { expression:x, returnByValue:true, awaitPromise:true }); return r.exceptionDetails ? { __err:(r.exceptionDetails.exception?.description||r.exceptionDetails.text) } : r.result.value; };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width:430, height:920, deviceScaleFactor:2, mobile:false });
  await send('Page.navigate', { url:HTML }); await sleep(2400);
  await ev(`S.loggedIn=true;document.querySelector('#loginLayer').classList.remove('on')`); await sleep(400);
  await ev(`setEnd('admin');setTab('dash')`); await sleep(900);

  for (const k of ['7d','30d','90d','mtd']) {
    await ev(`setDashRange('${k}')`); await sleep(800);
    /* 视口内首屏 */
    const r1 = await send('Page.captureScreenshot', { format:'png' });
    fs.writeFileSync(pathx.join(OUT, 'dash-' + k + '-top.png'), Buffer.from(r1.data, 'base64'));
    /* 整页（限高 4200）避免过长 */
    const c = await ev(`(()=>{const r=document.querySelector('#screen').getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)};})()`);
    const r2 = await send('Page.captureScreenshot', { format:'png', clip:{...c, scale:1}, captureBeyondViewport:true });
    fs.writeFileSync(pathx.join(OUT, 'dash-' + k + '-full.png'), Buffer.from(r2.data, 'base64'));
  }
  /* 关键区块特写 */
  await ev(`setDashRange('7d')`); await sleep(700);
  for (const [sel, name] of [['#baseScroll .dgn','dgn'],['#baseScroll .admin-kpi','kpi'],['#cityCard','city']]) {
    const ok = await ev(`(()=>{const el=document.querySelector('${sel}');if(!el)return false;el.scrollIntoView({block:'center'});return true;})()`);
    if (!ok) { console.log('!! 未找到 ' + sel); continue; }
    await sleep(500);
    const r = await send('Page.captureScreenshot', { format:'png' });
    fs.writeFileSync(pathx.join(OUT, 'blk-' + name + '.png'), Buffer.from(r.data, 'base64'));
  }
  const h = await ev(`document.querySelector('#baseScroll').scrollHeight`);
  console.log('驾驶舱内容高度：' + h + 'px');
  console.log('JS 异常：' + (errs.length ? errs.join(' | ') : '0 条'));
  ws.close(); chrome.kill();
})();
