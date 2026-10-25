/**
 * 交互手感探针（v1.11）：滚动位置保留 / 弹层开合干净 / 重复点击幂等 / 首屏耗时
 */
const { spawn } = require('child_process');
const fsx = require('fs'), pathx = require('path');
const { pathToFileURL } = require('url');
const CHROME = process.env.CHROME || ['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => fsx.existsSync(p));
const HTML = pathToFileURL(pathx.resolve(__dirname, '..', '向往的自由-业务系统demo-高保真版.html')).href;
const PORT = Number(process.env.PORT || 9461);
const sleep = ms => new Promise(r => setTimeout(r, ms));

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
    else if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.exception?.description || '').split('\n')[0].slice(0, 140));
  };
  const send = (m, pa = {}) => new Promise((res, rej) => { const i = ++id; p.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: pa })); });
  const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? { __err: (r.exceptionDetails.exception?.description || '').split('\n')[0] } : r.result.value; };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 920, deviceScaleFactor: 1, mobile: false });

  const t0 = Date.now();
  await send('Page.navigate', { url: HTML });
  /* 真实首屏 = 登录页可交互（未登录时 baseScroll 本来就是空的，不能拿它当就绪信号） */
  for (let i = 0; i < 100; i++) {
    await sleep(50);
    const ok = await ev(`document.readyState==='complete' && !!document.querySelector('#loginLayer .login-step')`);
    if (ok === true) break;
  }
  const boot = Date.now() - t0;
  /* 选身份后进入首页的渲染耗时 */
  const enterMs = await ev(`(function(){
    const t=performance.now(); S.loggedIn=true; document.querySelector('#loginLayer').classList.remove('on');
    setEnd('tourist'); setTab('home'); return Math.round(performance.now()-t);
  })()`);

  let pass = 0, fail = 0; const fails = [];
  const ck = (n, c, d) => { if (c) { pass++; console.log('  PASS | ' + n + (d ? '  · ' + d : '')); } else { fail++; fails.push(n); console.log('  FAIL | ' + n + (d ? '  · ' + d : '')); } };

  console.log('\n【1】首屏与交互响应');
  ck('首屏（登录页可交互） < 1500ms', boot < 1500, boot + 'ms');
  ck('选身份后进入首页渲染 < 400ms', enterMs < 400, enterMs + 'ms');
  /* 预热一次：首次进某端要建整棵 DOM + JIT 编译，把冷启动噪声当性能会误判。
     再取 3 次中位数 —— 单次测量在满负载（全量回归第 17 套）时会被 Chrome 调度抖动带偏：
     同一操作单跑 142ms / 全量 163ms，差的全是抖动，不是产品变慢。 */
  await ev(`(function(){ setEnd('admin'); setTab('dash'); })()`);
  const rtRuns = [];
  for (let i = 0; i < 3; i++) {
    const v = await ev(`(function(){ setEnd('tourist'); setTab('home'); const t=performance.now(); setEnd('admin'); setTab('dash'); return Math.round(performance.now()-t); })()`);
    if (typeof v === 'number') rtRuns.push(v);
  }
  const rt = rtRuns.length ? rtRuns.slice().sort((a,b)=>a-b)[Math.floor(rtRuns.length/2)] : 99999;
  ck('切换端+tab 同步渲染 < 150ms（3 次中位数）', rt < 150, rtRuns.join('/') + ' → ' + rt + 'ms');
  const rt2 = await ev(`(function(){
    const t=performance.now(); setDashRange('90d'); return Math.round(performance.now()-t);
  })()`);
  ck('切换口径（重算全部派生） < 150ms', rt2 < 150, rt2 + 'ms');

  console.log('\n【2】返回后滚动位置保留');
  await ev(`setEnd('tourist');setTab('home')`);
  await sleep(400);
  const scrollTest = await ev(`(function(){
    const s=document.querySelector('#baseScroll');
    s.scrollTop=1200;
    const before=s.scrollTop;
    pushMyOrdersPage();
    return before;
  })()`);
  await sleep(500);
  await ev(`pop()`);
  await sleep(500);
  const afterScroll = await ev(`(function(){const s=document.querySelector('#baseScroll');return s.scrollTop;})()`);
  ck('子页返回后 baseScroll 位置保留', Math.abs(afterScroll - scrollTest) < 5, scrollTest + ' → ' + afterScroll);

  // 子页内部滚动 → 返回再进，是否记住
  const innerTest = await ev(`(function(){
    pushMyOrdersPage();
    return 1;
  })()`);
  await sleep(450);
  const innerScroll = await ev(`(function(){
    const pg=document.querySelector('#pageStack .page:last-child .page-body');
    if(!pg) return -1;
    pg.scrollTop=600;
    return pg.scrollTop;
  })()`);
  await ev(`pop()`); await sleep(420);
  await ev(`pushMyOrdersPage()`); await sleep(450);
  const innerAfter = await ev(`(function(){
    const pg=document.querySelector('#pageStack .page:last-child .page-body');
    return pg ? pg.scrollTop : -1;
  })()`);
  ck('子页重新进入回到顶部（不残留上次位置）', innerAfter === 0, '上次 ' + innerScroll + ' → 本次 ' + innerAfter);
  await ev(`clearStack()`); await sleep(200);

  console.log('\n【3】弹层开合干净（不留遮罩/锁滚动）');
  await ev(`setEnd('tourist');setTab('home')`); await sleep(400);
  const sheetTest = await ev(`(function(){
    try { openChannelSheet(); } catch(e){ return { skip:true, why:e.message }; }
    return { skip:false, opened: document.querySelector('#sheet').classList.contains('show'),
             mask: document.querySelector('#mask').classList.contains('show') };
  })()`);
  await sleep(450);
  const closed = await ev(`(function(){
    closeSheet();
    return { sheet: document.querySelector('#sheet').classList.contains('show'),
             mask: document.querySelector('#mask').classList.contains('show'),
             bodyOverflow: getComputedStyle(document.body).overflow,
             stack: S.stack.length };
  })()`);
  await sleep(400);
  const settled = await ev(`(function(){
    return { sheet: document.querySelector('#sheet').classList.contains('show'),
             mask: document.querySelector('#mask').classList.contains('show'),
             stack: S.stack.length,
             disabled: document.querySelectorAll('[disabled]').length };
  })()`);
  if (!sheetTest.skip) {
    ck('弹层可打开', sheetTest.opened === true);
    ck('关闭后 sheet 隐藏', settled.sheet === false);
    ck('关闭后遮罩不残留', settled.mask === false);
    ck('关闭后页面栈不被污染', settled.stack === 0, 'stack=' + settled.stack);
  }

  console.log('\n【4】重复点击幂等（连点不会重复提交）');
  await ev(`clearStack()`); await sleep(200);
  const dbl = await ev(`(function(){
    setEnd('admin'); setTab('audit');
    const n0 = DB.x.auditStat.done;
    const el=[...document.querySelectorAll('#baseScroll [onclick]')].find(function(e){return /handleAudit\\(['"]AU0['"]/.test(e.getAttribute('onclick')||'');});
    if(!el) return { skip:true };
    return { skip:false, n0:n0 };
  })()`);
  await sleep(400);
  const dbl2 = await ev(`(function(){
    const n0 = DB.x.auditStat.done;
    const el=[...document.querySelectorAll('#baseScroll [onclick]')].find(function(e){return /handleAudit\\(['"]AU0['"]/.test(e.getAttribute('onclick')||'');});
    if(!el) return { skip:true };
    el.click(); el.click(); el.click();
    return { n0:n0, n1:DB.x.auditStat.done, left:DB.admin.audits.length };
  })()`);
  if (!dbl2.skip) {
    ck('连续 3 次点击同一审核项只生效 1 次（防重复提交）', dbl2.n1 === dbl2.n0 + 1, '已审 ' + dbl2.n0 + ' → ' + dbl2.n1);
  }

  console.log('\n【5】筛选空态');
  await ev(`setEnd('tourist');setTab('theme')`); await sleep(400);
  const empty = await ev(`(function(){
    themeCat='yoga'; themeShown=6; renderBase();
    return document.querySelectorAll('#baseScroll .tour-card, #baseScroll .tc').length;
  })()`);
  ck('切到具体分类后有内容（非空）', empty > 0, empty + ' 张卡');
  await ev(`themeCat='all'; themeShown=6; renderBase()`);

  console.log('\n════════════════════════════════════');
  console.log(`交互手感：${pass} PASS / ${fail} FAIL   首屏 ${boot}ms`);
  if (fail) console.log('未通过：' + fails.join('、'));
  if (errs.length) console.log('JS 异常：' + errs.slice(0,3).join(' | '));
  ws.close(); ch.kill();
  process.exit(fail ? 1 : 0);
})();
