/* v1.8 成本控制闭环截图：运营端超支审批/协议变更 + 商户端协议变更申请 */
const { spawn } = require('child_process');
const fs = require('fs');
const pathx = require('path');
const { pathToFileURL } = require('url');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p)) || 'chrome';
const ROOT = pathx.resolve(__dirname, '..');
const HTML = pathToFileURL(pathx.join(ROOT, '向往的自由-业务系统demo-高保真版.html')).href;
const OUT = pathx.join(ROOT, 'shots_tabs');
const PORT = Number(process.env.PORT || 9383);
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
    const f = pathx.join(OUT, name);
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    console.log('saved ' + name);
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width:430, height:1000, deviceScaleFactor:1, mobile:false });
  await send('Page.navigate', { url:HTML }); await sleep(2400);
  await ev(`S.loggedIn=true;S.loginStep='role';document.querySelector('#loginLayer').classList.remove('on')`); await sleep(300);

  // 1. 运营端权益结算页（初始：超支 + 熔断 + 待审批）
  await ev(`clearStack();setEnd('admin');pushRightsPage()`); await sleep(1200);
  await shot('v18-1-admin-rights-overrun.png');

  // 2. 滚到分级授权 + 审批单
  await ev(`(function(){var el=document.querySelector('.ovs-grade');if(el)el.scrollIntoView({block:'center'});return el?1:0;})()`); await sleep(800);
  await shot('v18-2-admin-approval-chain.png');

  // 3. 滚到协议变更审批区
  await ev(`(function(){var el=document.querySelector('.ovs-card.agr');if(el)el.scrollIntoView({block:'center'});return el?1:0;})()`); await sleep(800);
  await shot('v18-3-admin-contract-change.png');

  // 4. 批准协议变更后的成本回落
  await ev(`(function(){var i=DB.rights.contracts.findIndex(function(c){return c.st==='待审批';});if(i>=0)agrApprove(i);return i;})()`); await sleep(1000);
  await ev(`(function(){var f=document.querySelector('.ovs-fuse');if(f)f.scrollIntoView({block:'center'});return 1;})()`); await sleep(800);
  await shot('v18-4-admin-cost-recomputed.png');

  // 5. 商户端协议变更申请
  await ev(`clearStack();setEnd('merch');pushContractChangePage()`); await sleep(1200);
  await shot('v18-5-merch-contract-apply.png');

  // 6. 商户端发起表单
  await ev(`agrSheet()`); await sleep(700);
  await shot('v18-6-merch-sheet.png');

  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });