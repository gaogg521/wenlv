const { spawn } = require('child_process');
const fsx=require('fs'), pathx=require('path'); const {pathToFileURL}=require('url');
const CHROME=['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p=>fsx.existsSync(p));
const HTML=pathToFileURL(pathx.resolve(__dirname,'..','向往的自由-业务系统demo-高保真版.html')).href;
const OUT=pathx.resolve(__dirname,'..','shots_v11'); fsx.mkdirSync(OUT,{recursive:true});
const PORT=Number(process.env.PORT||9481), sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
const ch=spawn(CHROME,['--headless=new','--disable-gpu','--no-sandbox','--remote-debugging-port='+PORT,'about:blank'],{stdio:'ignore'});
let t=null; for(let i=0;i<40;i++){await sleep(250);try{const r=await fetch(`http://127.0.0.1:${PORT}/json/list`);t=await r.json();if(t.find(x=>x.type==='page'))break;}catch(e){}}
const ws=new WebSocket(t.find(x=>x.type==='page').webSocketDebuggerUrl);
await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});
let id=0;const p=new Map();
ws.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&p.has(m.id)){const q=p.get(m.id);p.delete(m.id);m.error?q.rej(new Error(JSON.stringify(m.error))):q.res(m.result);}};
const send=(m,pa={})=>new Promise((res,rej)=>{const i=++id;p.set(i,{res,rej});ws.send(JSON.stringify({id:i,method:m,params:pa}));});
const ev=async x=>{const r=await send('Runtime.evaluate',{expression:x,returnByValue:true,awaitPromise:true});return r.exceptionDetails?{__err:(r.exceptionDetails.exception?.description||'').split('\n')[0]}:r.result.value;};
await send('Page.enable');await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride',{width:430,height:920,deviceScaleFactor:2,mobile:false});
await send('Page.navigate',{url:HTML});await sleep(2000);

const shot=async n=>{const r=await send('Page.captureScreenshot',{format:'png'});fsx.writeFileSync(pathx.join(OUT,n+'.png'),Buffer.from(r.data,'base64'));console.log('  '+n);};

await shot('00-login');

const targets=[
  ['tourist','home','01-home'],
  ['tourist','theme','02-theme'],
  ['tourist','me','03-me'],
];
for(const [e,tb,n] of targets){
  await ev(`S.loggedIn=true;document.querySelector('#loginLayer').classList.remove('on');setEnd('${e}');setTab('${tb}')`);
  await sleep(700); await shot(n);
}
// 我的订单（16 条）
await ev(`pushMyOrdersPage()`); await sleep(600); await shot('04-my-orders');
await ev(`clearStack()`);
// 约稿任务（12 条）
await ev(`pushMissionsPage()`); await sleep(600); await shot('05-missions');
await ev(`clearStack()`);
// 商户订单（24 条）
await ev(`setEnd('merch');setTab('order')`); await sleep(600); await shot('06-merch-orders');
// 运营审核（14 条）
await ev(`setEnd('admin');setTab('audit')`); await sleep(600); await shot('07-admin-audit');
// 风控（8 条预警）
await ev(`setEnd('admin');setTab('risk')`); await sleep(600); await shot('08-admin-risk');
// 驾驶舱
await ev(`setEnd('admin');setTab('dash')`); await sleep(700); await shot('09-admin-dash');
// 合伙人团队（16 个下线）
await ev(`pushPromoCenter();promoTabSwitch('team')`); await sleep(600); await shot('10-promo-team');
ws.close();ch.kill();
})();
