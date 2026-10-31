// 量各端各 tab 的实际内容高度，评估扩容后的演示缩放影响
const { spawn } = require('child_process');
const fsx = require('fs'), pathx = require('path');
const { pathToFileURL } = require('url');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => fsx.existsSync(p));
const HTML = pathToFileURL(pathx.resolve(__dirname, '..', '向往的自由-业务系统demo-高保真版.html')).href;
const PORT = Number(process.env.PORT || 9431);
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const ch = spawn(CHROME, ['--headless=new','--disable-gpu','--no-sandbox','--remote-debugging-port='+PORT,'about:blank'], { stdio:'ignore' });
  let t = null;
  for (let i = 0; i < 40; i++) { await sleep(250); try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); t = await r.json(); if (t.find(x => x.type === 'page')) break; } catch (e) {} }
  const ws = new WebSocket(t.find(x => x.type === 'page').webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const p = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { const q = p.get(m.id); p.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result); } };
  const send = (m, pa = {}) => new Promise((res, rej) => { const i = ++id; p.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: pa })); });
  const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? { __err: r.exceptionDetails.exception?.description } : r.result.value; };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 920, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: HTML }); await sleep(2400);
  await ev(`S.loggedIn=true;document.querySelector('#loginLayer').classList.remove('on')`);

  const tabs = { tourist:['home','theme','shop','wallet','me'], merch:['work','order','supply','mme'], admin:['dash','risk','audit','calc','ame'] };
  const out = [];
  for (const end of Object.keys(tabs)) {
    for (const tab of tabs[end]) {
      await ev(`setEnd('${end}');setTab('${tab}')`);
      await sleep(420);
      const h = await ev(`(function(){const s=document.querySelector('#baseScroll');return s?Math.round(s.scrollHeight):0;})()`);
      out.push({ end, tab, h });
    }
  }
  const max = Math.max(...out.map(x => x.h));
  const scale = Math.min(1, (820 - 40) / max);
  out.forEach(x => {
    const flag = x.h > 900 ? ' ← 超一屏' : '';
    console.log(`${(x.end+'/'+x.tab).padEnd(20)} ${String(x.h).padStart(5)}px${flag}`);
  });
  console.log(`\n最高 ${max}px  → 900 高窗口下演示缩放 ${scale.toFixed(3)}（当前实测约 0.93）`);
  ws.close(); ch.kill();
})();
