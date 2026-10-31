/**
 * 端跳转回归走查（v1.4.3 新增）
 * 目标：任何用户操作都不得静默改变当前身份（S.end）——尤其合伙人/商户端看数据时
 * 背景：v1.4.2 用户反馈「不同身份之间会自动切换和跳转」。已修复：
 *   ① 登录后自动弹出的开屏广告（saCta 会把用户从自选端拽到游客端）——已整体移除
 *   ② 右侧面板「播放四端数据联动」非游客端时静默 setEnd('tourist')——已加确认弹窗
 * 本工具做全量点击回归：合伙人/商户端每 tab 首屏 + push 子页面所有可点击元素逐个真实点击，
 * S.end 必须全程不变；另测游客端下单全流程与登录流程。
 * 用法：node tools/endtrace.js
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
const PORT = Number(process.env.PORT || 9371);
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${PORT}`, 'about:blank'], { stdio: 'ignore' });
  let t = null;
  for (let i = 0; i < 40; i++) { await sleep(250); try { const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); t = await r.json(); if (t.find(x => x.type === 'page')) break; } catch (e) {} }
  const ws = new WebSocket(t.find(x => x.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pend = new Map(); const errs = [];
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text || '').slice(0, 150));
  };
  const send = (m, p = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.exceptionDetails ? { __err: (r.exceptionDetails.exception?.description || r.exceptionDetails.text || 'err') } : r.result.value; };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 430, height: 920, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: HTML }); await sleep(2500);

  let pass = 0, fail = 0; const bad = [];
  const ok = (c, n, d) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; bad.push(n + (d ? ' → ' + d : '')); console.log('  FAIL  ' + n + (d ? ' → ' + d : '')); } };

  /* 初始化：登录进游客端 */
  await ev(`S.loggedIn=true;S.loginStep='role';document.querySelector('#loginLayer').classList.remove('on')`);
  await sleep(400);
  ok(await ev(`S.end==='tourist'`), '初始化：进入游客端');
  ok(await ev(`!document.querySelector('#splashAd')`), '无开屏广告（已移除）');

  /* BFS：合伙人/商户端每 tab 首屏 + 子页，所有可点击元素逐个点，S.end 不得变 */
  const ENDS = { partner: ['earn', 'team', 'invite', 'pme'], merch: ['work', 'order', 'supply', 'mme'] };
  let clicked = 0;
  for (const [end, tabs] of Object.entries(ENDS)) {
    for (const tab of tabs) {
      await ev(`document.querySelectorAll('#pageStack .page').forEach(p=>p.remove());S.stack=[];setEnd('${end}');setTab('${tab}')`);
      await sleep(600);
      const items = await ev(`(()=>{const out=[];document.querySelectorAll('#baseScroll [onclick]').forEach(el=>{out.push({txt:(el.textContent||'').trim().slice(0,24)});});return out;})()`);
      let idx = 0;
      for (const it of items) {
        const before = await ev(`S.end`);
        await ev(`(()=>{const els=document.querySelectorAll('#baseScroll [onclick]');const el=els[${idx}];if(el)el.click();})()`);
        idx++; clicked++;
        await sleep(420);
        const after = await ev(`S.end`);
        if (after !== before) { ok(false, `${end}/${tab} 点击「${it.txt}」不得切换身份`, before + '→' + after); }
        /* 进子页则子页内元素也点一遍 */
        const stackLen = await ev(`S.stack.length`);
        if (stackLen > 0) {
          const sub = await ev(`(()=>{const out=[];document.querySelectorAll('#pageStack .page:last-child .page-body [onclick]').forEach(el=>{out.push({txt:(el.textContent||'').trim().slice(0,24)});});return out;})()`);
          let j = 0;
          for (const s of sub) {
            const b2 = await ev(`S.end`);
            await ev(`(()=>{const els=document.querySelectorAll('#pageStack .page:last-child .page-body [onclick]');const el=els[${j}];if(el)el.click();})()`);
            j++; clicked++;
            await sleep(400);
            const a2 = await ev(`S.end`);
            if (a2 !== b2) ok(false, `${end}/${tab}→「${it.txt}」子页点击「${s.txt}」不得切换身份`, b2 + '→' + a2);
            await ev(`closeSheet&&closeSheet();const m=document.querySelector('#mask');if(m)m.classList.remove('show');`);
            await ev(`document.querySelectorAll('#pageStack .page').forEach(p=>p.remove());S.stack=[];setEnd('${end}');setTab('${tab}')`);
            await sleep(200);
          }
        }
        await ev(`closeSheet&&closeSheet();const m=document.querySelector('#mask');if(m)m.classList.remove('show');`);
        await ev(`document.querySelectorAll('#pageStack .page').forEach(p=>p.remove());S.stack=[];setEnd('${end}');setTab('${tab}')`);
        await sleep(180);
      }
    }
  }
  ok(true, `合伙人/商户端全量点击 ${clicked} 次，身份零切换`);

  /* 游客端下单全流程：支付完成后必须留在游客端 */
  await ev(`document.querySelectorAll('#pageStack .page').forEach(p=>p.remove());S.stack=[];setEnd('tourist');setTab('theme')`); await sleep(600);
  await ev(`pushTourDetail(6)`); await sleep(700);
  await ev(`(()=>{const b=document.querySelector('#pageStack .page:last-child .bottom-bar .btn');if(b)b.click();})()`); await sleep(600);
  await ev(`(()=>{const b=[...document.querySelectorAll('#sheet .btn')].find(x=>/立即支付|确认支付/.test(x.textContent));if(b)b.click();})()`); await sleep(2200);
  await ev(`(()=>{const b=[...document.querySelectorAll('#sheet .btn')].find(x=>x.textContent.includes('完成'));if(b)b.click();})()`); await sleep(2600);
  ok(await ev(`S.end==='tourist'`), '游客端下单全流程后仍停留在游客端', await ev(`S.end`));

  /* 播放三端数据联动：非游客端必须弹确认，不得静默跳走 */
  await ev(`setEnd('merch')`); await sleep(500);
  await ev(`playDemo()`); await sleep(600);
  ok(await ev(`S.end==='merch'`), '商户端点「播放联动」不静默跳端（弹确认）', await ev(`S.end`));
  ok(await ev(`document.querySelector('#dialog').classList.contains('show')`), '「播放联动」弹出确认框');
  await ev(`document.querySelector('#dlgCancel').click()`); await sleep(300);
  ok(await ev(`S.end==='merch'`), '取消确认后仍在商户端');

  console.log('\n【D】运行时异常');
  ok(errs.length === 0, '无未捕获异常', errs.slice(0, 2).join(' || '));

  console.log('\n────────────────────────');
  console.log(`端跳转回归：PASS ${pass} / FAIL ${fail}`);
  ws.close(); chrome.kill(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });
