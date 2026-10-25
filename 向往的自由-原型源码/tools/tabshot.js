/* 临时工具：截运营端五个 tab 顶部对比图（验证 hero 统一） */
const { spawn } = require('child_process');
const fs = require('fs');
const pathx = require('path');
const { pathToFileURL } = require('url');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p)) || 'chrome';
const ROOT = pathx.resolve(__dirname, '..');
const HTML = pathToFileURL(pathx.join(ROOT, '向往的自由-业务系统demo-高保真版.html')).href;
const OUT = pathx.join(ROOT, 'shots_tabs');
const PORT = Number(process.env.PORT || 9361);
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
  await send('Emulation.setDeviceMetricsOverride', { width:430, height:920, deviceScaleFactor:1, mobile:false });
  await send('Page.navigate', { url:HTML }); await sleep(2200);
  await ev(`S.loggedIn=true;S.loginStep='role';document.querySelector('#loginLayer').classList.remove('on')`);
  await sleep(400);

  for (const tab of ['dash','risk','audit','calc','ame']) {
    await ev(`setEnd('admin');setTab('${tab}')`); await sleep(800);
    /* 只截顶部 300px：用 clip 相对 #screen */
    const c = await ev(`(()=>{const r=document.querySelector('#screen').getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:300};})()`);
    const r = await send('Page.captureScreenshot', { format:'png', clip:{...c, scale:2}, captureBeyondViewport:true });
    fs.writeFileSync(pathx.join(OUT, 'admin-'+tab+'.png'), Buffer.from(r.data,'base64'));
    /* 同时记录首元素与状态栏字色 */
    const info = await ev(`(()=>{const box=document.querySelector('#baseScroll');let f=box?box.firstElementChild:null;if(f&&f.classList.contains('ptr'))f=f.nextElementSibling;const s=getComputedStyle(document.querySelector('.statusbar'));return {first:f?f.tagName+'.'+(f.className||'').split(' ')[0]:'none',color:s.color,sbMode:S.sbMode};})()`);
    console.log(tab, JSON.stringify(info));
  }
  /* 灵动岛确认已删 */
  const notchGone = await ev(`!document.querySelector('.notch')`);
  console.log('notch 已删除:', notchGone);
  console.log('JS 异常:', errs.length ? errs.slice(0,2) : 'none');
  ws.close(); chrome.kill(); process.exit(0);
})().catch(e=>{ console.error('FATAL', e.message); process.exit(1); });
