// 剧本闯关可玩链路走查：角色分配→地图签到→NPC暗号→搜证指认→邮局抉择→多结局结算
// 三种结局（真相大白 / 明哲保身 / 遗憾迷途）× 双视口，含截图与 JS 错误监控
const { spawn } = require('child_process');
const fs = require('fs');
const pathx = require('path');
const { pathToFileURL } = require('url');
const CHROME = process.env.CHROME || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find(p => fs.existsSync(p)) || 'chrome';
const HTML = process.env.HTML || pathToFileURL(
  pathx.resolve(__dirname, '..', '向往的自由-业务系统demo-高保真版.html')
).href;
const PORT = Number(process.env.PORT || 9340);
const SHOT_DIR = process.env.SHOT_DIR || pathx.resolve(__dirname, 'shots4');
fs.mkdirSync(SHOT_DIR, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const SCENARIOS = {
  truth: { suspectText: '码头商会会长', sendText: '寄出真相',   end: 'truth', bean: 80 },
  safe:  { suspectText: '码头商会会长', sendText: '私藏线索',   end: 'safe',  bean: 50 },
  miss:  { suspectText: '茶庄大掌柜',   sendText: '寄出真相',   end: 'miss',  bean: 20 },
};
/* 栈顶页面作用域：剧本阶段只操作沉浸模式页，避免点到下层详情页的同名元素 */
const PG = '#pageStack .page:last-child ';

async function run(width, height, vname, scKey, port) {
  const sc = SCENARIOS[scKey];
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${port}`, 'about:blank'], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try { const r = await fetch(`http://127.0.0.1:${port}/json/list`); targets = await r.json(); if (targets.find(t => t.type === 'page')) break; } catch (e) {}
  }
  if (!targets) {
    /* 上一场景的 Chrome 未退干净导致调试端口没起来 —— 明确报错，不裸抛 */
    try { chrome.kill(); } catch (e) {}
    throw new Error('调试端口 ' + port + ' 启动失败（上个场景 Chrome 可能未退出，稍后重跑即可）');
  }
  const page = targets.find(t => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let msgId = 0; const pending = new Map(); const errs = []; const report = [];
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') errs.push('EXC: ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).split('\n')[0]);
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push('CONSOLE: ' + m.params.args.map(a => a.value || a.description).join(' '));
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const id = ++msgId; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  const evalJS = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return r.exceptionDetails ? { __error: r.exceptionText } : r.result.value;
  };
  const shot = async (name) => {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(`${SHOT_DIR}/${vname}-${scKey}-${name}.png`, Buffer.from(r.data, 'base64'));
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: HTML });
  await sleep(2200);

  let pass = 0, fail = 0;
  const ok = (c, n) => { report.push((c ? 'PASS' : 'FAIL') + ' | ' + n); c ? pass++ : fail++; };

  // 按文本点击可见按钮（验证真实可点；scope 限定在栈顶页面内，避免点到下层页面同名元素）
  async function clickByText(sel, text, desc, scope = '') {
    const info = await evalJS(`(()=>{const els=[...document.querySelectorAll(${JSON.stringify(scope + sel)})].filter(e=>e.textContent.includes(${JSON.stringify(text)}));const e=els[els.length-1];if(!e)return null;e.scrollIntoView({block:'center',inline:'nearest'});const r=e.getBoundingClientRect();if(r.width<1||r.height<1)return null;const cx=r.x+r.width/2,cy=r.y+r.height/2;const top=document.elementFromPoint(cx,cy);return {x:cx,y:cy,covers:!!(top&&(e.contains(top)||top.contains(e)))};})()`);
    if (!info) { report.push('FAIL | 元素不可见: ' + desc); fail++; return false; }
    if (!info.covers) report.push('WARN | 点击被遮挡: ' + desc);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: info.x, y: info.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: info.x, y: info.y, button: 'left', clickCount: 1 });
    await sleep(400);
    return true;
  }
  async function clickPoint(sel, nth, desc, scope = '') {
    const info = await evalJS(`(()=>{const els=document.querySelectorAll(${JSON.stringify(scope + sel)});const e=els[${nth}];if(!e)return null;e.scrollIntoView({block:'center',inline:'nearest'});const r=e.getBoundingClientRect();if(r.width<1||r.height<1)return null;const cx=r.x+r.width/2,cy=r.y+r.height/2;const top=document.elementFromPoint(cx,cy);return {x:cx,y:cy,covers:!!(top&&(e.contains(top)||top.contains(e)))};})()`);
    if (!info) { report.push('FAIL | 元素不可见: ' + desc); fail++; return false; }
    if (!info.covers) report.push('WARN | 点击被遮挡: ' + desc);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: info.x, y: info.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: info.x, y: info.y, button: 'left', clickCount: 1 });
    await sleep(400);
    return true;
  }

  /* ===== 登录 ===== */
  /* v1.11 起默认入口是身份卡（演示一键进入），手机号登录降为二级入口 —— 探针先切回手机号步骤 */
  if (await evalJS('S.loginStep') !== 'phone') {
    await clickPoint('#segPhone', 0, '登录-切到「手机号 + 验证码」');
    if (await evalJS('S.loginStep') !== 'phone') { report.push('FAIL | 未能切换到手机号登录'); console.log(report.join('\n')); ws.close(); chrome.kill(); return 99; }
  }
  await evalJS(`(()=>{const i=document.querySelector('#phoneInput');i.value='13800006666';i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await clickPoint('#btnGetCode', 0, '登录-获取验证码');
  if (await evalJS('S.loginStep') !== 'code') { report.push('FAIL | 登录未进入验证码步骤'); console.log(report.join('\n')); ws.close(); chrome.kill(); return 99; }
  await evalJS(`(()=>{const i=document.querySelector('#codeInput');i.value='123456';i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await sleep(900);
  if (await evalJS('S.loginStep') !== 'role') { report.push('FAIL | 验证码未通过'); console.log(report.join('\n')); ws.close(); chrome.kill(); return 99; }
  await clickPoint('.role-card', 0, '登录-选择游客身份');
  await sleep(500);
  ok(await evalJS('S.loggedIn') === true, '登录：进入应用');
  ok(await evalJS("!document.querySelector('#splashAd')"), '登录：无开屏广告遮挡');
  ok(await evalJS("S.end === 'tourist'"), '登录：停留在自选身份');
  await sleep(300);

  /* ===== 进入剧本沉浸模式 ===== */
  await evalJS("setEnd('tourist'); setTab('theme')");
  await sleep(500);
  await evalJS('pushScriptPage(6)');
  await sleep(600);
  await shot('00-detail');
  await clickByText('.btn', '开始组队闯关', '剧本详情-开始组队闯关', PG);
  await sleep(600);
  ok(await evalJS('S.play && S.play.stage') === 'role', '进入沉浸模式：第一幕角色分配');
  ok(await evalJS(`document.querySelectorAll('${PG} .role-pick').length`) === 4, '角色分配：4 个角色卡');
  await shot('01-role');

  /* ===== 第一幕 · 选角色 ===== */
  await clickPoint('.role-pick', 1, '选择角色-戏班花旦', PG);
  ok(await evalJS('S.play.role') === 1, '选角色：高亮选中');
  await clickByText('.btn', '确认角色', '确认角色出发', PG);
  await sleep(400);
  ok(await evalJS('S.play.stage') === 'map', '确认角色：进入地图任务');
  ok(await evalJS("S.play.clues.indexOf('opera')>=0") , '角色专属线索「戏班戏单」入包');
  ok(await evalJS("document.querySelector('.script-map')") !== null, '地图：程序化 SVG 渲染');
  await shot('02-map');

  /* ===== 第二幕 · 放生桥签到 ===== */
  await clickByText('.btn', 'AR 扫码签到', '放生桥-AR扫码签到', PG);
  await sleep(1700);
  ok(await evalJS('S.play.done.bridge') === true, '签到：桥节点完成');
  ok(await evalJS("S.play.clues.indexOf('ticket')>=0"), '签到：线索「半张船票」入包');
  await shot('03-checkin');

  /* ===== 第二幕 · 北大街 NPC 暗号（剧情分支）===== */
  await evalJS("playGoto('street')");
  await sleep(400);
  ok(await evalJS("document.querySelectorAll('.opt-row').length") === 3, 'NPC：茶博士三道茶三选项');
  await clickPoint('.opt-row', 1, 'NPC-选择正确暗号', PG);
  await sleep(400);
  ok(await evalJS('S.play.npcDone') === true, 'NPC：暗号答对');
  ok(await evalJS("S.play.clues.indexOf('photo')>=0"), 'NPC：线索「褪色旧照片」入包');
  await shot('04-npc');

  /* ===== 第二幕 · 大夫第搜证 ===== */
  await evalJS("playGoto('mansion')");
  await sleep(400);
  ok(await evalJS("document.querySelectorAll('.hotspot .hs').length") === 3, '搜证：3 处疑点热点');
  for (let i = 0; i < 3; i++) { await clickPoint('.hotspot .hs', i, `搜证-点亮疑点${i + 1}`, PG); await sleep(250); }
  ok(await evalJS('S.play.found') === 3, '搜证：3 处疑点全部找到');
  ok(await evalJS("S.play.clues.indexOf('seal')>=0"), '搜证：线索「带印泥的剪刀」入包');
  ok(await evalJS("document.querySelectorAll('.suspect-row').length") === 3, '指认：3 名嫌疑人');
  await shot('05-search');

  /* ===== 指认真凶 ===== */
  await clickByText('.suspect-row', sc.suspectText, '指认-' + sc.suspectText, PG);
  await sleep(300);
  ok(await evalJS("S.play.accused") === (scKey === 'miss' ? 'boss' : 'guild'), '指认：选中嫌疑人');
  await clickByText('.btn', '确认指认', '确认指认前往邮局', PG);
  await sleep(400);
  ok(await evalJS('S.play.node') === 'post', '指认后：自动前往邮局');
  await shot('06-accuse');

  /* ===== 邮局抉择 ===== */
  ok(await evalJS("S.play.clues.length") === 4, '线索包：集齐 4 条');
  await clickByText('.suspect-row', sc.sendText, '邮局-' + sc.sendText, PG);
  await sleep(600);
  ok(await evalJS('S.play.stage') === 'ending', '抉择后：进入通关结算');
  await shot('07-ending');

  /* ===== 结算断言 ===== */
  ok(await evalJS('S.play.result.id') === sc.end, `结局判定：${sc.end}（预期 ${sc.end}）`);
  ok(await evalJS('DB.wallet') === 1280 + sc.bean, `旅豆入账：wallet=${1280 + sc.bean}`);
  ok(await evalJS("DB.txLog[0].a") === '+' + sc.bean, '交易流水：首条为通关奖励');
  ok(await evalJS("DB.txLog[0].chain && DB.txLog[0].chain.indexOf('0x')===0") === true, '交易流水：链上哈希');
  ok(await evalJS("DB.scriptData.tasks.every(k=>k.done)") === true, '详情页任务态：全部完成');
  if (scKey !== 'miss') {
    ok(await evalJS("DB.badges.find(b=>b.n==='江南谜案人').got") === true, '徽章：江南谜案人已点亮');
  }
  ok(await evalJS("document.querySelector('.play-end h2').textContent.length") > 0, '结算页：结局标题渲染');

  /* ===== 再玩一次 ===== */
  await clickByText('.btn', '再玩一次', '结算-再玩一次', PG);
  await sleep(400);
  ok(await evalJS('S.play.stage') === 'role', '再玩一次：回到角色分配');

  report.push(`INFO | 场景 ${scKey} 链路完整走通`);
  console.log(`\n========== 视口 ${vname} ${width}x${height} · 场景 ${scKey} ==========`);
  console.log(report.join('\n'));
  console.log(`合计: ${pass} PASS / ${fail} FAIL`);
  console.log('JS 错误:', errs.length ? errs.join(' || ') : 'none');
  ws.close(); chrome.kill();
  await sleep(900);   /* 给 Chrome 留足退出时间，避免下一场景端口/进程竞态 */
  return fail;
}

(async () => {
  const fails = [];
  /* 每个场景用独立调试端口：复用同一端口起停 Chrome 时，上个场景进程未退干净会让新实例起不来 */
  fails.push(await run(1440, 900, 'wide', 'truth', PORT));
  fails.push(await run(430, 900, 'narrow', 'truth', PORT + 1));
  fails.push(await run(430, 900, 'narrow', 'safe', PORT + 2));
  fails.push(await run(430, 900, 'narrow', 'miss', PORT + 3));
  const total = fails.reduce((a, b) => a + b, 0);
  console.log('\n========== 总结 ==========');
  console.log(total === 0 ? `全部通过：${fails.length} 个场景 0 FAIL` : `存在 ${total} 个 FAIL，请检查上方报告`);
  process.exit(total === 0 ? 0 : 1);
})();
