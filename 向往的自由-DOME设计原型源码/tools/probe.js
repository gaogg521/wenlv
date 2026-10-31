const { spawn } = require('child_process');
const fsx = require('fs');
const pathx = require('path');
const { pathToFileURL } = require('url');
const CHROME = process.env.CHROME || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find(function(p){ return fsx.existsSync(p); }) || 'chrome';
const HTML = process.env.HTML || pathToFileURL(
  pathx.resolve(__dirname, '..', '向往的自由-业务系统demo-高保真版.html')
).href;
const PORT=Number(process.env.PORT||9400);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  const ch=spawn(CHROME,['--headless=new','--disable-gpu','--no-sandbox',`--remote-debugging-port=${PORT}`,'about:blank'],{stdio:'ignore'});
  let t=null;for(let i=0;i<40;i++){await sleep(250);try{const r=await fetch(`http://127.0.0.1:${PORT}/json/list`);t=await r.json();if(t.find(x=>x.type==='page'))break;}catch(e){}}
  const ws=new WebSocket(t.find(x=>x.type==='page').webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ws.onopen=res;ws.onerror=rej;});
  let id=0;const pend=new Map();
  ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){const p=pend.get(m.id);pend.delete(m.id);m.error?p.rej(new Error(JSON.stringify(m.error))):p.res(m.result);}};
  const send=(m,p={})=>new Promise((res,rej)=>{const i=++id;pend.set(i,{res,rej});ws.send(JSON.stringify({id:i,method:m,params:p}));});
  const ev=async x=>{const r=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});return r.exceptionDetails?{__err:(r.exceptionDetails.exception?.description||r.exceptionDetails.text)}:r.result.value;};
  await send('Page.enable');await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride',{width:430,height:920,deviceScaleFactor:1,mobile:false});
  await send('Page.navigate',{url:HTML});await sleep(2200);
  await ev(`S.loggedIn=true;S.loginStep='role';document.querySelector('#loginLayer').classList.remove('on')`);await sleep(300);
  await ev(`setEnd('${process.env.E||'merch'}')`);await sleep(400);
  await ev(`setTab('${process.env.K||'supply'}')`);await sleep(700);
  if(process.env.CMD){await ev(process.env.CMD);await sleep(700);}
  const r=await ev(process.env.JS||'1');
  console.log(typeof r==='string'?r:JSON.stringify(r,null,1));
  ws.close();ch.kill();process.exit(0);
})().catch(e=>{console.error('FATAL',e.message);process.exit(1);});
