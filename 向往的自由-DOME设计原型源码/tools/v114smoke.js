/**
 * 三端重构冒烟测试（v1.14）
 * 背景：依据《项目总方案定稿 V3.0》§2.2 / D1，demo 从「4 端」重构为「3 个客户端」
 *   - 删除独立「合伙人端」，其功能并入小程序 A 的「我的 → 推广中心」
 *   - 游客端 tabBar 5 → 4（商城改为二级页）
 *   - 登录身份卡 4 → 3
 * 本脚本只验证重构没有把路走断：登录三端可达、推广中心三段可切、商城可达、
 * 原合伙人的子页仍可达、无 JS 运行时异常。
 */
const { spawn } = require('child_process');
const fs = require('fs'), pathx = require('path');
const { pathToFileURL } = require('url');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p=>fs.existsSync(p))||'chrome';
const ROOT = pathx.resolve(__dirname,'..');
const HTML = pathToFileURL(pathx.join(ROOT,'向往的自由-业务系统demo-高保真版.html')).href;
const OUT = process.env.OUT || pathx.join(ROOT,'shots_v114');
const PORT = Number(process.env.PORT||9455);
const sleep = ms => new Promise(r=>setTimeout(r,ms));
if(!fs.existsSync(OUT)) fs.mkdirSync(OUT,{recursive:true});

let pass=0, fail=0;
function ok(c,name,extra){ if(c){pass++;console.log('  PASS  '+name);} else {fail++;console.log('  FAIL  '+name+(extra?'  → '+extra:''));} }

