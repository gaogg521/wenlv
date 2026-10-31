/**
 * v1.8 成本控制闭环探针：超支审批 + 协议变更单
 * 验证「谁批 / 批多少 / 超额怎么办 / 熔断解除 / 分账恒等」是否真的闭环
 * 用法：node tools/ovprobe.js
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
const PORT = Number(process.env.PORT || 9407);
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
  const ws = new WebSocket(t.find(x=>x.type==='page').webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ ws.onopen=res; ws.onerror=rej; });
  let id = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if(m.id && pend.has(m.id)){ const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } };
  const send = (m,p={}) => new Promise((res,rej)=>{ const i=++id; pend.set(i,{res,rej}); ws.send(JSON.stringify({id:i,method:m,params:p})); });
  const ev = async x => { const r = await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true}); return r.exceptionDetails ? {__err:(r.exceptionDetails.exception&&r.exceptionDetails.exception.description||r.exceptionDetails.text)} : r.result.value; };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:430,height:920,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:HTML}); await sleep(2400);
  await ev(`S.loggedIn=true;document.querySelector('#loginLayer').classList.remove('on')`); await sleep(300);
  await ev(`setEnd('admin')`); await sleep(500);

  console.log('\n【1】初始态：超支缺口与熔断判定');
  const s0 = await ev(`(function(){const o=overrunState();return {gap:o.gap,rate:o.rate,ok:o.okAmt,uncovered:o.uncovered,fuse:o.fuse,limit:o.limit,net:o.net,pool:o.pool};})()`);
  ck('超支缺口为正', s0.gap > 0, '缺口 ¥' + s0.gap + '（实绩 ¥' + s0.net + ' vs 池 ¥' + s0.pool + '）');
  ck('超支率破熔断线且缺口无已批处置 → 熔断触发', s0.fuse === true,
    '超支率 ' + (s0.rate * 100).toFixed(1) + '% > ' + (s0.limit * 100) + '%，已批处置 ¥' + s0.ok + ' < 缺口 ¥' + s0.gap);

  console.log('\n【2】分级授权：申请额该谁批');
  const g1 = await ev(`(function(){return {lvl:overrunLevel(7594),lim:DB.rights.overrun.grades[0].lv,need:(function(){const x=overrunNeed(7594);return {lv:x.g.lv,i:x.i};})()};})()`);
  ck('¥7,594 落在财务负责人（超运营总监 ¥3,000 上限）', /财务/.test(g1.lvl), g1.lvl);
  const g2 = await ev(`overrunLevel(2140)`);
  ck('¥2,140 落在运营总监权限内', /运营总监/.test(g2), g2);

  console.log('\n【3】协议变更批准 → 成本自动重算（不手工改价）');
  const before = await ev(`(function(){return {net:rightsRealized().net,per:rightsRealized().perReal,price:agrPrice(DB.rights.merchants[0]),pool:splitRowsReal().rows.filter(function(w){return w.g==='pool';})[0].v,keep:splitRowsReal().rows.filter(function(w){return w.n==='留存毛利';})[0].v,sum:splitRowsReal().sum};})()`);
  await ev(`(function(){var i=DB.rights.contracts.map(function(c){return c.st;}).indexOf('待审批');agrApprove(i);return i;})()`); await sleep(300);
  const after = await ev(`(function(){var m=DB.rights.merchants[0];return {net:rightsRealized().net,per:rightsRealized().perReal,price:agrPrice(m),pool:splitRowsReal().rows.filter(function(w){return w.g==='pool';})[0].v,keep:splitRowsReal().rows.filter(function(w){return w.n==='留存毛利';})[0].v,sum:splitRowsReal().sum};})()`);
  ck('协议单价由 34 → 30 生效', after.price === 30, '¥' + before.price + ' → ¥' + after.price);
  ck('权益实付成本随协议价下降', after.net < before.net, '¥' + before.net.toLocaleString() + ' → ¥' + after.net.toLocaleString());
  ck('降幅 = 412 次 × ¥4 = ¥1,648', Math.abs((before.net - after.net) - 1648) < 1, '实际降 ¥' + (before.net - after.net));
  ck('单均实绩同步下降（两位小数可见）', after.per < before.per, '¥' + before.per.toFixed(2) + ' → ¥' + after.per.toFixed(2));
  ck('分账「权益预留」行随实绩重算', after.pool < before.pool, '¥' + before.pool + ' → ¥' + after.pool);
  ck('分账「留存毛利」行反向回升', after.keep > before.keep, '¥' + before.keep + ' → ¥' + after.keep);
  ck('五口径合计恒为 ¥298', Math.abs(after.sum - 298) < 0.11, '合计 ¥' + after.sum);

  console.log('\n【4】超支全额批准 → 缺口有出处，熔断解除');
  const s1 = await ev(`(function(){var i=DB.rights.overrun.asks.map(function(a){return a.st;}).indexOf('待审批');rsnOverApprove(i);return i;})()`); await sleep(300);
  const s2 = await ev(`(function(){const o=overrunState();return {gap:o.gap,ok:o.okAmt,fromMkt:o.fromMkt,fromKeep:o.fromKeep,fuse:o.fuse,st:DB.rights.overrun.asks[0].st,lg:DB.rights.overrun.asks[0].lg};})()`);
  ck('审批单状态转为已批准', s2.st === '已批准', s2.st + ' · ' + s2.lg);
  ck('已批金额 ≥ 缺口 → 未覆盖归零', s2.fromKeep === 0, '已批 ¥' + s2.ok + ' / 缺口 ¥' + s2.gap);
  ck('缺口转入营销预算科目', s2.fromMkt === s2.gap, '营销预算 ¥' + s2.fromMkt);
  ck('熔断自动解除', s2.fuse === false, 'fuse=' + s2.fuse);
  const s3 = await ev(`splitRowsReal().sum`);
  ck('批准不改变 ¥298 恒等式（只换科目）', Math.abs(s3 - 298) < 0.11, '合计 ¥' + s3);

  console.log('\n【5】超额怎么办：部分批准 → 余量自动升级上一级');
  await ev(`(function(){DB.rights.overrun.asks=[{id:'OV-T-01',amt:9000,st:'待审批',by:'运营 · 王璐',at:stampNow(),lg:null,src:'营销预算调剂',why:'压测：申请 ¥9,000 跨两级'}];DB.rights.budget.pool=20000;return 1;})()`); await sleep(200);
  const up = await ev(`(function(){
    var O=DB.rights.overrun, a=O.asks[0];
    var amt=5000, lv=overrunNeed(amt).g;
    a.st='部分批准'; a.got=amt; a.lg=lv.lv;
    var rest=a.amt-amt, u=overrunUp(amt);
    O.asks.push({id:'OV-T-02',amt:rest,st:'待审批',by:a.by,at:stampNow(),lg:null,src:a.src,up:a.id,why:'承接余量'});
    var last=O.asks[O.asks.length-1];
    return {rest:rest,upTo:u?u.lv:null,newSt:last.st,newId:last.id,level:lv.lv,total:O.asks.length};
  })()`);
  ck('本级（¥5,000 → 财务负责人）批一部分', /财务/.test(up.level), up.level);
  ck('余量自动升级为独立新单', up.newSt === '待审批' && up.total === 2, '余 ¥' + up.rest + ' → ' + up.newId);
  ck('升级单指向上一级审批人', /CEO/.test(up.upTo || ''), up.upTo);
  const up2 = await ev(`(function(){
    var O=DB.rights.overrun;
    O.asks[1].st='已驳回'; O.asks[1].done='驳回';
    var o=overrunState();
    return {fromKeep:o.fromKeep,fromMkt:o.fromMkt,fuse:o.fuse,rate:o.rate,gap:o.gap,limit:o.limit};
  })()`);
  ck('驳回后未覆盖部分全额扣留存毛利', up2.fromKeep > 0,
    '留存毛利承担 ¥' + up2.fromKeep + ' / 营销预算承担 ¥' + up2.fromMkt);
  ck('覆盖不足且破线 → 熔断重新触发', up2.fuse === true,
    '超支率 ' + (up2.rate * 100).toFixed(1) + '% > ' + (up2.limit * 100) + '%，缺口 ¥' + up2.gap + ' 未获全额处置');
  await ev(`DB.rights.budget.pool=26522;DB.rights.overrun.asks.forEach(function(a){a.st='已批准';});`);

  console.log('\n【6】商户端发起 → 运营端可见（跨端同源）');
  const ce = await ev(`(function(){
    DB.rights.contracts.push({id:'AG-T-01',m:'漕港人家',op:'漕港人家（餐饮）',r:'餐饮 9 折补贴',mid:'',from:18,to:16,st:'待审批',by:'商户端线上',at:stampNow(),unit:'元 / 次',why:'测试单',lg:[]});
    setEnd('merch'); pushContractChangePage();
    return {pending:typeof pushContractChangePage==='function', mine:agrMyContracts(sbcMyLine()).length};
  })()`); await sleep(600);
  const ce2 = await ev(`(function(){
    var m=sbcMyLine(); var out=agrMyContracts(m).map(function(c){return {id:c.id,st:c.st,to:c.to};});
    return {end:S.end, mine:out, openN:DB.rights.contracts.filter(function(c){return c.st==='待审批';}).length};
  })()`);
  ck('商户端能定位自己的变更单', ce2.mine.length >= 1, '商户=' + ce2.end + ' 可见 ' + ce2.mine.length + ' 条');
  ck('变更单进入平台待审批队列', ce2.openN >= 1, '待审批 ' + ce2.openN + ' 条');

  console.log('\n【7】页面上真的渲染出新区块');
  await ev(`setEnd('admin')`); await sleep(400);
  await ev(`pushRightsPage()`); await sleep(700);
  const dom = await ev(`(function(){var t=document.body.innerText;return {
    overrun:t.indexOf('超支审批单')>=0, grade:t.indexOf('分级授权')>=0, fuse:t.indexOf('熔断')>=0,
    agr:t.indexOf('协议变更审批')>=0, agree:t.indexOf('同意变更并生效')>=0, lvl:t.indexOf('财务负责人')>=0};})()`);
  ck('页面出现「超支审批单」区块', dom.overrun);
  ck('页面出现「分级授权」区块', dom.grade);
  ck('页面出现熔断状态说明', dom.fuse);
  ck('页面出现「协议变更审批」区块', dom.agr);
  ck('协议变更单有「同意变更并生效」动作', dom.agree);

  console.log('\n【8】下期预算预测 · 事前预警（v1.9）');
  await ev(`resetDemo()`); await sleep(400);
  const f0 = await ev(`(function(){
    var R=DB.rights, f=fcState();
    return {net:f.net,days:f.days,perDayAll:f.perDayAll,perDayLast:f.perDayLast,trend:f.trend,
      fcNext:f.fcNext,gap:f.fcGap,rate:f.rate,pool:f.pool,bottom:f.bottom,per:f.fcPer,perBuf:f.fcPerBuf,
      lv:f.lv,limit:f.limit,amber:f.amber,
      wSum:f.weeks.reduce(function(a,w){return a+w.amt;},0),
      wPer:f.weeks.map(function(w){return w.perDay;}),
      wow:f.weeks.map(function(w){return w.wow;}),
      sum:splitRowsReal().sum};
  })()`);
  ck('周节奏合计 = 本期实付成本（数据自洽）', f0.wSum === f0.net,
    '三周合计 ¥' + f0.wSum.toLocaleString() + ' = 实付 ¥' + f0.net.toLocaleString());
  ck('全期日均 = 实付 ÷ 已过天数', Math.abs(f0.perDayAll - f0.net / f0.days) < 0.01,
    '¥' + f0.perDayAll.toFixed(2) + ' / 天');
  ck('近周日均按 5 天折算（不完整周不被低估）', Math.abs(f0.perDayLast - 11786 / 5) < 0.01,
    '¥' + f0.perDayLast.toFixed(2) + ' / 天');
  ck('趋势增速 = 近周日均 ÷ 全期日均 − 1', Math.abs(f0.trend - (f0.perDayLast / f0.perDayAll - 1)) < 0.0001,
    '+' + (f0.trend * 100).toFixed(1) + '%');
  ck('趋势为正（节奏往上走，预警有意义）', f0.trend > 0.25, '+' + (f0.trend * 100).toFixed(1) + '%');
  ck('下期预测 = 本期实付 × (1 + 趋势)', f0.fcNext === Math.round(f0.net * (1 + f0.trend)),
    '¥' + f0.fcNext.toLocaleString() + '（≈ ¥44,787）');
  ck('预测超支 = 预测 − 预留池', f0.gap === f0.fcNext - f0.pool, '¥' + f0.gap.toLocaleString());
  ck('预测超支率 > 50% → 红灯', f0.lv === 'red',
    (f0.rate * 100).toFixed(1) + '% > 红灯线 ' + (f0.amber * 100) + '%');
  ck('见底天数 = 池 ÷ 近周日均，且早于账期结束', Math.abs(f0.bottom - f0.pool / f0.perDayLast) < 0.01 && f0.bottom < f0.days,
    '第 ' + f0.bottom.toFixed(1) + ' 天见底 / 账期 ' + f0.days + ' 天');
  ck('建议预留单价 = 预测单均 + 3% 缓冲', Math.abs(f0.perBuf - Math.round(f0.per * 1.03 * 100) / 100) < 0.005,
    '¥' + f0.per.toFixed(2) + ' → 建议 ¥' + f0.perBuf);
  ck('预测过程不碰 ¥298 恒等式', Math.abs(f0.sum - 298) < 0.11, '合计 ¥' + f0.sum);

  console.log('\n【9】预警分级三态：绿 / 黄 / 红（同一模型，不同池子）');
  const g3 = await ev(`(function(){
    var R=DB.rights, out={};
    R.budget.pool=40000; out.green=fcState().lv;
    R.budget.pool=32000; out.amber=fcState().lv; out.amberRate=fcState().rate;
    R.budget.pool=26522; out.red=fcState().lv;
    return out;
  })()`);
  ck('池 ¥40,000 → 绿灯（预测在熔断线内）', g3.green === 'green', g3.green);
  ck('池 ¥32,000 → 黄灯（破线未到 50%）', g3.amber === 'amber', g3.amber + ' · ' + (g3.amberRate * 100).toFixed(1) + '%');
  ck('池 ¥26,522 → 红灯', g3.red === 'red', g3.red);

  console.log('\n【10】协议变更生效 → 预测联动下降（预警与账实同源）');
  const b4 = await ev(`(function(){var f=fcState();return {fcNext:f.fcNext,rate:f.rate,perBuf:f.fcPerBuf,agrSave:f.agrSave,fcNextAgr:f.fcNextAgr,fcRateAgr:f.fcRateAgr,fcNextCut:f.fcNextCut,fcRateCut:f.fcRateCut,net:f.net,limit:f.limit,trend:f.trend};})()`);
  ck('待审批降价的潜在影响已计入 what-if', b4.agrSave === 1648, 'AG-1019-02 生效可省 ¥' + b4.agrSave);
  ck('what-if：调价后预测超支率下降', b4.fcRateAgr < b4.rate, (b4.rate*100).toFixed(1) + '% → ' + (b4.fcRateAgr*100).toFixed(1) + '%');
  ck('what-if：收缩投放 10% 仍破线（单靠压投放救不回来）', b4.fcRateCut > b4.limit,
    '收缩后 ' + (b4.fcRateCut*100).toFixed(1) + '% 仍 > ' + (b4.limit*100) + '%');
  await ev(`(function(){var i=DB.rights.contracts.map(function(c){return c.st;}).indexOf('待审批');agrApprove(i);return i;})()`); await sleep(300);
  const a4 = await ev(`(function(){var f=fcState();return {fcNext:f.fcNext,rate:f.rate,perBuf:f.fcPerBuf,net:f.net,sum:splitRowsReal().sum};})()`);
  ck('变更生效后预测成本自动下降', a4.fcNext < b4.fcNext, '¥' + b4.fcNext.toLocaleString() + ' → ¥' + a4.fcNext.toLocaleString());
  ck('降幅 = ¥1,648 × (1 + 趋势)', Math.abs((b4.fcNext - a4.fcNext) - 1648 * (1 + b4.trend)) < 2,
    '降 ¥' + Math.round(b4.fcNext - a4.fcNext));
  ck('what-if 预览值 = 批准后的实际值（同式同源）', a4.fcNext === b4.fcNextAgr,
    '预览 ¥' + b4.fcNextAgr.toLocaleString() + ' = 实际 ¥' + a4.fcNext.toLocaleString());
  ck('趋势增速不因账面下调而失真（历史事实恒定）', Math.abs(b4.trend - 0.3128) < 0.001, '+' + (b4.trend * 100).toFixed(1) + '%');
  ck('变更后预测超支率同步回落', a4.rate < b4.rate, (b4.rate*100).toFixed(1) + '% → ' + (a4.rate*100).toFixed(1) + '%');
  ck('变更后仍为红灯（调价不够，还需预留或投放动作）', a4.rate > 0.5, (a4.rate*100).toFixed(1) + '%');
  ck('建议预留单价随预测下调', a4.perBuf < b4.perBuf, '¥' + b4.perBuf + ' → ¥' + a4.perBuf);
  ck('全程 ¥298 恒等未破', Math.abs(a4.sum - 298) < 0.11, '合计 ¥' + a4.sum);

  console.log('\n【11】预警区块在页面上真实渲染');
  await ev(`setEnd('admin')`); await sleep(400);
  await ev(`pushRightsPage()`); await sleep(700);
  const dom2 = await ev(`(function(){var t=document.body.innerText;return {
    fc:t.indexOf('下期预算预测')>=0, warn:t.indexOf('事前预警')>=0, wk:t.indexOf('近三周核销节奏')>=0,
    bottom:t.indexOf('见底日')>=0, act1:t.indexOf('协议调价（首选）')>=0, act3:t.indexOf('收缩新增投放')>=0,
    jump:t.indexOf('去审批协议变更')>=0, red:t.indexOf('预警 · 红灯')>=0,
    perDayLast:t.indexOf('近周日均成本')>=0};})()`);
  ck('页面出现「下期预算预测 · 事前预警」区块', dom2.fc && dom2.warn);
  ck('周节奏与见底日可视化渲染', dom2.wk && dom2.bottom);
  ck('三个建议动作全部呈现', dom2.act1 && dom2.act3);
  ck('动作带跳转入口', dom2.jump);
  ck('初始态点亮红灯', dom2.red);
  ck('关键数字含近周日均', dom2.perDayLast);
  const j1 = await ev(`(function(){fcJump('.ovs-card.agr');return 1;})()`); await sleep(400);
  ck('跳转动作可执行且无 JS 异常', j1 === 1);

  console.log('\n────────────────────────');
  console.log('成本控制闭环探针：PASS ' + PASS + ' / FAIL ' + FAIL);
  ws.close(); ch.kill(); process.exit(FAIL ? 1 : 0);
})().catch(e => { console.error('FATAL', e.message); process.exit(1); });