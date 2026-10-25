/**
 * 顶部状态栏专项验收（v1.3 新增）
 * 背景：用户反馈「手机端顶部 CSS 显示异常」——时间/信号图标几乎不可见、底部露出色条
 * 根因：.statusbar 原为 flex 兄弟节点，底色恒为 --bg 浅灰，却按深色页设了白字
 * 修复：改为 absolute 浮层 + probeTopBg() 沿祖先链探测真实底色 + _lum() 判亮度决定字色
 * 本脚本对 8 个代表页断言：①状态栏为浮层 ②有安全区让位 ③字色与背景亮度相反 ④不被灵动岛压住
 */
const { spawn } = require('child_process');
const fs = require('fs'), fsx = require('fs'), pathx = require('path');
const { pathToFileURL } = require('url');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p=>fsx.existsSync(p))||'chrome';
const ROOT = pathx.resolve(__dirname,'..');
const HTML = pathToFileURL(pathx.join(ROOT,'向往的自由-业务系统demo-高保真版.html')).href;
const OUT = process.env.OUT || pathx.join(ROOT,'shots_sb');
const PORT = Number(process.env.PORT||9421);
const sleep = ms => new Promise(r=>setTimeout(r,ms));
if(!fsx.existsSync(OUT)) fsx.mkdirSync(OUT,{recursive:true});

let pass=0, fail=0;
function ok(c,name,extra){ if(c){pass++;console.log('  PASS  '+name);} else {fail++;console.log('  FAIL  '+name+(extra?'  → '+extra:''));} }

/* [标签, 初始化语句, 截图名] */
const CASES = [
  ['游客首页·橙Hero', `setEnd('tourist');setTab('home')`, 'sb1-tourist-home'],
  ['游客主题·浅底',   `setEnd('tourist');setTab('theme')`, 'sb2-tourist-theme'],
  ['游客钱包·浮层卡', `setEnd('tourist');setTab('wallet')`, 'sb3-tourist-wallet'],
  ['合伙人·收益',     `setEnd('partner');setTab('earn')`, 'sb4-partner-earn'],
  ['商户·工作台',     `setEnd('merch');setTab('work')`, 'sb5-merch-work'],
  ['运营·驾驶舱',     `setEnd('admin');setTab('dash')`, 'sb6-admin-dash'],
  ['子页·订单详情',   `setEnd('tourist');pushOrderDetailPage(0)`, 'sb7-subpage'],
  ['搜索页',          `setEnd('tourist');pushSearchPage('瑜伽')`, 'sb8-search'],
];

