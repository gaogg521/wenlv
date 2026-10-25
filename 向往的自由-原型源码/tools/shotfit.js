/* v1.9.1 演示模式效果截图：大窗口下一屏看全、无滚动 */
const { spawn } = require('child_process');
const fs = require('fs'); const pathx = require('path'); const { pathToFileURL } = require('url');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p)) || 'chrome';
const ROOT = pathx.resolve(__dirname, '..');
const HTML = pathToFileURL(pathx.join(ROOT, '向往的自由-业务系统demo-高保真版.html')).href;
const OUT = pathx.join(ROOT, 'shots_tabs');
const PORT = Number(process.env.PORT || 9385);
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
  const shot = async name => { const r = await send('Page.captureScreenshot', { format:'png' }); fs.writeFileSync(pathx.join(OUT, name), Buffer.from(r.data, 'base64')); console.log('saved ' + name); };
  await send('Page.enable'); await send('Runtime.enable');

  /* 模拟用户显示器：1600×900，fit 模式自动开启 */
  await send('Emulation.setDeviceMetricsOverride',{width:1600,height:900,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:HTML}); await sleep(2600);
  await ev(`S.loggedIn=true;document.querySelector('#loginLayer').classList.remove('on')`); await sleep(300);
  await ev(`setEnd('tourist')`); await sleep(500);
  await ev(`fitStage()`); await sleep(500);
  const st = await ev(`(function(){return {tr:document.getElementById('stage').style.transform, scrollH:document.documentElement.scrollHeight, winH:window.innerHeight};})()`);
  console.log('fit 状态:', JSON.stringify(st));
  await shot('v191-1-fit-fullscreen.png');

  /* Web3 页：旅豆三层闭环卡片 + 点开后的闭环详情（Web3 为首页 chip 推入的子页，非 tab） */
  await ev(`setEnd('tourist');setTab('home');pushWeb3Page()`); await sleep(900);
  await shot('v191-2-web3-bean-loop-card.png');
  await ev(`(function(){var cards=document.querySelectorAll('.loop-jump');if(cards.length)cards[0].click();return cards.length;})()`); await sleep(900);
  await shot('v191-3-bean-loop-detail.png');

  ws.close(); chrome.kill(); process.exit(0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