(async()=>{
  const chrome = spawn(CHROME,['--headless=new','--disable-gpu','--no-sandbox',`--remote-debugging-port=${PORT}`,'about:blank'],{stdio:'ignore'});
  let t=null;
  for(let i=0;i<40;i++){ await sleep(250); try{ const r=await fetch(`http://127.0.0.1:${PORT}/json/list`); t=await r.json(); if(t.find(x=>x.type==='page')) break; }catch(e){} }
  const ws = new WebSocket(t.find(x=>x.type==='page').webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
  let id=0; const pend=new Map(); const errs=[];
  ws.onmessage=e=>{ const m=JSON.parse(e.data);
    if(m.id&&pend.has(m.id)){const p=pend.get(m.id);pend.delete(m.id); m.error?p.rej(new Error(JSON.stringify(m.error))):p.res(m.result);}
    if(m.method==='Runtime.exceptionThrown') errs.push((m.params.exceptionDetails.exception&&m.params.exceptionDetails.exception.description||m.params.exceptionDetails.text).split('\n')[0]); };
  const send=(m,p={})=>new Promise((res,rej)=>{const i=++id;pend.set(i,{res,rej});ws.send(JSON.stringify({id:i,method:m,params:p}));});
  const ev=async x=>{ const r=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true}); return r.exceptionDetails?{__err:(r.exceptionDetails.exception&&r.exceptionDetails.exception.description||r.exceptionDetails.text).split('\n')[0]}:r.result.value; };
  const shot=async name=>{ const c=await ev(`(()=>{const r=document.querySelector('#screen').getBoundingClientRect();return{x:Math.round(r.x),y:Math.round(r.y),width:Math.round(r.width),height:Math.round(r.height)};})()`);
    const r=await send('Page.captureScreenshot',{format:'png',clip:{...c,scale:2},captureBeyondViewport:true});
    fs.writeFileSync(pathx.join(OUT,name+'.png'),Buffer.from(r.data,'base64')); };
  /* 等页面切入动画落定：380ms translateX(100%)→0，固定 sleep 在机器忙时会测到滑入中途 */
  const settle=async()=>{ for(let k=0;k<25;k++){ const tr=await ev(`(function(){var p=document.querySelector('#pageStack .page:last-child');return p?getComputedStyle(p).transform:'none';})()`);
      if(!tr||tr==='none'||/matrix\(1,\s*0,\s*0,\s*1,\s*0,\s*0\)/.test(tr)) return; await sleep(60);} };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:430,height:920,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:HTML}); await sleep(2400);
  await ev(`S.loggedIn=true;S.loginStep='role';document.querySelector('#loginLayer').classList.remove('on')`);
  await sleep(400);

  console.log('\n【A】端定义已变为 3 个客户端');
  const ends = await ev(`Object.keys(ENDS)`);
  ok(ends.length===3,'ENDS 只有 3 个端（游客 / 商户 / 运营）','keys='+ends.join(','));
  ok(ends.indexOf('partner')<0,'独立「合伙人端」已删除');
  const tabs = await ev(`ENDS.tourist.tabs.map(t=>t.k).join(',')`);
  ok(tabs==='home,theme,shop,wallet,me','游客端 tabBar 5 个，商城在一级位（v1.14.1 赵老师拍板回 tab）','tabs='+tabs);
  const merchTabs = await ev(`ENDS.merch.tabs.map(t=>t.k).join(',')`);
  ok(merchTabs==='work,order,supply,mme','商户端 4 tab 未受影响','tabs='+merchTabs);
  const adminTabs = await ev(`ENDS.admin.tabs.map(t=>t.k).join(',')`);
  ok(adminTabs==='dash,risk,audit,calc,ame','运营后台 5 tab 未受影响','tabs='+adminTabs);

  console.log('\n【B】登录身份卡 4 → 3');
  const roles = await ev(`LOGIN_ROLES.map(r=>r.k).join(',')`);
  ok(roles==='tourist,merch,admin','身份卡 3 张：游客 / 商家 / 平台运营','roles='+roles);
  const loginDesc = await ev(`(document.querySelector('.login-desc')||{}).textContent||''`);
  ok(loginDesc.indexOf('三个客户端')>=0,'登录页文案已说明「4 角色 = 3 客户端」',loginDesc.slice(0,40));

  console.log('\n【C】三个端都能进得去');
  for(const k of ['tourist','merch','admin']){
    await ev(`setEnd('${k}')`); await sleep(320);
    const nm = await ev(`ENDS[S.end].name`);
    const tabN = await ev(`document.querySelectorAll('#tabBar .tab').length`);
    ok(nm.length>0 && tabN>0, k+' 端可进入（'+nm+' · '+tabN+' 个 tab）');
  }

  console.log('\n【D】推广中心：原合伙人端三段全部可达');
  await ev(`setEnd('tourist');setTab('me');clearStack()`); await sleep(300);
  const hasEntry = await ev(`document.querySelector('[onclick*="pushPromoCenter"]')?1:0`);
  ok(hasEntry===1,'「我的」页有「推广中心」入口');
  await ev(`pushPromoCenter()`); await settle(); await sleep(200);
  const promoTitle = await ev(`(document.querySelector('#pageStack .page:last-child .nav-title')||{}).textContent||''`);
  ok(promoTitle==='推广中心','推广中心作为二级页打开','title='+promoTitle);
  for(const seg of ['earn','invite','team']){
    await ev(`promoTabSwitch('${seg}')`); await sleep(260);
    const on = await ev(`S.promoTab`);
    const chip = await ev(`(document.querySelector('#pageStack .page:last-child .chip.on')||{}).textContent||''`);
    ok(on===seg && chip.length>0, '推广中心分段「'+seg+'」可切换（当前：'+chip+'）');
  }
  await shot('1-promo-center');

  console.log('\n【E】推广中心里的原子页仍可达');
  for(const [label, fn] of [['收益明细','pushEarnDetailPage()'],['我的推广','pushPromoMePage()'],['等级规则','pushLevelRulePage()'],['邀请海报','pushPosterPage()'],['类型图鉴','pushTypesPage()'],['提现弹层','openWithdrawSheet()']]){
    const r = await ev(`(function(){try{ ${fn}; return 'ok'; }catch(e){ return ''+e; }})()`);
    ok(r==='ok', label+' 可打开', r==='ok'?'':r);
    await ev(`clearStack()`); await sleep(200);
  }

  console.log('\n【F】商城回 tabBar 一级位后仍可达（v1.14.1 赵老师拍板）');
  await ev(`setEnd('tourist');setTab('wallet');clearStack()`); await sleep(300);
  const shopEntry = await ev(`(function(){var els=document.querySelectorAll('.use-item');for(var i=0;i<els.length;i++){if(els[i].getAttribute('onclick')==="jumpTab('shop')")return 1;}return 0;})()`);
  ok(shopEntry===1,'旅豆页「商城好物」入口在');
  const tabShop = await ev(`(function(){var i=Array.from(document.querySelectorAll('#tabBar .tab')).findIndex(function(t){return /商城/.test(t.textContent);});return i;})()`);
  ok(tabShop>=0,'tabBar 有「商城」一级位（索引 '+tabShop+'）');
  await ev(`setTab('shop')`); await settle(); await sleep(200);
  const shopTitle = await ev(`(document.querySelector('#baseScroll .shop-hero h3')||{}).textContent||''`);
  ok(/旅行场景爆品商城/.test(shopTitle),'商城作为 tab 首屏渲染','title='+shopTitle);
  const chipCnt = await ev(`document.querySelectorAll('#baseScroll .chip').length`);
  ok(chipCnt>1,'商城分类 chip 渲染 '+chipCnt+' 个');
  await ev(`shopCat='outdoor';renderBase()`); await sleep(240);
  const afterSwitch = await ev(`(function(){var b=document.querySelector('#baseScroll');return {cat:shopCat, on:(b.querySelector('.chip.on')||{}).textContent||'', alive:b.children.length>0, prod:b.querySelectorAll('.prod').length};})()`);
  ok(afterSwitch.cat==='outdoor' && afterSwitch.on==='户外装备' && afterSwitch.alive,'商城内切换分类正常（页内重绘）','on='+afterSwitch.on+' · 商品 '+afterSwitch.prod+' 件');
  await shot('2-shop-tab');
  await ev(`setTab('home')`);

  console.log('\n【G】首页与主题游未受影响');
  await ev(`setEnd('tourist');setTab('home')`); await sleep(320);
  const homeOk = await ev(`document.querySelectorAll('#baseScroll .hero').length===1 && document.querySelectorAll('#baseScroll .cat').length>0`);
  ok(homeOk,'游客首页正常渲染');
  await ev(`setTab('theme')`); await sleep(320);
  const themeOk = await ev(`document.querySelectorAll('#baseScroll .tour, #baseScroll .tl').length>0`);
  ok(themeOk,'主题游列表正常渲染');

  console.log('\n【H】运行时异常');
  ok(errs.length===0,'无未捕获异常', errs.slice(0,3).join(' | '));

  console.log('\n────────────────────────');
  console.log('三端重构冒烟：PASS '+pass+' / FAIL '+fail);
  chrome.kill();
  process.exit(fail?1:0);
})().catch(e=>{ console.error('脚本异常：'+e.message); process.exit(2); });
