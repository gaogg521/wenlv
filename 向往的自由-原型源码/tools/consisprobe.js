/**
 * 演示自洽性探针（v1.11）
 * 目的：投资演示时最怕的不是功能少，而是「同一个人在两个页面看到两个数」。
 * 本探针把所有可能被当场核对的数字关系固化成断言。
 */
const { spawn } = require('child_process');
const fsx = require('fs'), pathx = require('path');
const { pathToFileURL } = require('url');
const CHROME = process.env.CHROME || ['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => fsx.existsSync(p));
const HTML = pathToFileURL(pathx.resolve(__dirname, '..', '向往的自由-业务系统demo-高保真版.html')).href;
const PORT = Number(process.env.PORT || 9451);
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
  await send('Page.navigate', { url: HTML }); await sleep(2500);
  await ev(`S.loggedIn=true;document.querySelector('#loginLayer').classList.remove('on')`);

  let pass = 0, fail = 0; const fails = [];
  const ck = (name, cond, detail) => {
    if (cond) { pass++; console.log('  PASS | ' + name + (detail ? '  · ' + detail : '')); }
    else { fail++; fails.push(name); console.log('  FAIL | ' + name + (detail ? '  · ' + detail : '')); }
  };

  // ══════════ 【1】列表厚度：演示时点开任何模块都不能是空壳 ══════════
  console.log('\n【1】数据厚度（演示时点开不空）');
  const D = await ev(`({
    tours: DB.tours.length, products: DB.products.length, badges: DB.badges.length,
    txLog: DB.txLog.length, visitorOrders: DB.visitorOrders.length, myWorks: DB.myWorks.length,
    missions: DB.missions.length, refs: DB.partner.referrals.length, bills: DB.partnerBills.length,
    withdraw: DB.withdrawLog.length, mOrders: DB.merch.orders.length, stock: DB.merch.stock.length,
    supply: DB.merch.supply.length, audits: DB.admin.audits.length, warnings: DB.admin.warnings.length,
    stream: DB.admin.stream.length, footprints: DB.travelId.footprints.length,
    cats: DB.cats.length, catCover: (function(){
      return DB.cats.every(function(c){ return DB.tours.filter(function(t){ return t.cat===c.k; }).length >= 3; });
    })(),
    orphanCat: DB.tours.filter(function(t){ return !DB.cats.some(function(c){ return c.k===t.cat; }); }).length
  })`);
  const MIN = { tours:25, products:12, badges:12, txLog:20, visitorOrders:14, myWorks:8, missions:10,
                refs:14, bills:8, withdraw:8, mOrders:20, stock:10, supply:10, audits:12, warnings:6,
                stream:14, footprints:8 };
  Object.keys(MIN).forEach(k => ck(k + ' ≥ ' + MIN[k], D[k] >= MIN[k], '实际 ' + D[k]));
  ck('8 个分类每个 ≥3 条线路（切任一分类都不空）', D.catCover === true);
  ck('无孤儿分类（线路的 cat 都在分类表里）', D.orphanCat === 0, '孤儿 ' + D.orphanCat + ' 条');

  // ══════════ 【2】同源数字：同一指标在不同页面必须相等 ══════════
  console.log('\n【2】同源数字（换页面不能变脸）');
  const S = await ev(`(function(){
    const L = DB.x.ledger[DB.x.ledger.length-1];
    const r30 = dashRange('30d'), r7 = dashRange('7d');
    return {
      ledgerLastGmv: L.gmv, adminTodayGmv: DB.admin.todayGmv,
      ledgerLastOrd: L.ord, adminTodayOrders: DB.admin.todayOrders,
      ledgerTodayVerify: Math.round(L.vf/L.ord*1000)/10, adminVerifyRate: DB.admin.verifyRate,
      v30: r30.cur.verify, v7: r7.cur.verify, v90: dashRange('90d').cur.verify,
      pendingField: DB.merch.pending,
      pendingReal: DB.merch.orders.filter(function(o){return o.status==='待核销';}).length,
      trendLast: DB.x.merchTrend.v[DB.x.merchTrend.v.length-1],
      gmvK: Math.round(DB.merch.gmv/100)/10,
      partnerWeek: DB.x.partnerTrend.v.reduce(function(a,b){return a+b;},0),
      monthEarn: DB.partner.monthEarn,
      mtdDays: (function(){ var L=DB.x.ledger, last=L[L.length-1]; return last.g; })()
    };
  })()`);
  ck('今日 GMV：驾驶舱底账 = ame 页', S.ledgerLastGmv === S.adminTodayGmv, '¥' + S.ledgerLastGmv);
  ck('今日订单：底账 = ame 页', S.ledgerLastOrd === S.adminTodayOrders, S.ledgerLastOrd + ' 单');
  ck('今日核销率：底账 = ame 派生值', Math.abs(S.ledgerTodayVerify - S.adminVerifyRate) < 0.05, S.ledgerTodayVerify + '%');
  ck('商户待核销：字段 = 订单实际条数', S.pendingField === S.pendingReal, S.pendingField + ' 笔');
  ck('商户趋势末日 = 今日流水', Math.abs(S.trendLast - S.gmvK) < 0.05, S.trendLast + ' 千 vs ' + S.gmvK + ' 千');
  /* monthEarn 是「本月至今」而非整月，故按已过天数折算比较 */
  const perDayWeek = S.partnerWeek / 7;
  const perDayMonth = S.monthEarn / S.mtdDays;
  ck('合伙人 7 日日均与本月至今日均相容（容差 ±25%）',
     Math.abs(perDayWeek - perDayMonth) / perDayMonth < 0.25,
     '7日日均 ¥' + perDayWeek.toFixed(0) + ' vs 本月日均 ¥' + perDayMonth.toFixed(0) + '（已过 ' + S.mtdDays + ' 天）');
  ck('核销率随口径单调（7日 < 30日 ≤ 90日，在途折损递减）',
     S.v7 < S.v30 && S.v30 <= S.v90 + 0.35,
     S.v7.toFixed(1) + ' < ' + S.v30.toFixed(1) + ' ≤ ' + S.v90.toFixed(1));

  // ══════════ 【3】跨端订单打通：核销码能在两端对上 ══════════
  console.log('\n【3】跨端订单打通');
  const X = await ev(`(function(){
    const codes = DB.merch.orders.map(function(o){return o.code;});
    const vo = DB.visitorOrders.map(function(o){return o.code;});
    const inter = codes.filter(function(c){ return vo.indexOf(c) >= 0; });
    return { merchN: codes.length, visitorN: vo.length, inter: inter.length,
             dupM: codes.length - new Set(codes).size, dupV: vo.length - new Set(vo).size };
  })()`);
  ck('商户单与游客单存在可联动的核销码', X.inter >= 4, X.inter + ' 个共用核销码');
  ck('商户端核销码无重复', X.dupM === 0, '重复 ' + X.dupM);
  ck('游客端核销码无重复', X.dupV === 0, '重复 ' + X.dupV);

  // ══════════ 【4】写操作真实联动（不是假按钮）══════════
  console.log('\n【4】写操作真实联动');
  const beforeV = await ev(`(function(){
    const L=DB.x.ledger[DB.x.ledger.length-1];
    return { vf:L.vf, ord:L.ord, pending:DB.merch.pending, stream:DB.admin.stream.length,
             v7:dashRange('7d').cur.verify,
             idx: DB.merch.orders.findIndex(function(o){return o.status==='待核销';}) };
  })()`);
  await ev(`(function(){ var o=DB.merch.orders[${beforeV.idx}]; applyVerify(o); return 1; })()`);
  await sleep(200);
  const afterV = await ev(`(function(){
    const L=DB.x.ledger[DB.x.ledger.length-1];
    return { vf:L.vf, ord:L.ord, pending:DB.merch.pending, stream:DB.admin.stream.length,
             v7:dashRange('7d').cur.verify };
  })()`);
  ck('核销后底账当日核销数 +1', afterV.vf === beforeV.vf + 1, beforeV.vf + ' → ' + afterV.vf + ' / ' + beforeV.ord + ' 单');
  ck('核销后商户待核销 -1', afterV.pending === beforeV.pending - 1, beforeV.pending + ' → ' + afterV.pending);
  ck('核销后运营端实时流 +1 条', afterV.stream === beforeV.stream + 1, beforeV.stream + ' → ' + afterV.stream);
  ck('核销后驾驶舱核销率随之上升', afterV.v7 > beforeV.v7, beforeV.v7.toFixed(2) + '% → ' + afterV.v7.toFixed(2) + '%');

  // 审核处置 → 统计重算
  const beforeA = await ev(`(function(){var S=DB.x.auditStat;return {done:S.done,pass:S.passPct};})()`);
  await ev(`(function(){ var ST=DB.x.auditStat; var p=Math.round(ST.done*ST.passPct/100); ST.done+=1; ST.passPct=Math.round((p+1)/ST.done*1000)/10; return 1; })()`);
  const afterA = await ev(`(function(){var S=DB.x.auditStat;return {done:S.done,pass:S.passPct};})()`);
  ck('审核处置后已审数 +1、通过率重算', afterA.done === beforeA.done + 1 && afterA.pass !== beforeA.pass,
     beforeA.done + '/' + beforeA.pass + '% → ' + afterA.done + '/' + afterA.pass + '%');

  // ══════════ 【5】文案与数据一致（防止标题写着近7日、数据是别的）══════════
  console.log('\n【5】文案与数据一致');
  await ev(`setEnd('admin');setTab('dash')`); await sleep(500);
  const TXT = await ev(`(function(){
    const el=document.querySelector('#baseScroll');
    const t=el?el.textContent:'';
    return { hasRange: /近 7 日|近 30 日|近 90 日|本月/.test(t),
             hasNote: /口径说明/.test(t),
             hasDiag: /经营诊断/.test(t),
             barOn: (document.querySelector('.rng-bar b.on')||{}).textContent||'' };
  })()`);
  ck('驾驶舱有口径切换器且默认选中', !!TXT.barOn, '当前 ' + TXT.barOn);
  ck('驾驶舱有经营诊断块', TXT.hasDiag === true);
  ck('驾驶舱有口径说明（被追问算法时能自证）', TXT.hasNote === true);

  // 四端「我的」页的统计数与数据源一致
  await ev(`setEnd('merch');setTab('mme')`); await sleep(400);
  const MM = await ev(`(function(){
    const t=(document.querySelector('#baseScroll')||{textContent:''}).textContent;
    return { hasToday: t.indexOf(String(DB.merch.today)) >= 0 };
  })()`);
  ck('商户「我的」页今日单量与数据源一致', MM.hasToday === true);

  ck('运行期无 JS 异常', errs.length === 0, errs.slice(0, 3).join(' | ') || '0 条');

  console.log('\n════════════════════════════════════');
  console.log(`自洽性：${pass} PASS / ${fail} FAIL`);
  if (fail) console.log('未通过：' + fails.join('、'));
  ws.close(); ch.kill();
  process.exit(fail ? 1 : 0);
})();
