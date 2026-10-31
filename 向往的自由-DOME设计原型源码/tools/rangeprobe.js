/**
 * v1.10 口径引擎探针：多时间维度是否真的自洽联动
 * 用法：node tools/rangeprobe.js
 */
const { spawn } = require('child_process');
const fsx = require('fs');
const pathx = require('path');
const { pathToFileURL } = require('url');
const CHROME = process.env.CHROME || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find(function(p){ return fsx.existsSync(p); }) || 'chrome';
const HTML = process.env.HTML || pathToFileURL(
  pathx.resolve(__dirname, '..', '向往的自由-业务系统demo-高保真版.html')
).href;
const PORT = Number(process.env.PORT || 9411);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let PASS = 0, FAIL = 0;
function ck(name, cond, extra){
  if(cond){ PASS++; console.log('  PASS  ' + name + (extra ? '  ' + extra : '')); }
  else { FAIL++; console.log('  FAIL  ' + name + (extra ? '  ' + extra : '')); }
}
(async () => {
  const ch = spawn(CHROME, ['--headless=new','--disable-gpu','--no-sandbox',`--remote-debugging-port=${PORT}`,'about:blank'], { stdio:'ignore' });
  let t = null;
  for(let i=0;i<40;i++){ await sleep(250); try{ const r = await fetch(`http://127.0.0.1:${PORT}/json/list`); t = await r.json(); if(t.find(x=>x.type==='page')) break; }catch(e){} }
  if(!t) { console.log('!! 无法连接 Chrome'); process.exit(1); }
  const ws = new WebSocket(t.find(x=>x.type==='page').webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ ws.onopen=res; ws.onerror=rej; });
  let id = 0; const pend = new Map(); const errs = [];
  ws.onmessage = e => { const m = JSON.parse(e.data);
    if(m.id && pend.has(m.id)){ const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
    else if(m.method === 'Runtime.exceptionThrown'){ errs.push((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description || m.params.exceptionDetails.text || '').slice(0,300)); } };
  const send = (m,p={}) => new Promise((res,rej)=>{ const i=++id; pend.set(i,{res,rej}); ws.send(JSON.stringify({id:i,method:m,params:p})); });
  const ev = async x => { const r = await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true}); return r.exceptionDetails ? {__err:(r.exceptionDetails.exception&&r.exceptionDetails.exception.description||r.exceptionDetails.text)} : r.result.value; };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:430,height:920,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:HTML}); await sleep(2400);
  await ev(`S.loggedIn=true;document.querySelector('#loginLayer').classList.remove('on')`); await sleep(300);
  await ev(`setEnd('admin');setTab('dash')`); await sleep(700);

  console.log('\n【1】底账基础');
  const L = await ev(`(function(){const L=DB.x.ledger;let g=0,o=0;L.forEach(function(x){g+=x.gmv;o+=x.ord;});
    return {n:L.length,aov:g/o,first:L[0].d,last:L[L.length-1].d};
  })()`);
  ck('底账 180 天', L.n === 180, L.first + ' ~ ' + L.last);
  ck('客单价中枢落在 ¥298±12（与一单 298 分账口径一致）', Math.abs(L.aov - 298) < 12, '全期客单价 ¥' + L.aov.toFixed(1));

  console.log('\n【2】四个口径的聚合阶梯必须单调');
  const R = await ev(`(function(){
    const o={}; ['7d','30d','90d','mtd'].forEach(function(k){
      const r=dashRange(k);
      o[k]={days:r.days,gmv:r.cur.gmv,ord:r.cur.ord,dgmv:r.d.gmv,verify:r.cur.verify,label:r.label};
    }); return o; })()`);
  ['7d','30d','90d','mtd'].forEach(function(k){
    ck('口径 ' + k + ' 有值', R[k] && R[k].gmv > 0, R[k] ? R[k].label + ' · ' + R[k].days + ' 天 · ¥' + Math.round(R[k].gmv).toLocaleString() + ' · 环比 ' + R[k].dgmv.toFixed(1) + '%' : '');
  });
  ck('7日 ⊂ 30日 ⊂ 90日（GMV 阶梯单调）', R['7d'].gmv < R['30d'].gmv && R['30d'].gmv < R['90d'].gmv);
  ck('7日 ≈ 30日的 1/4 上下（口径比值合理）', R['7d'].gmv / R['30d'].gmv > 0.16 && R['7d'].gmv / R['30d'].gmv < 0.40,
    '比值 ' + (R['7d'].gmv / R['30d'].gmv).toFixed(3));
  ck('本月天数 = 19（10/01 起）', R['mtd'].days === 19, R['mtd'].days + ' 天');

  console.log('\n【3】环比必须有上期来源（不能是硬编码常量）');
  const D = await ev(`(function(){const r=dashRange('30d');return {d:r.d,gmv:r.cur.gmv,pg:r.prev.gmv,ord:r.cur.ord,po:r.prev.ord};})()`);
  ck('30日上期 GMV 非空', D.pg > 0, '本期 ¥' + Math.round(D.gmv) + ' vs 上期 ¥' + Math.round(D.pg));
  ck('环比 = 本期/上期 − 1（算得上）', Math.abs(D.d.gmv - (D.gmv / D.pg - 1) * 100) < 0.01,
    (D.d.gmv).toFixed(2) + '%');
  const D7 = await ev(`dashRange('7d').d.gmv`);
  ck('7日与30日环比不相等（口径真的换了，不是同一个常量）', Math.abs(D7 - D.d.gmv) > 0.3,
    '7日 ' + D7.toFixed(1) + '% vs 30日 ' + D.d.gmv.toFixed(1) + '%');

  console.log('\n【4】分城合计 = 大盘（结构性自洽）');
  const C = await ev(`(function(){const r=dashRange('30d');let s=0,p=0;
    r.cities.forEach(function(c){s+=c.gmv;p+=c.prev;});
    return {sum:s,all:r.cur.gmv,psum:p,pall:r.prev.gmv,share:r.cities.reduce(function(a,c){return a+c.share;},0)};})()`);
  ck('分城 GMV 合计 = 大盘（误差 <¥2）', Math.abs(C.sum - C.all) < 2, '合计 ¥' + Math.round(C.sum) + ' vs 大盘 ¥' + Math.round(C.all));
  ck('分城上期合计 = 大盘上期（加权环比自洽）', Math.abs(C.psum - C.pall) < 2, '合计 ¥' + Math.round(C.psum) + ' vs ¥' + Math.round(C.pall));
  ck('占比合计 100%', Math.abs(C.share - 100) < 0.01, C.share.toFixed(2) + '%');

  console.log('\n【5】KPI 全部派生（改口径必须动数值）');
  const K = await ev(`(function(){const a={},b={};
    dashRange('7d').kpi.forEach(function(k){a[k.k]=k.v;});
    dashRange('90d').kpi.forEach(function(k){b[k.k]=k.v;});
    return {a:a,b:b};})()`);
  ck('7日 vs 90日 成交额不同', Math.abs(K.a.gmv - K.b.gmv) > 1000, '¥' + Math.round(K.a.gmv) + ' vs ¥' + Math.round(K.b.gmv));
  ck('7日 vs 90日 订单数不同', K.a.ord !== K.b.ord, K.a.ord + ' vs ' + K.b.ord);
  ck('6 张 KPI 齐全', Object.keys(K.a).length === 6, Object.keys(K.a).join('/'));

  console.log('\n【6】趋势粒度自动切换（90 天不能糊成 90 根柱子）');
  const T = await ev(`(function(){const a=dashRange('7d').trend,b=dashRange('90d').trend;
    return {aN:a.items.length,aPer:a.per,bN:b.items.length,bPer:b.per};})()`);
  ck('7日 按日 7 列', T.aN === 7 && T.aPer === 1, T.aN + ' 列 / 每列 ' + T.aPer + ' 天');
  ck('90日 按段聚合 ≤10 列', T.bN <= 10 && T.bN >= 8 && T.bPer > 1, T.bN + ' 列 / 每列 ' + T.bPer + ' 天');

  console.log('\n【7】漏斗以订单为锚，上下游自洽');
  const F = await ev(`(function(){const r=dashRange('30d'),f=r.funnel;
    return {e:f.e,v:f.v,o:f.o,fi:f.f,rate:f.rate,ord:r.cur.ord,vf:r.cur.vf};})()`);
  ck('漏斗「下单」= 口径订单数', F.o === F.ord, F.o + ' vs ' + F.ord);
  ck('漏斗「核销」= 口径核销单', F.fi === F.vf, F.fi + ' vs ' + F.vf);
  ck('曝光 > 详情 > 下单 > 核销（严格递减）', F.e > F.v && F.v > F.o && F.o > F.fi,
    F.e + ' → ' + F.v + ' → ' + F.o + ' → ' + F.fi);
  ck('整体转化率 = 核销/曝光', Math.abs(F.rate - F.fi / F.e * 100) < 0.01, F.rate.toFixed(2) + '%');

  console.log('\n【8】点击切换真的会重渲染');
  const b1 = await ev(`(function(){const el=document.querySelector('#baseScroll .admin-kpi .ak .kn');return el?el.textContent:'';})()`);
  await ev(`setDashRange('90d')`); await sleep(600);
  const b2 = await ev(`(function(){const el=document.querySelector('#baseScroll .admin-kpi .ak .kn');return el?el.textContent:'';})()`);
  ck('切换后首张 KPI 数值变化', b1 !== b2 && b2 !== '', b1 + ' → ' + b2);
  const on = await ev(`(function(){const el=document.querySelector('#baseScroll .rng-bar b.on');return el?el.textContent:'';})()`);
  ck('切换按钮高亮跟随', on === '近 90 日', '当前高亮：' + on);
  const stick = await ev(`(function(){const el=document.querySelector('#baseScroll .rng-bar');if(!el)return 'no';return getComputedStyle(el).position;})()`);
  ck('口径切换器吸顶', stick === 'sticky', stick);

  console.log('\n【9】驾驶舱结论随口径变化');
  const I7 = await ev(`dashRange('7d').insight.map(function(x){return x.t;}).join('|')`);
  const I30 = await ev(`dashRange('30d').insight.map(function(x){return x.t;}).join('|')`);
  ck('7日与30日诊断结论不同（核销在途判定生效）', I7 !== I30, I7 + '  ⇄  ' + I30);
  ck('7日 能识别「在途折损」', /在途/.test(I7), I7);

  console.log('\n【10】审核统计派生（百分比与件数一致）');
  const A = await ev(`(function(){const S=DB.x.auditStat;
    return {done:S.done,mix:S.mix.reduce(function(a,x){return a+x.n2;},0),pass:Math.round(S.done*S.passPct/100)};})()`);
  ck('构成件数合计 = 已审总数', A.mix === A.done, A.mix + ' vs ' + A.done);

  console.log('\n【11】口径 → 测算器闭环');
  await ev(`setDashRange('30d')`); await sleep(400);
  await ev(`setTab('calc')`); await sleep(500);
  const before = await ev(`DB.admin.calc.orders + '/' + DB.admin.calc.price`);
  await ev(`calcFromRange()`); await sleep(600);
  const after = await ev(`DB.admin.calc.orders + '/' + DB.admin.calc.price`);
  ck('代入后测算参数被改写', before !== after, before + ' → ' + after);
  const cv = await ev(`(function(){const el=document.querySelector('#cv_orders');return el?el.textContent:'';})()`);
  ck('滑块读数同步刷新', cv !== '', '月订单显示 ' + cv);

  console.log('\n【12】趋势轴一致：每列都是「日均」，尾列天数不足也不塌陷');
  const AX = await ev(`(function(){
    const out={};
    ['7d','30d','mtd','90d'].forEach(function(k){
      const r=dashRange(k), it=r.trend.items, last=it[it.length-1];
      out[k]={tv:r.tv, per:r.trend.per, n:it.length,
        lastV:last.v, lastDays:last.days, lastSum:last.sum,
        okDaily: it.every(function(x){ return Math.abs(x.v - x.sum/x.days/1000) < 1e-9; })};
    });
    return out; })()`);
  ck('各口径日均目标恒定（目标线是同一水平线）',
    Math.abs(AX['7d'].tv - AX['30d'].tv) < 1e-9 && Math.abs(AX['30d'].tv - AX['90d'].tv) < 1e-9 && Math.abs(AX['90d'].tv - AX['mtd'].tv) < 1e-9,
    'tv = ' + AX['7d'].tv + ' 千元/日（四口径一致）');
  ck('每列 v 严格等于 sum ÷ 天数 ÷ 1000（无混用合计口径）',
    ['7d','30d','mtd','90d'].every(function(k){ return AX[k].okDaily; }));
  const shortTail = AX['mtd'].lastDays < AX['mtd'].per;
  ck('本月尾列天数不足一格（正是最容易塌陷的位置）', shortTail,
    '尾列 ' + AX['mtd'].lastDays + ' 天 / 每列 ' + AX['mtd'].per + ' 天');
  ck('尾列日均仍与相邻列同量级（未按合计口径塌陷）',
    AX['mtd'].lastV > AX['mtd'].tv * 0.6,
    '尾列日均 ' + AX['mtd'].lastV.toFixed(1) + ' vs 目标 ' + AX['mtd'].tv.toFixed(1));

  console.log('\n【13】在途折损按天数定量扣除（不是拍一个天数阈值）');
  const LAG = await ev(`(function(){
    const g=DB.x.goal.verify, o={};
    ['7d','30d','90d','mtd'].forEach(function(k){
      const r=dashRange(k), c=r.cur.verify;
      const drag=(1-LAG.factor)*Math.min(LAG.days,r.days)/r.days*100;
      const ins=r.insight.filter(function(x){return /核销/.test(x.t);})[0];
      o[k]={gap:c-g, drag:drag, title:ins?ins.t:'', lv:ins?ins.lv:''};
    });
    return o; })()`);
  ['7d','mtd','30d','90d'].forEach(function(k){
    ck(k + ' 核销判定与定量折损一致', (Math.abs(LAG[k].gap) <= LAG[k].drag + 0.3) === (LAG[k].lv !== 'bad'),
      '缺口 ' + LAG[k].gap.toFixed(1) + 'pp / 可解释 ' + LAG[k].drag.toFixed(1) + 'pp → ' + LAG[k].title);
  });
  ck('短口径折损额度大于长口径（区间越短虚低越明显）',
    LAG['7d'].drag > LAG['30d'].drag && LAG['30d'].drag > LAG['90d'].drag,
    '7d ' + LAG['7d'].drag.toFixed(2) + ' > 30d ' + LAG['30d'].drag.toFixed(2) + ' > 90d ' + LAG['90d'].drag.toFixed(2));

  ck('运行期无 JS 异常', errs.length === 0, errs.join(' | ') || '0 条');

  console.log('\n========================================');
  console.log('结果：' + PASS + ' PASS / ' + FAIL + ' FAIL');
  console.log('========================================');
  ws.close(); ch.kill();
  process.exit(FAIL ? 1 : 0);
})();
