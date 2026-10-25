/**
 * 约稿任务状态机走查（v1.3 新增）
 * 验证：待领取 → 进行中 → 审核中 → 已完成，全链路状态可见 + 奖励联动钱包
 * 用法：node tools/missiontrace.js
 */
const { spawn } = require('child_process');
const fs = require('fs'), fsx = require('fs');
const pathx = require('path');
const { pathToFileURL } = require('url');
const CHROME = process.env.CHROME || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find(p => fsx.existsSync(p)) || 'chrome';
const ROOT = pathx.resolve(__dirname, '..');
const HTML = process.env.HTML || pathToFileURL(pathx.join(ROOT, '向往的自由-业务系统demo-高保真版.html')).href;
const OUT = process.env.OUT || pathx.join(ROOT, 'shots_mission');
const PORT = Number(process.env.PORT || 9396);
const sleep = ms => new Promise(r => setTimeout(r, ms));
if (!fsx.existsSync(OUT)) fsx.mkdirSync(OUT, { recursive: true });

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
}

(async () => {
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
  const tagOf = id => ev(`(()=>{const e=document.querySelector('#pageStack .page:last-child #mission-${id} .tag');return e?e.textContent.trim():'';})()`);
  const btnOf = id => ev(`(()=>{const e=document.querySelector('#pageStack .page:last-child #mission-${id} .mf .btn');return e?e.textContent.trim():'';})()`);

  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 920, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: HTML }); await sleep(2200);
  await ev(`S.loggedIn=true;S.loginStep='role';document.querySelector('#loginLayer').classList.remove('on')`);
  await sleep(300);
  await ev(`setEnd('tourist');setTab('shop')`); await sleep(500);

  console.log('\n【1】进入约稿任务页');
  await ev(`pushCreateCenter()`); await sleep(600);
  ok(await ev(`/创作中心/.test((document.querySelector('#pageStack .page:last-child .nav-title')||{}).textContent||'')`), '创作中心打开');
  await ev(`pushMissionsPage()`); await sleep(600);
  const title = await ev(`(document.querySelector('#pageStack .page:last-child .nav-title')||{}).textContent||''`);
  ok(title === '约稿任务', '约稿任务页打开', title);
  ok(await ev(`document.querySelectorAll('#pageStack .page:last-child #missionList .mission-card').length===3`), '渲染 3 张任务卡');
  await shot('m1-todo');

  console.log('\n【2】初始状态 = 待领取');
  ok(await tagOf(1) === '待领取', '任务1 初始「待领取」', await tagOf(1));
  ok(await btnOf(1) === '领取任务', '按钮为「领取任务」', await btnOf(1));

  console.log('\n【3】领取 → 状态必须变化');
  const before = await ev(`document.querySelector('#pageStack .page:last-child #mission-1').outerHTML`);
  await ev(`claimMission(1)`); await sleep(500);
  const after = await ev(`document.querySelector('#pageStack .page:last-child #mission-1').outerHTML`);
  ok(await tagOf(1) === '进行中', '领取后变「进行中」', await tagOf(1));
  ok(before !== after, '卡片 DOM 真实刷新（非仅 toast）');
  ok(await btnOf(1) === '提交作品', '按钮变「提交作品」', await btnOf(1));
  ok(await ev(`/已领取/.test(document.querySelector('#pageStack .page:last-child #mission-1').textContent)`), '显示领取后提示');
  await shot('m2-doing');

  console.log('\n【4】提交作品（真实表单）');
  await ev(`submitMission(1)`); await sleep(500);
  ok(await ev(`!!document.querySelector('#sheet #msTitle')`), '提交表单弹出');
  ok(await ev(`!!document.querySelector('#sheet #msLink')`), '含作品链接输入');
  await ev(`confirmSubmitMission(1)`); await sleep(400);
  ok(await ev(`/请填写作品标题/.test(document.querySelector('#toast').textContent)`), '空标题被拦截');
  await ev(`document.querySelector('#msTitle').value='朱家角谜案三日深度攻略';document.querySelector('#msLink').value='https://xwzzy.cn/p/8888';confirmSubmitMission(1)`); await sleep(500);
  ok(await tagOf(1) === '审核中', '提交后变「审核中」', await tagOf(1));
  ok(await ev(`/已提交审核/.test(document.querySelector('#toast').textContent)`), '给出提交反馈');
  await shot('m3-review');

  console.log('\n【5】审核通过 → 奖励发放到钱包');
  const walletBefore = await ev(`DB.wallet`);
  await ev(`approveMission(1)`); await sleep(600);
  ok(await tagOf(1) === '已完成', '审核后变「已完成」', await tagOf(1));
  const walletAfter = await ev(`DB.wallet`);
  ok(walletAfter === walletBefore + 200, `旅豆 +200（${walletBefore} → ${walletAfter}）`);
  const txTop = await ev(`DB.txLog[0].d`);
  ok(/约稿奖励/.test(txTop), '旅豆流水已记账', txTop);
  await shot('m4-done');

  console.log('\n【6】奖励明细为真实面板');
  await ev(`viewMissionReward(1)`); await sleep(500);
  ok(await ev(`/奖励发放明细/.test(document.querySelector('#sheet').textContent)`), '奖励明细面板打开');
  ok(await ev(`/朱家角谜案三日深度攻略/.test(document.querySelector('#sheet').textContent)`), '展示已提交作品标题');
  ok(await ev(`/\\+200 豆/.test(document.querySelector('#sheet').textContent)`), '展示旅豆奖励数额');
  await shot('m5-reward');
  await ev(`closeSheet()`); await sleep(300);

  console.log('\n【7】状态持久：切走再回来仍在');
  await ev(`pop();pop();setTab('home')`); await sleep(400);
  await ev(`pushMissionsPage()`); await sleep(600);
  ok(await tagOf(1) === '已完成', '重进页面状态保持「已完成」', await tagOf(1));
  ok(await tagOf(2) === '待领取', '未领取任务不受影响', await tagOf(2));

  console.log('\n【8】JS 运行时异常');
  ok(errs.length === 0, '无未捕获异常', errs.slice(0, 2).join(' || '));

  console.log('\n────────────────────────');
  console.log(`任务状态机走查：PASS ${pass} / FAIL ${fail}`);
  ws.close(); chrome.kill();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });