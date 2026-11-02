// 微信工具登录受限时的源码浏览器验证器：执行原 Page JS，渲染原 WXML。
// 明确不是微信原生渲染；仅隔离测试使用，绝不作为生产小程序入口。
import { assertIsolatedDb } from './_guard.mjs'
assertIsolatedDb('test/mini-source-preview.mjs')
import http from 'node:http'
import fs from 'node:fs'
const base=process.env.API_BASE||'http://127.0.0.1:8098'
const allowed=['note','create']
const html=String.raw`<!doctype html><meta charset="utf-8"><title>小程序源码验证</title><style>body{font:16px sans-serif;background:#f5f6f4;color:#243126;margin:20px}#phone{width:390px;background:white;padding:18px;min-height:700px;box-sizing:border-box}view,block,editor,rich-text{display:block}.card{padding:14px;margin:12px 0;border:1px solid #ddd;border-radius:12px}.hero{padding:16px;background:#fff4e8}.note,.sub2{font-size:13px;color:#777;margin:10px 0}.sec-title{margin-top:24px;font-weight:bold}.kv{display:flex;justify-content:space-between;margin:14px 0}textarea{width:100%;min-height:100px;box-sizing:border-box}button,.btn{margin:8px 0;padding:10px;border:1px solid #ddd;border-radius:7px;background:#fff2df;cursor:pointer}.reject-tip{padding:12px;background:#fff2e2}input{max-width:100%}#controls{margin:12px 0}</style>
<h3>小程序源码浏览器验证（非微信原生）</h3><div id="controls"><button id="reader">切换读者 · 笔记详情</button><button id="author">切换作者 · 创作中心</button><button id="readerCenter">读者 · 举报反馈</button><button id="reload">刷新当前页面</button></div><p id="message"></p><div id="phone"></div>
<script>
let fixture,current,identity='reader',pageName='note',template,requestOffline=false;
const api={ensureLogin:async()=>{},request:async(path,method='GET',data={})=>{if(requestOffline)throw {msg:'模拟断网'};const r=await fetch('/proxy'+path,{method,headers:{'content-type':'application/json',authorization:'Bearer '+fixture[identity]},body:method==='GET'?undefined:JSON.stringify(data)}).then(r=>r.json());if(r.code!==0)throw r;return r.data}};
function val(raw,ctx){const matches=String(raw).match(/^\{\{([\s\S]*)\}\}$/);if(matches&&!matches[1].includes('}}')&&!matches[1].includes('{{'))return Function('s','with(s){return ('+matches[1]+')}')(ctx);return String(raw).replace(/\{\{([\s\S]*?)\}\}/g,(_,expr)=>{try{return Function('s','with(s){return ('+expr+')}')(ctx)??''}catch{return ''}})}
function render(){const root=document.getElementById('phone');root.innerHTML='';const t=document.createElement('template');t.innerHTML=template;walk(t.content,root,current.data)}
function walk(source,out,ctx){let last=false;for(const n of source.childNodes){if(n.nodeType===3){out.append(document.createTextNode(val(n.textContent,ctx)));continue}if(n.nodeType!==1)continue;
  if(n.hasAttribute('wx:for')){const list=val(n.getAttribute('wx:for'),ctx)||[];for(let i=0;i<list.length;i++){const clone=n.cloneNode(true);clone.removeAttribute('wx:for');const tmp=document.createDocumentFragment();tmp.append(clone);walk(tmp,out,{...ctx,[n.getAttribute('wx:for-item')||'item']:list[i],index:i})}continue}
  if(n.hasAttribute('wx:if')){last=!!val(n.getAttribute('wx:if'),ctx);if(!last)continue}else if(n.hasAttribute('wx:else')&&last)continue;
  if(n.tagName.toLowerCase()==='block'){walk(n,out,ctx);continue}const el=document.createElement(n.tagName.toLowerCase()==='image'?'img':n.tagName.toLowerCase());const ds={};
  for(const a of n.attributes){if(a.name.startsWith('wx:'))continue;const v=val(a.value,ctx);if(a.name.startsWith('data-'))ds[a.name.slice(5)]=v;
    if(a.name==='bindtap'||a.name==='catchtap'||a.name==='catchtouchend'){el.onclick=()=>current[v]?.call(current,{currentTarget:{dataset:ds}});continue}
    if(a.name==='bindinput'){el.oninput=e=>current[v]?.call(current,{detail:{value:e.target.value}});continue}
    if(a.name==='disabled'){el.disabled=!!v;continue}if(a.name==='value'){el.value=v??'';continue}if(!a.name.startsWith('bind')&&a.name!=='nodes'&&a.name!=='loading')el.setAttribute(a.name,v??'')}
  if(n.tagName.toLowerCase()==='rich-text')el.innerHTML=val(n.getAttribute('nodes')||'',ctx);else walk(n,el,ctx);out.append(el)
}}
async function load(name,who){pageName=name;identity=who;template=await fetch('/source/'+name+'.wxml').then(r=>r.text());const js=await fetch('/source/'+name+'.js').then(r=>r.text());const wx={showToast:o=>document.getElementById('message').textContent=o.title,navigateTo:()=>load('note',identity),showActionSheet:()=>{},};Function('require','Page','wx',js)(()=>api,p=>{current=p;p.data=structuredClone(p.data);p.setData=d=>{Object.assign(p.data,d);render()};p.createSelectorQuery=()=>({select:()=>({context:()=>({exec(){}})})});},wx);render();current.onLoad?.({id:fixture.note});await current.onShow?.();}
document.getElementById('reader').onclick=()=>load('note','reader');document.getElementById('author').onclick=()=>load('create','author');document.getElementById('readerCenter').onclick=()=>load('create','reader');document.getElementById('reload').onclick=()=>load(pageName,identity);
window.preview={get page(){return current},get identity(){return identity},offline(v){requestOffline=v}};
fetch('/fixture').then(r=>r.json()).then(f=>{fixture=f;load('note','reader')});
</script>`
http.createServer(async(req,res)=>{
  try{
    if(req.url.startsWith('/proxy/')){
      const chunks=[];for await(const c of req)chunks.push(c)
      const r=await fetch(base+req.url.slice(6),{method:req.method,headers:{'content-type':'application/json',authorization:req.headers.authorization||''},body:req.method==='GET'?undefined:Buffer.concat(chunks)})
      res.writeHead(r.status,{'content-type':'application/json'});return res.end(await r.text())
    }
    if(req.url==='/fixture'){res.setHeader('content-type','application/json');return res.end(fs.readFileSync('test/governance-ui-fixture.json'))}
    const match=req.url.match(/^\/source\/(note|create)\.(js|wxml)$/)
    if(match&&allowed.includes(match[1])){res.setHeader('content-type','text/plain');return res.end(fs.readFileSync(`../mini-a/package-content/pages/${match[1]}/index.${match[2]}`))}
    res.setHeader('content-type','text/html; charset=utf-8');res.end(html)
  }catch(e){res.writeHead(500);res.end(e.message)}
}).listen(Number(process.env.PREVIEW_PORT||8099),'127.0.0.1',()=>console.log('mini source browser preview http://127.0.0.1:'+(process.env.PREVIEW_PORT||8099)))
