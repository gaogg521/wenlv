/**
 * 支付链路端到端走查（v1.3新增）
 * 验证：下单 → 支付 → 支付成功弹层 → 落地订单详情 → 可返回，全程不切换身份
 * 用法：node tools/paytrace.js
 */
const { spawn } = require('child_process');
const fs = require('fs'), fsx = require('fs');
const pathx = require('path');
const { pathToFileURL } = require('url');
const CHROME = process.env.CHROME || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find(p => fsx.existsSync(p)) || 'chrome';
const ROOT = pathx.resolve(__dirname, '..');
const HTML = process.env.HTML || pathToFileURL(pathx.join(ROOT, '向往的自由-业务系统demo-高保真版.html')).href;
const OUT = process.env.OUT || pathx.join(ROOT, 'shots_pay');
const PORT = Number(process.env.PORT || 9395);
const sleep = ms => new Promise(r => setTimeout(r, ms));
if (!fsx.existsSync(OUT)) fsx.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
}
(async () => {
  /* 轮询等待：页面栈动画 + setTimeout 链路较长，固定 sleep 易竞态 */
  const waitFor = async (expr, want, timeout = 3000) => {
    const t0 = Date.now();
    let last = '';
    while (Date.now() - t0 < timeout) {
      last = await ev(expr);
      if (last === want) return last;
      await sleep(200);
    }
    return last;
  };
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${PORT}`, 'about:blank'], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); t = await r.json(); if (t.find(x => x.type === 'page')) break; } catch (e) {}
  }
  const ws = new WebSocket(t.find(x => x.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map(); const errs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').slice(0, 300));
  };
  const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? { __err: (r.exceptionDetails.exception?.description || r.exceptionDetails.text) } : r.result.value; };
  const shot = async name => {
    const c = await ev(`(()=>{const r=document.querySelector('#screen').getBoundingClientRect();return {x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)};})()`);
    const r = await send('Page.captureScreenshot', { format: 'png', clip: { ...c, scale: 2 }, captureBeyondViewport: true });
    fs.writeFileSync(pathx.join(OUT, name + '.png'), Buffer.from(r.data, 'base64'));
  };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 920, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: HTML }); await sleep(2200);
  await ev(`S.loggedIn=true;S.loginStep='role';document.querySelector('#loginLayer').classList.remove('on')`);
  await sleep(300);
  await ev(`setEnd('tourist');setTab('theme')`); await sleep(600);

  console.log('\n【1】进入线路详情并下单');
  await ev(`pushTourDetail(1)`); await sleep(600);
  await ev(`openBuySheet(1)`); await sleep(500);
  const walletBefore = await ev(`DB.wallet`);
  ok(await ev(`!!document.querySelector('#sheet .sheet-title')`), '下单表单弹出');

  console.log('\n【2】支付');
  await ev(`payOrder(1)`); await sleep(700);
  ok(await ev(`!!document.querySelector('.spinner')`), '支付中 loading 出现');
  await sleep(1600);
  ok(await ev(`/支付成功/.test(document.querySelector('#sheet').textContent)`), '支付成功弹层出现');
  ok(await ev(`!!document.querySelector('#linkLog .ll-row')`), '四端联动回执渲染');
  await shot('p1-pay-ok');
  const walletAfter = await ev(`DB.wallet`);
  ok(walletAfter > walletBefore, `旅豆到账 ${walletBefore} → ${walletAfter}`);

  console.log('\n【3】关键回归：不得自动切端');
  const endNow = await ev(`S.end`);
  ok(endNow === 'tourist', '支付成功仍停留在游客端', '实际 end=' + endNow);

  console.log('\n【4】查看收益去向面板');
  await ev(`viewEarnImpact()`); await sleep(500);
  ok(await ev(`/这单 ¥/.test(document.querySelector('#sheet').textContent)`), '收益去向面板打开');
  const splitOk = await ev(`(()=>{const s=document.querySelector('#impactLog');return s?/\\[游客端\\]/.test(s.textContent)&&/\\[合伙人端\\]/.test(s.textContent)&&/\\[商户端\\]/.test(s.textContent)&&/\\[平台运营端\\]/.test(s.textContent):false;})()`);
  ok(splitOk, '联动面板含四端明细');
  await shot('p2-impact');
  await ev(`closeSheet()`); await sleep(400);

  console.log('\n【5】落地订单详情并可返回');
  await ev(`afterOrder()`);
  const title = await waitFor(`(document.querySelector('#pageStack .page:last-child .nav-title')||{}).textContent||''`, '订单详情', 4000);
  ok(title === '订单详情', '落地订单详情页', '实际 title=' + title);
  ok(await ev(`/核销码/.test((document.querySelector('#pageStack .page:last-child .page-body')||{}).textContent||'')`), '订单详情含核销码');
  const endAfter = await ev(`S.end`);
  ok(endAfter === 'tourist', '落地后仍在游客端', '实际 end=' + endAfter);
  await shot('p3-order-detail');

  console.log('\n【6】返回：可回到行程，无死路');
  await ev(`pop()`); await sleep(800);
  const backState = await ev(`({stack:S.stack.map(x=>x.title), tabOn:(document.querySelector('#tabBar .tab.on')||{}).textContent||'', visible:!!document.querySelector('#baseScroll .tabpage, #baseScroll .page-body, #baseScroll > *')})`);
  ok(backState.stack.length === 0, '一次返回即回 tab 首屏（栈清空）', 'stack=' + JSON.stringify(backState.stack));
  ok(backState.visible, 'tab 首屏内容已恢复可见');
  ok(!!backState.tabOn, '底部 tab 高亮可继续操作', 'tab=' + backState.tabOn);
  await shot('p5-back-to-tour');

  console.log('\n【7】核销指引为真实页面');
  await ev(`pushOrderDetailPage(0)`); await sleep(600);
  ok(await waitFor(`(document.querySelector('#pageStack .page:last-child .nav-title')||{}).textContent||''`, '订单详情', 3000), '订单详情可再次进入');
  await ev(`showVerifyGuide(0)`); await sleep(600);
  const codeShown = await ev(`(()=>{const t=document.querySelector('#sheet').textContent||'';const m=t.match(/\\d{6}/);return m?m[0]:'';})()`);
  ok(/^\d{6}$/.test(codeShown), '核销码二维码面板展示真实码', codeShown);
  ok(await ev(`!!document.querySelector('#sheet .qr-mock svg')`), '核销码二维码渲染');
  await shot('p4-verify');

  console.log('\n【8】JS 运行时异常');
  ok(errs.length === 0, '无未捕获异常', errs.slice(0, 2).join(' || '));

  console.log('\n────────────────────────');
  console.log(`支付链路走查：PASS ${pass} / FAIL ${fail}`);
  ws.close(); chrome.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });