// 返回键体检（永久回归）：二级页左上返回键是否「有 / 可见 / 点得中」，以及 tab 跳转后的返回栏是否可用
// 用法：NODE_OPTIONS="" node tools/backprobe.js
const { spawn } = require('child_process');
const path = require('path');
const net = require('net');

const HTML = 'file:///' + path.resolve(__dirname, '..', '向往的自由-业务系统demo-高保真版.html').replace(/\\/g, '/');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = process.env.PORT || 0;

function freePort() {
  return new Promise(res => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); });
  });
}

// 全部二级页面（pop 进去的页面）
const PAGES = [
  ['pushAboutPage', ''], ['pushBadgesPage', ''], ['pushBeanDetailPage', ''], ['pushBeanLoopPage', "'redeem'"],
  ['pushBeanUsePage', "'redeem'"], ['pushCategoryPage', "'yoga'"], ['pushChainLogPage', ''], ['pushContractChangePage', ''],
  ['pushDemoCasePage', ''], ['pushEarnDetailPage', ''], ['pushEcoPage', ''], ['pushGoodsPoolPage', ''], ['pushGuidePage', ''],
  ['pushHotListPage', ''], ['pushLevelRulePage', ''], ['pushMissionsPage', ''], ['pushMyOrdersPage', ''], ['pushMyWorksPage', ''],
  ['pushNftOpsPage', ''], ['pushOrderDetailPage', '0'], ['pushOverseaPage', ''], ['pushPickedWorksPage', ''], ['pushPosterPage', ''],
  ['pushRedeemPage', ''], ['pushRightsPage', ''], ['pushRolePage', ''], ['pushScanPage', '0'], ['pushScriptPage', '1'],
  ['pushSearchPage', "''"], ['pushSettingsPage', ''], ['pushSettleBillPage', ''], ['pushStatementPage', ''], ['pushStockPage', ''],
  ['pushTravelIdPage', ''], ['pushTravelsPage', ''], ['pushTypesPage', ''], ['pushWeb3Page', ''],
];
// 「我的 → 某模块」这类跨 tab 跳转（应当出现返回栏）
const JUMPS = [
  ['tourist', 'me', 'pushMyOrdersPage'],   // 占位，真正用例见下
];
const JUMP_CASES = [
  ['admin', 'ame', 'dash', '运营端 我的→驾驶舱'],
  ['admin', 'ame', 'risk', '运营端 我的→风控'],
  ['admin', 'ame', 'audit', '运营端 我的→审核'],
  ['admin', 'ame', 'calc', '运营端 我的→测算'],
  ['merch', 'mme', 'order', '商户端 我的→订单与核销'],
  ['merch', 'mme', 'supply', '商户端 我的→货源中心'],
  ['tourist', 'wallet', 'shop', '游客端 旅豆→商城（v1.14.1 商城回一级 tab，走 jumpTab 返回栏）'],
];

(async () => {
  const port = PORT ? +PORT : await freePort();
  const ch = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',
    ['--headless=new', '--remote-debugging-port=' + port, '--disable-gpu', '--window-size=1440,900',
     '--no-first-run', '--user-data-dir=' + path.join(__dirname, '_cdp_bp'), 'about:blank'], { stdio: 'ignore' });

  let list = null;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/list`); list = await r.json(); if (list.length) break; } catch (e) {}
    await sleep(250);
  }
  const ws = new WebSocket(list.find(t => t.type === 'page').webSocketDebuggerUrl);
  await new Promise(r => ws.addEventListener('open', r));
  let id = 0; const waits = new Map();
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && waits.has(m.id)) { waits.get(m.id)(m); waits.delete(m.id); }
  });
  const send = (method, params) => new Promise(r => { const i = ++id; waits.set(i, r); ws.send(JSON.stringify({ id: i, method, params: params || {} })); });
  const ev = async expr => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result && r.result.exceptionDetails) return { __err: r.result.exceptionDetails.text };
    return r.result && r.result.result ? r.result.result.value : null;
  };

  let pass = 0, fail = 0;
  const ck = (name, ok, extra) => {
    if (ok) { pass++; console.log('  PASS  ' + name + (extra ? '  · ' + extra : '')); }
    else { fail++; console.log('  FAIL  ' + name + (extra ? '  · ' + extra : '')); }
  };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: HTML }); await sleep(1500);
  await ev(`S.loggedIn=true;var l=document.querySelector('#loginLayer');if(l)l.classList.remove('on');renderBase();1`);
  await sleep(300);

  console.log('\n════ A. 二级页左上返回键（' + PAGES.length + ' 页）════');
  const CHECK = `(function(){
    var p=document.querySelector('#pageStack .page:last-child'); if(!p) return {none:1};
    var b=p.querySelector('.nav-btn') || p.querySelector('[onclick*="pop("]'); if(!b) return {noBack:1};
    var r=b.getBoundingClientRect();
    var sc=document.querySelector('.phone-screen').getBoundingClientRect();
    var relX=r.x-sc.x, relY=r.y-sc.y;
    if(r.width<28||r.height<28) return {tiny:Math.round(r.width)+'x'+Math.round(r.height)};
    if(relY < 40 || relY > 120) return {pos:'y='+Math.round(relY)};
    if(relX > 40) return {pos:'x='+Math.round(relX)};
    var t=document.elementFromPoint(r.x+r.width/2, r.y+r.height/2);
    if(!(t && (b.contains(t)||t.contains(b)))) return {covered:(t?((t.className||'').toString().slice(0,18)):'null')};
    var svg=b.querySelector('svg'); var sw=svg?getComputedStyle(svg).strokeWidth:'0';
    var bg=getComputedStyle(b).backgroundColor;
    return {ok:1, sw:sw, bg:bg, size:Math.round(r.width)+'x'+Math.round(r.height)};
  })()`;
  const bad = [];
  for (const [fn, arg] of PAGES) {
    await ev(`while(S.stack.length)S.stack.pop();document.querySelector('#pageStack').innerHTML='';${fn}(${arg});1`);
    /* 页面切入动画 380ms（.page 由 translateX(100%) 过渡到 0）。固定 sleep 在机器忙时会不够，
       所以直接等 transform 归零，避免把「还在滑入」当成「返回键不在左上」 */
    for (let k = 0; k < 20; k++) {
      const t = await ev(`(function(){var p=document.querySelector('#pageStack .page:last-child');return p?getComputedStyle(p).transform:'none';})()`);
      if (!t || t === 'none' || /matrix\(1,\s*0,\s*0,\s*1,\s*0,\s*0\)/.test(t)) break;
      await sleep(60);
    }
    const r = await ev(CHECK);
    if (!r || !r.ok) bad.push(fn.replace(/^push|Page$/g, '') + ' ' + JSON.stringify(r));
  }
  ck('38 个二级页都有左上返回键（位置/尺寸正确）', bad.length === 0, bad.length ? bad.join(' | ') : PAGES.length + ' 页');
  const sample = await ev(`(function(){var p=document.querySelector('#pageStack .page:last-child');var b=p.querySelector('.nav-btn');var s=b.querySelector('svg');return {sw:getComputedStyle(s).strokeWidth, bg:getComputedStyle(b).backgroundColor, size:b.offsetWidth};})()`);
  ck('返回图标够粗（stroke-width ≥ 2.5）', sample && parseFloat(sample.sw) >= 2.5, sample && sample.sw);
  ck('返回键有可辨识的底（非全透明）', sample && sample.bg && sample.bg !== 'rgba(0, 0, 0, 0)', sample && sample.bg);
  ck('返回键热区 ≥ 38px', sample && sample.size >= 38, sample && sample.size + 'px');

  console.log('\n════ B. 跨 tab 跳转的返回栏（' + JUMP_CASES.length + ' 处）════');
  for (const [end, from, to, label] of JUMP_CASES) {
    await ev(`while(S.stack.length)S.stack.pop();document.querySelector('#pageStack').innerHTML='';S.end='${end}';S.tab['${end}']='${from}';S.ret=null;renderBase();renderRet();1`);
    await sleep(180);
    const r = await ev(`(function(){
      jumpTab('${to}');
      return new Promise(function(res){ setTimeout(function(){
        var c=document.getElementById('retChip'); var b=c.querySelector('button');
        if(!b){ res({no:1}); return; }
        var rb=b.getBoundingClientRect();
        var t=document.elementFromPoint(rb.x+rb.width/2, rb.y+rb.height/2);
        res({on:c.classList.contains('on'), txt:b.textContent.replace(/\\s+/g,''), y:Math.round(rb.y),
             hit:!!(t && (b.contains(t)||t.contains(b))), tab:S.tab['${end}'], pad:getComputedStyle(document.querySelector('#baseScroll')).paddingTop});
      }, 380); });
    })()`);
    ck(label + ' → 出现返回栏', r && r.on && /返回/.test(r.txt || ''), r && r.txt);
    ck(label + ' → 返回栏可点中且不压标题', r && r.hit && r.pad === '80px', r && ('pad=' + r.pad + ' y=' + r.y));
    const back = await ev(`(function(){ retBack(); return new Promise(function(res){ setTimeout(function(){
      res({tab:S.tab['${end}'], on:document.getElementById('retChip').classList.contains('on')}); }, 300); }); })()`);
    ck(label + ' → 点返回栏回到原 tab', back && back.tab === from && back.on === false, back && ('→' + back.tab));
  }

  console.log('\n════ C. 返回栏不越权 ════');
  const c1 = await ev(`(function(){ S.end='admin';S.tab.admin='ame';S.ret=null;renderBase();renderRet();
    jumpTab('dash'); return new Promise(function(res){ setTimeout(function(){
      setTab('audit'); setTimeout(function(){ res(document.getElementById('retChip').classList.contains('on')); }, 260); }, 320); }); })()`);
  ck('点底部 tab 栏之后返回栏消失', c1 === false, String(c1));
  const c2 = await ev(`(function(){ S.end='admin';S.tab.admin='ame';S.ret=null;renderBase();renderRet();
    jumpTab('dash'); return new Promise(function(res){ setTimeout(function(){
      setEnd('tourist'); setTimeout(function(){ res({on:document.getElementById('retChip').classList.contains('on'), ret:S.ret}); }, 320); }, 320); }); })()`);
  ck('切换身份后返回栏消失（不跨端残留）', c2 && c2.on === false && c2.ret === null, JSON.stringify(c2));
  const c3 = await ev(`(function(){ S.end='admin';S.tab.admin='ame';S.ret=null;renderBase();renderRet();
    jumpTab('dash'); return new Promise(function(res){ setTimeout(function(){
      pushRightsPage(); setTimeout(function(){ res(document.getElementById('retChip').classList.contains('on')); }, 320); }, 320); }); })()`);
  ck('进入二级页后返回栏收起（不压在返回键上）', c3 === false, String(c3));
  const c4 = await ev(`(function(){ pop(); return new Promise(function(res){ setTimeout(function(){
      res(document.getElementById('retChip').classList.contains('on')); }, 420); }); })()`);
  ck('从二级页退回后返回栏恢复', c4 === true, String(c4));

  console.log('\n────────────────────────────────────────');
  console.log(`返回键体检：PASS ${pass} / FAIL ${fail}`);
  ws.close(); ch.kill();
  process.exit(fail ? 1 : 0);
})();
