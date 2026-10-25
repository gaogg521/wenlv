// 互动体验体检 v1：可点性 + 反馈性
// 用法：node tools/touchprobe.js [--list]
//   --list  只输出不可点元素清单，不做点击反馈测试（快）
const { spawn } = require('child_process');
const fsx = require('fs'), pathx = require('path');
const { pathToFileURL } = require('url');
const CHROME = process.env.CHROME || ['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => fsx.existsSync(p));
const HTML = pathToFileURL(pathx.resolve(__dirname, '..', '向往的自由-业务系统demo-高保真版.html')).href;
const PORT = Number(process.env.PORT || 9441);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const LIST_ONLY = process.argv.includes('--list');

const TABS = {
  tourist: ['home','theme','shop','wallet','me'],
  merch:   ['work','order','supply','mme'],
  admin:   ['dash','risk','audit','calc','ame'],
};

(async () => {
  const ch = spawn(CHROME, ['--headless=new','--disable-gpu','--no-sandbox','--remote-debugging-port='+PORT,'about:blank'], { stdio:'ignore' });
  let t = null;
  for (let i = 0; i < 40; i++) { await sleep(250); try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); t = await r.json(); if (t.find(x => x.type === 'page')) break; } catch (e) {} }
  const ws = new WebSocket(t.find(x => x.type === 'page').webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0; const p = new Map(); const errs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && p.has(m.id)) { const q = p.get(m.id); p.delete(m.id); m.error ? q.rej(new Error(JSON.stringify(m.error))) : q.res(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.exception?.description || '').split('\n')[0].slice(0, 120));
  };
  const send = (m, pa = {}) => new Promise((res, rej) => { const i = ++id; p.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: pa })); });
  const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? { __err: (r.exceptionDetails.exception?.description||'').split('\n')[0] } : r.result.value; };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 920, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: HTML }); await sleep(2400);
  await ev(`S.loggedIn=true;document.querySelector('#loginLayer').classList.remove('on')`);

  // ── 采集当前视图内所有带 onclick 的元素及其可点性 ──
  const SCAN = `(function(){
    const root = document.querySelector('#baseScroll') || document.body;
    const all = [...document.querySelectorAll('#baseScroll [onclick], #tabBar [onclick]')];
    const out = [];
    all.forEach(function(e, i){
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      let reason = '';
      if (r.width < 2 || r.height < 2) reason = '零尺寸';
      else if (cs.visibility === 'hidden') reason = 'visibility:hidden';
      else if (cs.pointerEvents === 'none') reason = 'pointer-events:none';
      else if (cs.opacity === '0') reason = 'opacity:0';
      if (!reason) {
        // 滚到视野内再测遮挡（不要滚动，用元素当前中心点；若在视口外则记录为「需滚动」）
        e.scrollIntoView({ block: 'center', inline: 'nearest' });
        const r2 = e.getBoundingClientRect();
        const x = r2.x + r2.width / 2, y = r2.y + r2.height / 2;
        if (y < 0 || y > innerHeight || x < 0 || x > innerWidth) reason = '滚不到视口内';
        else {
          const top = document.elementFromPoint(x, y);
          if (!top) reason = 'elementFromPoint=null';
          else if (!(e.contains(top) || top.contains(e))) {
            const tc = (top.className || '').toString();
            reason = '被遮挡:' + top.tagName.toLowerCase() + (tc ? '.' + tc.split(' ')[0] : '');
          }
        }
      }
      out.push({ i: i, txt: (e.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 26),
                 oc: (e.getAttribute('onclick') || '').slice(0, 60),
                 cls: (e.className || '').toString().slice(0, 30),
                 /* 已激活态（当前 tab / 已选 chip）：点它本应毫无反应，测它只会产生假哑点 */
                 on: e.classList.contains('on'),
                 w: Math.round(r.width), h: Math.round(r.height), reason: reason });
    });
    return out;
  })()`;

  const bad = []; let total = 0;
  for (const end of Object.keys(TABS)) {
    for (const tab of TABS[end]) {
      await ev(`setEnd('${end}');setTab('${tab}')`);
      await sleep(420);
      const items = await ev(SCAN);
      if (!Array.isArray(items)) { console.log(`${end}/${tab} 扫描失败`, JSON.stringify(items)); continue; }
      total += items.length;
      const miss = items.filter(x => x.reason);
      miss.forEach(x => bad.push(Object.assign({ end, tab }, x)));
      console.log(`${(end + '/' + tab).padEnd(18)} 可点元素 ${String(items.length).padStart(3)} · 不可点 ${String(miss.length).padStart(2)}`);
      await ev(`(function(){const s=document.querySelector('#baseScroll');if(s)s.scrollTop=0;})()`);
    }
  }

  console.log(`\n合计 ${total} 个可点元素，其中 ${bad.length} 个不可点（${(bad.length/total*100).toFixed(1)}%）`);
  if (bad.length) {
    console.log('\n──── 不可点清单 ────');
    bad.forEach(x => console.log(`  [${x.end}/${x.tab}] ${x.reason.padEnd(22)} ${String(x.w)+'x'+x.h}  "${x.txt}"  <${x.cls}>  ${x.oc}`));
  }
  if (errs.length) console.log('\nJS 异常：\n  ' + errs.slice(0, 8).join('\n  '));

  if (!LIST_ONLY) {
    // ── 反馈性测试：逐个点击，检测是否有任何可见变化 ──
    console.log('\n════════ 反馈性测试（点击后是否有可见反应）════════');
    const FP = `(function(){
      const sheet=document.querySelector('#sheet'), dlg=document.querySelector('#dialog');
      const toastEl=document.querySelector('#toast');
      return {
        stack: S.stack.length,
        end: S.end, tab: (S.tab||{})[S.end] || '',
        len: (document.querySelector('#baseScroll')||{innerHTML:''}).innerHTML.length,
        sheet: !!(sheet && sheet.classList.contains('show')),
        dlg: !!(dlg && dlg.classList.contains('show')),
        toast: !!(toastEl && (toastEl.classList.contains('on')||toastEl.classList.contains('show')) && (toastEl.textContent||'').trim().length>0),
        url: location.href
      };
    })()`;
    const RESET = `(function(){
      ['sheet','dialog'].forEach(function(k){var e=document.getElementById(k);if(e){e.style.transition='none';e.classList.remove('show');}});
      var mk=document.getElementById('mask'); if(mk) mk.classList.remove('show');
      while(S.stack.length) S.stack.pop();
      var ps=document.querySelector('#pageStack'); if(ps) ps.innerHTML='';
      var tEl=document.querySelector('#toast'); if(tEl){tEl.classList.remove('on');tEl.classList.remove('show');}
    })()`;

    let silent = [], tested = 0, skipped = 0;
    for (const end of Object.keys(TABS)) {
      for (const tab of TABS[end]) {
        await ev(`setEnd('${end}');setTab('${tab}')`);
        await sleep(400);
        const items = await ev(SCAN);
        if (!Array.isArray(items)) continue;
        // 只测可点、带 onclick、且不在激活态的元素
        // 已激活的 tab / chip 点它本来就该没反应 —— 那不是哑点击，是正确行为
        const targets = items.filter(x => !x.reason && x.oc && !x.on);
        skipped += items.filter(x => !x.reason && x.oc && x.on).length;
        let localSilent = 0;
        for (let k = 0; k < targets.length; k++) {
          await ev(RESET);
          await ev(`setEnd('${end}');setTab('${tab}')`);
          await sleep(120);
          // 每次重置后按文本 + onclick 重新定位，避免索引漂移
          const found = await ev(`(function(){
            const t=${JSON.stringify(targets[k].txt)}, o=${JSON.stringify(targets[k].oc)};
            const els=[...document.querySelectorAll('#baseScroll [onclick], #tabBar [onclick]')];
            let e=els.find(function(x){return (x.getAttribute('onclick')||'').slice(0,60)===o && (x.textContent||'').trim().replace(/\\s+/g,' ').slice(0,26)===t;});
            if(!e) return null;
            e.scrollIntoView({block:'center'});
            const r=e.getBoundingClientRect();
            return r.width>2 && r.height>2 ? {x:r.x+r.width/2, y:r.y+r.height/2} : null;
          })()`);
          if (!found) continue;
          const before = await ev(FP);
          await send('Input.dispatchMouseEvent', { type:'mousePressed', x: found.x, y: found.y, button:'left', clickCount:1 });
          await send('Input.dispatchMouseEvent', { type:'mouseReleased', x: found.x, y: found.y, button:'left', clickCount:1 });
          await sleep(320);
          const after = await ev(FP);
          tested++;
          const changed = before.stack !== after.stack || before.sheet !== after.sheet ||
                          before.dlg !== after.dlg || before.toast === false && after.toast === true ||
                          Math.abs(before.len - after.len) > 8 || before.url !== after.url ||
                          before.tab !== after.tab || before.end !== after.end;
          if (!changed) { silent.push({ end, tab, txt: targets[k].txt, oc: targets[k].oc, cls: targets[k].cls }); localSilent++; }
          // 点出了跳转要复位
          if (after.url !== before.url) { await send('Page.navigate', { url: HTML }); await sleep(1600); await ev(`S.loggedIn=true;document.querySelector('#loginLayer').classList.remove('on')`); }
        }
        console.log(`${(end+'/'+tab).padEnd(18)} 测 ${String(targets.length).padStart(3)} · 无反馈 ${String(localSilent).padStart(2)}`);
      }
    }
    console.log(`\n合计测试 ${tested} 次点击，哑点击 ${silent.length} 个（${(silent.length/Math.max(tested,1)*100).toFixed(1)}%）`);
    console.log(`已激活态跳过 ${skipped} 个（当前 tab / 已选 chip —— 点它无反应才是对的）`);
    if (silent.length) {
      console.log('\n──── 哑点击清单（点了没反应）────');
      silent.forEach(x => console.log(`  [${x.end}/${x.tab}] "${x.txt}"  <${x.cls}>  ${x.oc}`));
    }
  }

  ws.close(); ch.kill();
})();
