// 导航探针：绕开 automator 封装，直接在模拟器里调 wx.navigateTo，抓 success/fail 回调与页面栈
// 用法：node test/nav-probe.mjs /package-promo/pages/center/index
import automator from 'miniprogram-automator'

const target = process.argv[2] || '/package-promo/pages/center/index'
const WS = process.env.AUTO_WS || 'ws://127.0.0.1:9421'
const mini = await automator.connect({ wsEndpoint: WS })
console.log('[probe] connected')

// 等首屏
for (let i = 0; i < 30; i++) {
  try { const p = await mini.currentPage(); if (p && p.path) { console.log('[probe] ready:', p.path); break } } catch {}
  await new Promise((r) => setTimeout(r, 1000))
}

// 通过 evaluate 在模拟器上下文里直接调 wx.navigateTo，结果写到 globalThis.__navResult
await mini.evaluate((url) => {
  globalThis.__navResult = 'pending'
  try {
    wx.navigateTo({
      url,
      success: () => { globalThis.__navResult = 'success' },
      fail: (e) => { globalThis.__navResult = 'fail:' + (e && e.errMsg) },
    })
    // 兜底：1s 后记录栈顶（同步路径下 navigateTo 是异步的，栈可能还没变）
  } catch (e) {
    globalThis.__navResult = 'throw:' + e.message
  }
}, target)

await new Promise((r) => setTimeout(r, 4000))

const res = await mini.evaluate(() => ({
  result: globalThis.__navResult,
  stack: getCurrentPages().map((p) => p.route),
}))
console.log('[probe] navigateTo result:', JSON.stringify(res, null, 1))
await mini.disconnect()
