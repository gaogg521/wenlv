/* v1.9 事前预警截图：运营端权益页预测区块 + 风控 tab 预警卡 + 协议生效后回落 */
const { spawn } = require('child_process');
const fs = require('fs');
const pathx = require('path');
const { pathToFileURL } = require('url');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p)) || 'chrome';
const ROOT = pathx.resolve(__dirname, '..');
const HTML = pathToFileURL(pathx.join(ROOT, '向往的自由-业务系统demo-高保真版.html')).href;
const OUT = pathx.join(ROOT, 'shots_tabs');
const PORT = Number(process.env.PORT || 9384);
const sleep = ms => new Promise(r => setTimeout(r, ms));
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const chrome = spawn(CHROME, ['--headless=new','--disable-gpu','--no-sandbox',`--remote-debugging-port=${PORT}`,'about:blank'], { stdio:'ignore' });
  let t = null;
  for (let i = 0; i < 40; i++) { await sleep(250); try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); t = await r.json(); if (t.find(x => x.type === 'page')) break; } catch(e){} }
  const ws = new WebSocket(t.find(x => x.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
  const send = (m, p={}) => new Promise((res, rej) => { const i = ++id; pend.set(i, {res, rej}); ws.send(JSON.stringify({id:i, method:m, params:p})); });
  const ev = async x => { const r = await send('Runtime.evaluate', { expression:x, returnByValue:true, awaitPromise:true }); return r.exceptionDetails ? {__err:(r.exceptionDetails.exception&&r.exceptionDetails.exception.description||r.exceptionDetails.text)} : r.result.value; };
  const shot = async name => {
    const r = await send('Page.captureScreenshot', { format:'png' });
    fs.writeFileSync(pathx.join(OUT, name), Buffer.from(r.data, 'base64'));
    console.log('saved ' + name);
  };
  const to = async sel => { await ev(`(function(){var p=document.querySelector('#pageStack .page:last-child');var el=p&&p.querySelector('${sel}');if(el)el.scrollIntoView({block:'start'});return el?1:0;})()`); await sleep(650); };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:430,height:920,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:HTML}); await sleep(2400);
  await ev(`S.loggedIn=true;document.querySelector('#loginLayer').classList.remove('on')`); await sleep(300);
  await ev(`setEnd('admin');resetDemo()`); await sleep(500);

  // 1. 运营端权益页：预警灯 + 周节奏 + 关键数字
  await ev(`pushRightsPage()`); await sleep(900);
  await to('.fc-alert');
  await shot('v19-1-admin-forecast-alert.png');

  // 2. 见底日 + 三个建议动作
  await to('.fc-card');
  await shot('v19-2-admin-forecast-numbers.png');
  await to('.fc-acts');
  await shot('v19-3-admin-forecast-actions.png');

  // 3. 协议变更生效后：预测回落
  await ev(`(function(){var i=DB.rights.contracts.findIndex(c=>c.st==='待审批');agrApprove(i);return i;})()`); await sleep(900);
  await to('.fc-alert');
  await shot('v19-4-admin-forecast-after-agree.png');

  // 4. 风控 tab 顶部的预警卡（驾驶舱入口）
  await ev(`clearStack();setTab('risk')`); await sleep(900);
  await shot('v19-5-admin-risk-tab-alert.png');

  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
