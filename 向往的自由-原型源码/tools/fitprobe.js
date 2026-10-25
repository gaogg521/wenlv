/* v1.9.1 验证：①旅豆三层闭环三卡片跳转 ②演示模式自适应（大窗开启 / 工具视口不触发） */
const { spawn } = require('child_process');
const fs = require('fs'); const pathx = require('path'); const { pathToFileURL } = require('url');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p)) || 'chrome';
const ROOT = pathx.resolve(__dirname, '..');
const HTML = pathToFileURL(pathx.join(ROOT, '向往的自由-业务系统demo-高保真版.html')).href;
const PORT = Number(process.env.PORT || 9462);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let PASS = 0, FAIL = 0;
function ck(name, cond, extra){ if(cond){ PASS++; console.log('  PASS  ' + name + (extra ? '  ' + extra : '')); } else { FAIL++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')); } }
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
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:430,height:920,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:HTML}); await sleep(2400);
  await ev(`S.loggedIn=true;document.querySelector('#loginLayer').classList.remove('on')`); await sleep(300);

  console.log('\n【1】工具视口 430×920：演示模式不得触发（保证自动化零影响）');
  const a = await ev(`(function(){var s=document.getElementById('stage'),b=document.getElementById('fitBtn');return {tr:s.style.transform, mb:s.style.marginBottom, disp:b.style.display, cls:document.body.className, vw:window.innerWidth};})()`);
  ck('430 视口下 stage 无缩放', a.tr === '', 'transform="' + a.tr + '"');
  ck('430 视口下无负外距补偿', a.mb === '', 'marginBottom="' + a.mb + '"');
  ck('430 视口下演示按钮隐藏', a.disp === 'none', 'display=' + a.disp);

  console.log('\n【2】大窗口 1600×900：自动等比缩放铺满一屏');
  await send('Emulation.setDeviceMetricsOverride',{width:1600,height:900,deviceScaleFactor:1,mobile:false});
  await ev(`fitStage()`); await sleep(400);
  const b = await ev(`(function(){var s=document.getElementById('stage'),btn=document.getElementById('fitBtn');var m=/scale\\(([\\d.]+)\\)/.exec(s.style.transform||'');var s2=m?parseFloat(m[1]):0;var W=s.offsetWidth,H=s.offsetHeight;var exp=Math.min((window.innerWidth-40)/W,(window.innerHeight-40)/H);return {s:s2, exp:exp, mb:s.style.marginBottom, disp:btn.style.display, txt:document.getElementById('fitBtnTxt').textContent, bodyCls:document.body.className, scrollH:document.documentElement.scrollHeight, winH:window.innerHeight};})()`);
  ck('缩放系数 = min(宽适配, 高适配)', Math.abs(b.s - b.exp) < 0.01, 'scale=' + b.s.toFixed(3) + ' · 期望 ' + b.exp.toFixed(3));
  ck('缩放后整页高度 ≤ 视口高度（免上下滚动）', b.scrollH <= b.winH + 2, 'scrollHeight=' + b.scrollH + ' · innerHeight=' + b.winH);
  ck('大窗口下按钮显示且文案为「退出演示模式」', b.disp === 'inline-flex' && b.txt === '退出演示模式', 'display=' + b.disp + ' · ' + b.txt);
  ck('body 带 fit-on 类', /fit-on/.test(b.bodyCls), b.bodyCls);

  console.log('\n【3】手动退出 → 恢复原尺寸且可再开');
  await ev(`toggleFit()`); await sleep(300);
  const c = await ev(`(function(){var s=document.getElementById('stage');return {tr:s.style.transform, mb:s.style.marginBottom, txt:document.getElementById('fitBtnTxt').textContent, ls:(function(){try{return localStorage.getItem('wf-demo-fit-off');}catch(e){return 'err';}})()};})()`);
  ck('退出后缩放清除', c.tr === '', 'transform="' + c.tr + '"');
  ck('退出后外距补偿清除', c.mb === '', 'marginBottom="' + c.mb + '"');
  ck('退出状态写入 localStorage', c.ls === '1', 'wf-demo-fit-off=' + c.ls);
  ck('按钮文案变为「演示模式」（可再开）', c.txt === '演示模式', c.txt);
  await ev(`toggleFit()`); await sleep(300);
  const c2 = await ev(`(function(){var s=document.getElementById('stage');return {tr:s.style.transform, ls:(function(){try{return localStorage.getItem('wf-demo-fit-off');}catch(e){return 'err';}})()};})()`);
  ck('再开启后恢复缩放且状态清零', /scale/.test(c2.tr) && c2.ls === '0', 'transform=' + c2.tr + ' · ls=' + c2.ls);

  console.log('\n【4】小窗口回退：拉小到 900×600 应保持退出态不缩放');
  await ev(`toggleFit()`); await sleep(250);   /* 先确保处于「已手动退出」态 */
  await send('Emulation.setDeviceMetricsOverride',{width:900,height:600,deviceScaleFactor:1,mobile:false});
  await ev(`fitStage()`); await sleep(300);
  const d = await ev(`(function(){var s=document.getElementById('stage');return {tr:s.style.transform, disp:document.getElementById('fitBtn').style.display, ls:(function(){try{return localStorage.getItem('wf-demo-fit-off');}catch(e){return 'err';}})()};})()`);
  ck('900×600 且已手动退出 → 不缩放', d.tr === '', 'transform="' + d.tr + '"');
  ck('按钮仍显示（退出态记忆，可再开）', d.disp === 'inline-flex' && d.ls === '1', 'display=' + d.disp + ' · ls=' + d.ls);

  console.log('\n【5】旅豆三层闭环三卡片 → 闭环详情（断链修复）');
  await send('Emulation.setDeviceMetricsOverride',{width:430,height:920,deviceScaleFactor:1,mobile:false});
  await ev(`setEnd('tourist');setTab('web3');pushWeb3Page()`); await sleep(900);
  const dom0 = await ev(`(function(){var t=document.body.innerText;return {card:t.indexOf('旅豆三层闭环')>=0, c:t.indexOf('C 端复购环')>=0, jump:t.indexOf('查看闭环')>=0};})()`);
  ck('Web3 页渲染「旅豆三层闭环」卡片与跳转提示', dom0.card && dom0.c && dom0.jump, JSON.stringify(dom0));
  await ev(`(function(){var cards=document.querySelectorAll('.loop-jump');cards[0].click();return cards.length;})()`); await sleep(700);
  const j1 = await ev(`(function(){var p=document.querySelector('#pageStack .page:last-child');return {tab:beanLoopTab, title:p?p.querySelector('.nav-title')?p.querySelector('.nav-title').textContent:'':'', hasRing:!!(p&&p.querySelector('.bean-ring')), txt:p?p.textContent.indexOf('C 端 · 消费者复购环')>=0:false};})()`);
  ck('点 C 端卡 → 打开闭环详情且定位 C tab', j1.tab === 'c' && j1.hasRing && j1.txt, JSON.stringify(j1));
  await ev(`pop()`); await sleep(400);
  await ev(`(function(){var cards=document.querySelectorAll('.loop-jump');cards[1].click();return 1;})()`); await sleep(700);
  const j2 = await ev(`(function(){var p=document.querySelector('#pageStack .page:last-child');return {tab:beanLoopTab, txt:p?p.textContent.indexOf('B 端 · 商家供给环')>=0:false};})()`);
  ck('点 B 端卡 → 打开闭环详情且定位 B tab', j2.tab === 'b' && j2.txt, JSON.stringify(j2));
  await ev(`pop()`); await sleep(400);
  await ev(`(function(){var cards=document.querySelectorAll('.loop-jump');cards[2].click();return 1;})()`); await sleep(700);
  const j3 = await ev(`(function(){var p=document.querySelector('#pageStack .page:last-child');return {tab:beanLoopTab, txt:p?p.textContent.indexOf('底部 · 荣誉激励层')>=0:false};})()`);
  ck('点荣誉层卡 → 打开闭环详情且定位 H tab', j3.tab === 'h' && j3.txt, JSON.stringify(j3));
  const seg = await ev(`(function(){var p=document.querySelector('#pageStack .page:last-child');return {n:p.querySelectorAll('.lseg').length, on:p.querySelector('.lseg.on')?p.querySelector('.lseg.on').textContent:''};})()`);
  ck('详情页三 tab 切换器正常且当前 tab 高亮', seg.n === 3 && /底部|荣誉/.test(seg.on), JSON.stringify(seg));

  console.log('\n────────────────────────');
  console.log('演示模式与闭环跳转探针：PASS ' + PASS + ' / FAIL ' + FAIL);
  ws.close(); chrome.kill(); process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
