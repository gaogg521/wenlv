// 覆盖层体检：点开每一处可点元素，凡是「盖住屏幕 ≥60% 的面」，检查左上角有没有可用的返回/关闭
const { spawn } = require('child_process');
const path = require('path'); const net = require('net');
const HTML = 'file:///' + path.resolve(__dirname, '..', '向往的自由-业务系统demo-高保真版.html').replace(/\\/g, '/');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TABS = { tourist: ['home', 'theme', 'shop', 'wallet', 'me'], merch: ['work', 'order', 'supply', 'mme'], admin: ['dash', 'risk', 'audit', 'calc', 'ame'] };

function freePort() { return new Promise(res => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); }); }

(async () => {
  const port = await freePort();
  const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',
    ['--headless=new', '--remote-debugging-port=' + port, '--disable-gpu', '--window-size=1440,900',
     '--no-first-run', '--user-data-dir=' + path.join(__dirname, '_cdp_ov2'), 'about:blank'], { stdio: 'ignore' });
  let list = null;
  for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://127.0.0.1:${port}/json/list`); list = await r.json(); if (list.length) break; } catch (e) {} await sleep(250); }
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const waits = new Map();
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && waits.has(m.id)) { waits.get(m.id)(m); waits.delete(m.id); } });
  const send = (m, p) => new Promise(r => { const i = ++id; waits.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p || {} })); });
  const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.result && r.result.result ? r.result.result.value : null; };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: HTML }); await sleep(1500);
  await ev(`S.loggedIn=true;var l=document.querySelector('#loginLayer');if(l)l.classList.remove('on');renderBase();1`);

  const RESET = `(function(){
    ['sheet','dialog'].forEach(function(k){var e=document.getElementById(k);if(e){e.style.transition='none';e.classList.remove('show');e.innerHTML='';}});
    var mk=document.getElementById('mask'); if(mk) mk.classList.remove('show');
    while(S.stack.length) S.stack.pop();
    var ps=document.querySelector('#pageStack'); if(ps) ps.innerHTML='';
    if(typeof closeShareSheet==='function'){}
  })()`;

  // 采集：屏幕上一个「面」有没有左上角返回/关闭
  const PROBE = `(function(){
    var sheet=document.getElementById('sheet'), dlg=document.getElementById('dialog');
    var sc=document.querySelector('.phone-screen').getBoundingClientRect();
    function cover(el){ if(!el) return 0; var r=el.getBoundingClientRect(); if(r.height<10) return 0; return Math.min(1, r.height/sc.height); }
    var st=document.querySelector('#pageStack .page:last-child');
    var kind = st? 'page' : (sheet && sheet.classList.contains('show') ? 'sheet' : (dlg && dlg.classList.contains('show') ? 'dialog' : 'none'));
    var host = kind==='page'? st : (kind==='sheet'? sheet : (kind==='dialog'? dlg : null));
    var cov = kind==='page'? 1 : (kind==='none'?0:0.9);
    if(!host) return {kind:kind, cov:0};
    // 左上角区域（相对屏幕）内的可点元素
    var cx = sc.x + 60, cy = sc.y + 100;
    var cands=[].slice.call(host.querySelectorAll('[onclick]')).filter(function(e){
      var r=e.getBoundingClientRect();
      return r.width>10 && r.height>10 && r.x < cx && r.y < cy && r.bottom > sc.y+40;
    });
    var names = cands.map(function(e){return ((e.className||'').toString().split(' ')[0]||e.tagName)+':'+((e.getAttribute('onclick')||'').slice(0,22));});
    return {kind:kind, cov:cov, has:cands.length, names:names.slice(0,3)};
  })()`;

  const bad = [];
  for (const end of Object.keys(TABS)) {
    for (const tab of TABS[end]) {
      await ev(RESET);
      await ev(`S.end='${end}';S.tab['${end}']='${tab}';renderBase();1`);
      await sleep(320);
      const n = await ev(`(function(){var root=document.querySelector('#baseScroll')||document.querySelector('.page-body');var a=[].slice.call(root.querySelectorAll('[onclick]'));return a.length;})()`);
      for (let k = 0; k < Math.min(n, 40); k++) {
        await ev(RESET);
        await ev(`S.end='${end}';S.tab['${end}']='${tab}';renderBase();1`);
        await sleep(140);
        const pt = await ev(`(function(){
          var root=document.querySelector('#baseScroll')||document.querySelector('.page-body');
          var a=[].slice.call(root.querySelectorAll('[onclick]'));var e=a[${k}]; if(!e)return null;
          e.scrollIntoView({block:'center'});
          var r=e.getBoundingClientRect(); if(r.width<8||r.height<8) return null;
          return {x:r.x+r.width/2,y:r.y+r.height/2,oc:(e.getAttribute('onclick')||'').slice(0,26)};
        })()`);
        if (!pt || !pt.x) continue;
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
        await sleep(300);
        const r = await ev(PROBE);
        if (r && r.cov >= 0.6 && r.kind !== 'none' && !r.has) {
          bad.push({ end, tab, oc: pt.oc, kind: r.kind, cov: r.cov });
        }
      }
    }
  }

  // 去重
  const seen = new Set(), uniq = [];
  bad.forEach(b => { const k = b.end + b.tab + b.oc; if (!seen.has(k)) { seen.add(k); uniq.push(b); } });
  console.log(`\n覆盖层左上角缺返回/关闭：${uniq.length} 处`);
  uniq.forEach(b => console.log(`  [${b.end}/${b.tab}] ${b.oc}  → ${b.kind}`));
  ws.close(); ch.kill();
})();
