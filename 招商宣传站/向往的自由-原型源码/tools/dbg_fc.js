/* 一次性调试：复现 ovprobe 第 10 段的 agrApprove 失效 */
const { spawn } = require('child_process');
const fsx = require('fs'); const pathx = require('path'); const { pathToFileURL } = require('url');
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p=>fsx.existsSync(p)) || 'chrome';
const HTML = pathToFileURL(pathx.resolve(__dirname,'..','向往的自由-业务系统demo-高保真版.html')).href;
const PORT = Number(process.env.PORT || 9455);
const sleep = ms => new Promise(r=>setTimeout(r,ms));
(async () => {
  const ch = spawn(CHROME, ['--headless=new','--disable-gpu','--no-sandbox',`--remote-debugging-port=${PORT}`,'about:blank'], {stdio:'ignore'});
  let t=null;
  for(let i=0;i<40;i++){ await sleep(250); try{ const r=await fetch(`http://127.0.0.1:${PORT}/json/list`); t=await r.json(); if(t.find(x=>x.type==='page')) break; }catch(e){} }
  const ws = new WebSocket(t.find(x=>x.type==='page').webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ ws.onopen=res; ws.onerror=rej; });
  let id=0; const pend=new Map();
  ws.onmessage = e => { const m=JSON.parse(e.data); if(m.id&&pend.has(m.id)){ const p=pend.get(m.id); pend.delete(m.id); m.error?p.rej(new Error(JSON.stringify(m.error))):p.res(m.result); } };
  const send=(m,p={})=>new Promise((res,rej)=>{ const i=++id; pend.set(i,{res,rej}); ws.send(JSON.stringify({id:i,method:m,params:p})); });
  const ev = async x => { const r=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true}); return r.exceptionDetails ? {__err:(r.exceptionDetails.exception&&r.exceptionDetails.exception.description||r.exceptionDetails.text)} : r.result.value; };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:430,height:920,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:HTML}); await sleep(2400);
  await ev(`S.loggedIn=true;document.querySelector('#loginLayer').classList.remove('on')`);
  await ev(`setEnd('admin')`); await sleep(400);

  console.log('A 初始 contracts:', JSON.stringify(await ev(`DB.rights.contracts.map(c=>({id:c.id,st:c.st,to:c.to,from:c.from}))`)));
  console.log('B net 初始:', await ev(`rightsRealized().net`));
  const r1 = await ev(`(function(){var i=DB.rights.contracts.map(function(c){return c.st;}).indexOf('待审批');agrApprove(i);return i;})()`);
  console.log('C agrApprove 返回:', r1);
  console.log('D net 批准后:', await ev(`rightsRealized().net`));
  console.log('E 朱家角 amt:', await ev(`DB.rights.merchants[0].amt`));
  console.log('F fcState:', JSON.stringify(await ev(`(function(){var f=fcState();return {fcNext:f.fcNext,net:f.net,trend:f.trend,pool:f.pool};})()`)));
  // 复现 resetDemo 后再批
  await ev(`resetDemo()`); await sleep(400);
  console.log('G reset 后 contracts:', JSON.stringify(await ev(`DB.rights.contracts.map(c=>({id:c.id,st:c.st}))`)));
  console.log('H reset 后 net:', await ev(`rightsRealized().net`));
  const r2 = await ev(`(function(){var i=DB.rights.contracts.map(function(c){return c.st;}).indexOf('待审批');agrApprove(i);return i;})()`);
  console.log('I reset 后 agrApprove 返回:', r2);
  console.log('J reset 后 net:', await ev(`rightsRealized().net`));
  console.log('K 朱家角 amt:', await ev(`DB.rights.merchants[0].amt`));
  ws.close(); ch.kill(); process.exit(0);
})().catch(e=>{ console.error('FATAL', e.message); process.exit(1); });
