// 逐Tab全元素点击验收 v2：快照式遍历（抗页面重渲染）+ 双视口 + 逐Tab截图 + JS错误 + 遮挡检测
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
const SHOT_DIR = process.env.SHOT_DIR || pathx.resolve(__dirname, 'shots');
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function run(width, height, vname) {
  const PORT = Number(process.env.PORT || 9338) + (vname === 'narrow' ? 1 : 0);
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${PORT}`, 'about:blank'], { stdio: 'ignore' });
  let targets = null;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); targets = await r.json(); if (targets.find(t => t.type === 'page')) break; } catch (e) {}
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
    fs.writeFileSync(`${SHOT_DIR}/${vname}-${name}.png`, Buffer.from(r.data, 'base64'));
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: HTML });
  await sleep(2200);

  let pass = 0, fail = 0, warn = 0;
  const ok = (c, n) => { report.push((c ? 'PASS' : 'FAIL') + ' | ' + n); c ? pass++ : fail++; };

  // 点击指定元素（先滚动到可见）
  async function clickPoint(sel, nth, desc) {
    const info = await evalJS(`(()=>{const els=document.querySelectorAll(${JSON.stringify(sel)});const e=els[${nth}];if(!e)return null;e.scrollIntoView({block:'center',inline:'nearest'});const r=e.getBoundingClientRect();if(r.width<1||r.height<1)return null;const cx=r.x+r.width/2,cy=r.y+r.height/2;const top=document.elementFromPoint(cx,cy);return {x:cx,y:cy,covers:!!(top&&(e.contains(top)||top.contains(e))),top:top?top.tagName+'.'+(top.className||'').toString().slice(0,20):''};})()`);
    if (!info) { report.push('FAIL | 元素不可见: ' + desc); fail++; return false; }
    if (!info.covers) { report.push(`WARN | 点击被遮挡(${info.top}): ${desc}`); warn++; }
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: info.x, y: info.y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: info.x, y: info.y, button: 'left', clickCount: 1 });
    await sleep(350);
    return true;
  }

  const resetState = async () => {
    await evalJS(`(()=>{
      document.querySelectorAll('#sheet,#dialog').forEach(x=>{x.style.transition='none';x.classList.remove('show');});
      document.querySelector('#mask').classList.remove('show');
      while(S.stack.length) S.stack.pop();
      const ps=document.querySelector('#pageStack'); if(ps) ps.innerHTML='';
      document.querySelector('#baseLayer').classList.remove('pushed');
      return true;
    })()`);
    await sleep(420); // 等待弹层收起过渡完成
  };

  // ========== 登录 ==========
  // v1.11 起默认入口是身份卡（演示一键进入），手机号登录降为二级入口 —— 探针先切回手机号步骤
  if (await evalJS("S.loginStep") !== 'phone') {
    await clickPoint('#segPhone', 0, '登录-切到「手机号 + 验证码」');
    if (await evalJS("S.loginStep") !== 'phone') { console.log('无法切换到手机号登录，中止'); ws.close(); chrome.kill(); return 99; }
  }
  await evalJS(`(()=>{const i=document.querySelector('#phoneInput');i.value='13800006666';i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await clickPoint('#btnGetCode', 0, '登录-获取验证码');
  ok(await evalJS('S.loginStep') === 'code', '登录：进入验证码步骤');
  if (await evalJS('S.loginStep') !== 'code') { console.log('登录失败，中止'); ws.close(); chrome.kill(); return 99; }
  await evalJS(`(()=>{const i=document.querySelector('#codeInput');i.value='123456';i.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await sleep(900);
  ok(await evalJS('S.loginStep') === 'role', '登录：进入身份选择');
  if (await evalJS('S.loginStep') !== 'role') { console.log('验证码失败，中止'); ws.close(); chrome.kill(); return 99; }
  await clickPoint('.role-card', 0, '登录-选择游客身份');
  await sleep(500);
  ok(await evalJS('S.loggedIn') === true, '登录：进入应用');
  ok(await evalJS("!document.querySelector('#splashAd')"), '登录：无开屏广告遮挡（v1.4.3 已移除）');
  ok(await evalJS("S.end === 'tourist'"), '登录：停留在自选身份，不被强制跳转');
  await shot('00-home');

  /* v1.14.1（赵老师拍板商城回一级位）：游客端 tabBar 4 → 5，商城回到 tab 位（v1.12 已验证形态）。
     定稿 §9 主句「tabBar 4 个」括号「商城 P2 做小 SKU 后再定 tab 位」是延后决策而非降级，
     demo 按 P2 后终局形态演示完整商业闭环。 */
  const ENDS = [
    { k: 'tourist', name: '游客端', tabs: 5 },
    { k: 'merch', name: '商户端', tabs: 4 },
    { k: 'admin', name: '运营端', tabs: 5 }
  ];
  for (const end of ENDS) {
    await evalJS(`setEnd('${end.k}')`);
    await sleep(500);
    ok(await evalJS(`document.querySelectorAll('#tabBar .tab').length`) === end.tabs, `${end.name}：Tab 数量=${end.tabs}`);
    for (let t = 0; t < end.tabs; t++) {
      await resetState();
      await clickPoint('#tabBar .tab', t, `${end.name}-Tab${t}`);
      const tabName = await evalJS(`document.querySelectorAll('#tabBar .tab')[${t}].textContent.trim()`);
      // 快照当前所有可见 onclick 元素
      const snap = await evalJS(`JSON.stringify([...document.querySelectorAll('#baseScroll [onclick],#tabBar [onclick]')].filter(e=>{const r=e.getBoundingClientRect();return r.width>2&&r.height>2;}).map(e=>({oc:e.getAttribute('onclick'),txt:e.textContent.trim().replace(/\\s+/g,' ').slice(0,30)})))`);
      const items = JSON.parse(snap);
      let clicked = 0, missed = 0;
      const errsBefore = errs.length;
      for (const it of items) {
        // 重新打标并按 快照特征 找回元素（抗重渲染）
        const idx = await evalJS(`(()=>{document.querySelectorAll('[data-acc]').forEach(e=>e.removeAttribute('data-acc'));const els=[...document.querySelectorAll('#baseScroll [onclick],#tabBar [onclick]')].filter(e=>{const r=e.getBoundingClientRect();return r.width>2&&r.height>2;});els.forEach((e,i)=>e.setAttribute('data-acc',i));const i=els.findIndex(e=>e.getAttribute('onclick')===${JSON.stringify(it.oc)}&&e.textContent.trim().replace(/\\s+/g,' ').slice(0,30)===${JSON.stringify(it.txt)});return i;})()`);
        if (idx < 0) { missed++; continue; }
        const stackBefore = await evalJS('S.stack.length');
        const r = await clickPoint('[data-acc]', idx, `${end.name}-${tabName}-"${it.txt}"`);
        if (!r) continue;
        clicked++;
        const errsNow = errs.length;
        if (errsNow > errsBefore) { report.push(`FAIL | ${end.name}-${tabName} 点击"${it.txt}"JS错误: ${errs[errsNow-1]}`); fail++; }
        const stackAfter = await evalJS('S.stack.length');
        const sheetOn = await evalJS("document.querySelector('#sheet').classList.contains('show')||document.querySelector('#dialog').classList.contains('show')");
        // 每点 6 个元素截一次图，便于目检
        if (clicked % 6 === 0) await shot(`${end.k}-${t}-${clicked}`);
        await resetState();
      }
      report.push(`INFO | ${end.name} [${tabName}] 点击 ${clicked}/${items.length}${missed ? ' · 失效' + missed : ''}`);
      // 快照遍历包含 tabBar 的 tab，点到其他 tab 会切走当前页；截图前强制清理所有盖层并滚回顶部，保证截图与 tab 对应且从页首开始
      await clickPoint('#tabBar .tab', t, `${end.name}-Tab${t}(截图前复位)`);
      await evalJS(`(()=>{
        ['#baseLayer','#screen','#pageStack','#sheet','#dialog','#mask'].forEach(s=>{const e=document.querySelector(s);if(e)e.style.transition='none';});
        for(let i=1;i<20000;i++){ clearTimeout(i); } // 清扫pending定时器：demo有下单700ms后切合伙人端等演示动线，会污染截图状态
        renderBase();
        const s=document.querySelector('#baseScroll');
        s.scrollTop=50; s.scrollTop=0; // 触发 scroll 事件迫使合成器刷新
        return true;
      })()`);
      await sleep(250); // 等待合成器刷新，否则 captureScreenshot 会拿到旧帧
      await shot(`${end.k}-tab${t}-${tabName}`);
    }
  }

  // 终极遮挡检测
  await evalJS("setEnd('tourist'); setTab('home')");
  await sleep(400);
  const coverDiag = await evalJS(`(()=>{
    const sc=document.querySelector('#screen').getBoundingClientRect();
    const bad=[];
    for(const f of [0.2,0.5,0.8]){
      const e=document.elementFromPoint(sc.x+sc.width/2,sc.y+sc.height*f);
      if(!e || !document.querySelector('#screen').contains(e)) bad.push(f);
    }
    return bad.length ? bad.join(',') : 'OK';
  })()`);
  ok(coverDiag === 'OK', `终极检测：登录后全屏无遮挡 (${coverDiag})`);

  console.log(`\n========== 视口 ${vname} ${width}x${height} ==========`);
  console.log(report.join('\n'));
  console.log(`合计: ${pass} PASS / ${fail} FAIL / ${warn} WARN`);
  console.log('JS 错误:', errs.length ? errs.join(' || ') : 'none');
  ws.close(); chrome.kill();
  await sleep(300);
  return fail;
}

(async () => {
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  let totalFail = 0;
  totalFail += await run(1400, 1000, 'wide');
  totalFail += await run(430, 900, 'narrow');
  console.log(totalFail === 0 ? '\n===== 全部通过 =====' : `\n===== 存在 ${totalFail} 个失败 =====`);
  process.exit(totalFail === 0 ? 0 : 1);
})().catch(e => { console.error('ERR', e); process.exit(1); });