(async()=>{
  const chrome = spawn(CHROME,['--headless=new','--disable-gpu','--no-sandbox',`--remote-debugging-port=${PORT}`,'about:blank'],{stdio:'ignore'});
  let t=null;
  for(let i=0;i<40;i++){ await sleep(250); try{ const r=await fetch(`http://127.0.0.1:${PORT}/json/list`); t=await r.json(); if(t.find(x=>x.type==='page')) break; }catch(e){} }
  const ws = new WebSocket(t.find(x=>x.type==='page').webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
  let id=0; const pend=new Map(); const errs=[];
  ws.onmessage=e=>{ const m=JSON.parse(e.data);
    if(m.id&&pend.has(m.id)){const p=pend.get(m.id);pend.delete(m.id); m.error?p.rej(new Error(JSON.stringify(m.error))):p.res(m.result);}
    if(m.method==='Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.text); };
  const send=(m,p={})=>new Promise((res,rej)=>{const i=++id;pend.set(i,{res,rej});ws.send(JSON.stringify({id:i,method:m,params:p}));});
  const ev=async x=>{ const r=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true}); return r.exceptionDetails?{__err:(r.exceptionDetails.exception?.description||r.exceptionDetails.text).split('\n')[0]}:r.result.value; };
  const shot=async name=>{ const c=await ev(`(()=>{const r=document.querySelector('#screen').getBoundingClientRect();return{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)};})()`);
    const r=await send('Page.captureScreenshot',{format:'png',clip:{...c,scale:2},captureBeyondViewport:true});
    fs.writeFileSync(pathx.join(OUT,name+'.png'),Buffer.from(r.data,'base64')); };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:430,height:920,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:HTML}); await sleep(2400);
  await ev(`S.loggedIn=true;S.loginStep='role';document.querySelector('#loginLayer').classList.remove('on')`);
  await sleep(400);

  console.log('\n【A】状态栏结构（浮层化）');
  const sbStruct = await ev(`(()=>{const s=document.querySelector('.statusbar');const cs=getComputedStyle(s);return{pos:cs.position,z:cs.zIndex,h:Math.round(s.getBoundingClientRect().height),top:Math.round(s.getBoundingClientRect().top)};})()`);
  ok(sbStruct.pos==='absolute','状态栏为 absolute 浮层（不占流）','pos='+sbStruct.pos);
  ok(Number(sbStruct.z)>=70,'层级高于页面内容','z='+sbStruct.z);
  ok(sbStruct.top===0,'贴合屏幕顶部','top='+sbStruct.top);
  ok(Math.abs(sbStruct.h-44)<=2,'高度 44px 安全区','h='+sbStruct.h);

  console.log('\n【B】逐页：字色必须与顶部实际底色相反');
  for(const [name,setup,snap] of CASES){
    await ev(`closeSheet();document.querySelectorAll('#pageStack .page').forEach(p=>p.remove());S.stack=[];`);
    await ev(setup); await sleep(900);
    /* 完全复刻 autoSB() 的判定路径，算出「应该用什么字色」，再与实际字色比对 */
    const r = await ev(`(()=>{
      const s=document.querySelector('.statusbar'); const cs=getComputedStyle(s);
      const box=topScrollEl();
      let first=box?box.firstElementChild:null;
      if(first&&first.classList.contains('ptr')) first=first.nextElementSibling;
      const expectDark = S.stack.length ? false : (probeTopBg(first).dark);
      return {
        color: cs.color,
        expectDark,
        stackLen: S.stack.length,
        sbMode: S.sbMode,
        firstTag: first ? (first.tagName+'.'+(first.className||'').split(' ').slice(0,2).join('.')) : 'none',
        txt: (s.textContent||'').trim()
      };
    })()`);
    const isWhite = /255,\s*255,\s*255/.test(r.color);
    ok(isWhite===r.expectDark, `${name} 字色正确（${isWhite?'白':'深'}字/期望${r.expectDark?'白':'深'}）`, `color=${r.color} expect=${r.expectDark} sbMode=${r.sbMode} top=${r.firstTag}`);
    ok(r.txt.length>0, `${name} 时间/电量文本存在`, r.txt);
    await shot(snap);
  }

  console.log('\n【C】沉浸头部不被状态栏压住');
  const notch = await ev(`(()=>{ const n=document.querySelector('.notch');
    const t=document.querySelector('#pageStack .page:last-child .nav-title, .hero h1, .sec-title');
    if(!t) return {skip:true};
    const b=t.getBoundingClientRect();
    if(!n) return {skip:true, top:Math.round(b.top), title:t.textContent.trim().slice(0,20)};
    const nb=n.getBoundingClientRect();
    const overlap = !(b.right < nb.left || b.left > nb.right || b.bottom < nb.top || b.top > nb.bottom);
    return {overlap, top:Math.round(b.top), title:t.textContent.trim().slice(0,20)}; })()`);
  if(!notch.skip) ok(!notch.overlap, '子页 navbar 标题未被灵动岛压住', notch.title+' top='+notch.top);
  else console.log('  · 灵动岛已移除（v1.4.2），跳过遮挡断言');

  console.log('\n【D】运行时异常');
  ok(errs.length===0,'无未捕获异常',errs.slice(0,2).join(' || '));

  console.log('\n────────────────────────');
  console.log(`状态栏专项验收：PASS ${pass} / FAIL ${fail}`);
  ws.close(); chrome.kill(); process.exit(fail?1:0);
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
