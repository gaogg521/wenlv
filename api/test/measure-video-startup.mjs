// 测量小程序演示视频从进入视口到真正开始播放的延迟（模拟手机网络）
// 用法: node test/measure-video-startup.mjs [url]
import { chromium } from 'playwright-core'

const url = process.argv[2] || 'https://ziyou.1work.vip/'
const PROFILE = { offline:false, latency:150, downloadThroughput: 1.6*1024*1024/8, uploadThroughput: 750*1024/8 }
const b = await chromium.launch({ headless:true, executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe' })
const ctx = await b.newContext({ viewport:{width:390,height:844}, deviceScaleFactor:2, isMobile:true, hasTouch:true })
const p = await ctx.newPage()
const cdp = await ctx.newCDPSession(p)
await cdp.send('Network.enable')
await cdp.send('Network.setCacheDisabled', { cacheDisabled:true })
await cdp.send('Network.emulateNetworkConditions', PROFILE)

const errs = []
p.on('pageerror', e => errs.push(e.message))
await p.goto(url + (url.includes('?') ? '&' : '?') + 'nocache=' + Date.now(), { waitUntil:'domcontentloaded', timeout:60000 })
// 模拟真实用户：打开后先停留浏览首屏 3 秒，让空闲预热完成
await p.waitForTimeout(3000)

async function measure(panel, tabIndex) {
  // 先确保面板可见
  await p.evaluate(pn => {
    const t = document.querySelector('[data-tab="' + (pn === 'panel-visitor' ? 'visitor' : 'merchant') + '"]')
    if (t) t.click()
  }, panel)
  await p.waitForTimeout(200)
  const t0 = Date.now()
  await p.evaluate(pn => document.querySelector('#' + pn + ' [data-mini-demo]')?.scrollIntoView({block:'center'}), panel)
  const start = await p.evaluate(pn => {
    const v = document.querySelector('#' + pn + ' video')
    return { readyState:v.readyState, networkState:v.networkState, ct:v.currentTime, preload:v.preload, buffered:v.buffered.length?v.buffered.end(0):0 }
  }, panel)
  let firstMove = null, canplay = null, maxCt = 0
  for (let i=0;i<120;i++) {
    await p.waitForTimeout(100)
    const s = await p.evaluate(pn => {
      const v = document.querySelector('#' + pn + ' video')
      return { ct:v.currentTime, ready:v.readyState, buf:v.buffered.length?v.buffered.end(0):0, paused:v.paused }
    }, panel)
    if (s.ct > 0.05 && firstMove === null) firstMove = Date.now() - t0
    if (s.ready >= 3 && canplay === null) canplay = Date.now() - t0
    maxCt = Math.max(maxCt, s.ct)
    if (firstMove !== null && canplay !== null && maxCt > 0.6) break
  }
  return { panel, preload:start.preload, startReady:start.readyState, startBuf:+start.buffered.toFixed(2),
    firstMoveMs:firstMove, canplayMs:canplay, maxCt:+maxCt.toFixed(2) }
}

const results = []
results.push(await measure('panel-visitor', 0))
results.push(await measure('panel-merchant', 0))
console.log('URL=' + url)
for (const r of results) console.log(JSON.stringify(r))
console.log('ERRS=' + JSON.stringify(errs))
await b.close()
