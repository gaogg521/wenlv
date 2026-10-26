// mini-b 核销页元素级检查：对暗号按钮存在 + 截图
import automator from 'miniprogram-automator'
const mini = await automator.connect({ wsEndpoint: 'ws://127.0.0.1:9422' })
for (let i = 0; i < 20; i++) { const p = await mini.currentPage().catch(() => null); if (p && p.path) break; await new Promise((r) => setTimeout(r, 500)) }
const page = await mini.reLaunch('/pages/verify/index')
await new Promise((r) => setTimeout(r, 1500))
const btns = await page.$$('.btn')
const texts = []
for (const b of btns) texts.push(await b.text())
console.log('verify 页按钮:', JSON.stringify(texts))
console.log('对暗号按钮存在:', texts.some((t) => t.includes('对暗号')) ? 'YES' : 'NO')
await mini.screenshot({ path: '/tmp/verify-page.png' })
process.exit(0)
