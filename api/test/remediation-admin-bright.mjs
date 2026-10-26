import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
if (!/^wanderlust_qa_/.test(process.env.DB_NAME || '')) throw new Error('只允许隔离验收库')
const require = createRequire(import.meta.url)
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core')
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true, reducedMotion: 'reduce' })
// 隔离同一工作区中其他任务正在开发的业务页面，验证本轮提交对应的应用脚本。
if (process.env.ADMIN_SCRIPT_REF) {
 const script = execFileSync('git', ['show', process.env.ADMIN_SCRIPT_REF + ':api/admin/app.js'], {encoding:'utf8'}).replace(/\nboot\(\)\r?\n/, "\ndocument.addEventListener('DOMContentLoaded', () => boot(), { once: true })\n")
 await context.route('**/admin-ui/app.js', route => route.fulfill({contentType:'application/javascript',body:script}))
}
const page = await context.newPage(), errors = [], results = [], pages = []
page.on('pageerror', e => errors.push(e.message))
const dir = 'test/evidence-20261026'
const ready = async () => { await page.waitForFunction(() => document.querySelector('#app').getAttribute('aria-busy') === 'false'); await page.locator('#app .sk').waitFor({state:'hidden'}).catch(() => {}) }
const nav = async key => { const button=page.locator(`#nav [data-p="${key}"]`); await button.evaluate(el=>el.closest('details').open=true); await button.click(); await ready(); assert.equal(await page.locator('#app .error-state').count(),0,key+' should load') }
const ok = name => { results.push(name); console.log('PASS',name) }
try {
 await page.goto('http://127.0.0.1:8081/admin-ui')
 await page.screenshot({path:dir+'/bright-login.png'})
 await page.locator('#luser').fill('admin');await page.locator('#lpass').fill('admin123');await page.locator('#lpass').press('Enter');await page.locator('#frame').waitFor({state:'visible'});await ready()
 ok('actual login and shared workspace')
 const keys=await page.locator('#nav [data-p]').evaluateAll(els=>els.map(el=>el.dataset.p))
 for(const key of keys){await nav(key);pages.push(key);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page overflow '+key)}
 ok('all '+pages.length+' role-visible pages load without runtime errors or page overflow')
 await nav('dash');await page.screenshot({path:dir+'/bright-dashboard.png',fullPage:true})
 await page.locator('#navSearch').fill('结算');assert.equal(await page.locator('#nav [data-p]:visible').count(),1);await page.locator('#navSearch').fill('no-menu-xyz');assert(await page.locator('#navEmpty').isVisible());await page.locator('#navSearch').fill('');ok('menu search and empty feedback')
 await nav('orders');await page.locator('#orderKeyword').fill('NO-ORDER-XYZ');await page.locator('#orderKeyword').press('Enter');await page.locator('#app .empty').filter({hasText:'没有符合条件的订单'}).waitFor();await page.locator('#clearOrders').click();const first=await page.locator('[data-order-no]').first().getAttribute('data-order-no');assert(first)
 if(await page.locator('#ordersNext').isEnabled()){await page.locator('#ordersNext').click();assert(await page.locator('#ordersPrev').isEnabled());await page.locator('#ordersPrev').click()}
 await page.locator('[data-order-status="60"]').click();assert.equal(await page.locator('[data-order-status="60"]').getAttribute('aria-selected'),'true');await page.locator('#clearOrders').click()
 await page.locator('#orderKeyword').fill(first);await page.locator('#orderKeyword').press('Enter');assert.equal(await page.locator('#app tbody tr').count(),1)
 await page.locator('[data-order-no]').first().click();await page.getByRole('dialog').waitFor();assert(await page.getByRole('dialog').getAttribute('aria-labelledby'));await page.screenshot({path:dir+'/bright-order-detail.png'});await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);await page.locator('#clearOrders').click();ok('order search, reset, complete statuses, pagination and detail Escape')
 const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:/导出订单/}).click();const download=await downloadPromise;const file=await download.path();const csv=await fs.readFile(file,'utf8');assert(csv.includes(first));assert(!csv.includes('undefined'));ok('real CSV download contains order data')
 await page.screenshot({path:dir+'/bright-orders.png',fullPage:true})
 await nav('products');await page.getByRole('button',{name:'＋ 新增线路',exact:true}).click();assert.equal(await page.evaluate(()=>document.activeElement.id),'p_title');await page.getByRole('button',{name:'＋团期',exact:true}).first().click();await page.getByRole('dialog').waitFor();assert.equal(await page.evaluate(()=>document.activeElement.id),'s_date');await page.keyboard.press('Shift+Tab');assert(await page.getByRole('dialog').evaluate(el=>el.contains(document.activeElement)));await page.keyboard.press('Escape');ok('new product focus and modal keyboard focus trap')
 await page.screenshot({path:dir+'/bright-products.png',fullPage:true})
 await nav('faqs');const title='亮色后台验收-'+Date.now();await page.locator('#fq').fill(title);await page.locator('#fa').fill('由隔离浏览器实际创建，再删除清理。');await page.locator('#fs').fill('99');await page.getByRole('button',{name:'新增',exact:true}).click();const row=page.locator('tr').filter({hasText:title});await row.waitFor();page.once('dialog',dialog=>dialog.accept());await row.getByRole('button',{name:'删除',exact:true}).click();await row.waitFor({state:'detached'});ok('actual FAQ create and delete in QA')
 await page.route('**/admin/products',route=>route.fulfill({status:503,json:{code:500,msg:'验收模拟暂时不可用'}}));await nav('orders');const productButton=page.locator('#nav [data-p="products"]');await productButton.click();await page.locator('.error-state').waitFor();assert(await page.getByText('验收模拟暂时不可用',{exact:true}).isVisible());await page.unroute('**/admin/products');await page.getByRole('button',{name:'重新加载',exact:true}).click();await ready();assert.equal(await page.locator('.error-state').count(),0);ok('failed load shows retry and recovers')
 await nav('settlements');await page.screenshot({path:dir+'/bright-settlements.png',fullPage:true});await nav('orders');await page.goBack();await ready();assert.equal(new URL(page.url()).hash,'#settlements');await page.reload();await ready();assert.equal(await page.locator('#pageTitle').textContent(),'结算');ok('back history and refresh restore page')
 for(const width of [768,390]){await nav('orders');await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile overflow '+width);if(width===390){await page.locator('#menuToggle').click();assert.equal(await page.locator('#menuToggle').getAttribute('aria-expanded'),'true');await page.screenshot({path:dir+'/bright-mobile-nav.png'});await page.keyboard.press('Escape');await page.screenshot({path:dir+'/bright-mobile-orders.png',fullPage:true})}}
 ok('768 / 390 layouts, horizontally scrollable tables and mobile menu')

 await page.setViewportSize({width:1440,height:1000});await nav('settlements')
 const receipt=page.getByRole('button',{name:/登记.*回单/}).first()
 if(await receipt.count()){await receipt.click();await page.getByRole('dialog').waitFor();await page.getByRole('button',{name:'确认登记',exact:true}).click();assert((await page.locator('#receiptError').textContent()).length>0);await page.keyboard.press('Escape');ok('settlement receipt required fields reject empty submission')}
 await page.locator('#nav [data-p="products"]').click();await page.locator('#nav [data-p="orders"]').click();await page.locator('#nav [data-p="settlements"]').click();await ready();assert.equal(await page.locator('#pageTitle').textContent(),'结算');assert(await page.getByText('商户周结算',{exact:true}).isVisible());ok('rapid navigation ends on last selected page')
 const finance=await context.newPage();await finance.goto('http://127.0.0.1:8081/admin-ui');await finance.evaluate(()=>{localStorage.removeItem('admin_token');localStorage.removeItem('admin_me')});await finance.reload();await finance.locator('#luser').fill('finance');await finance.locator('#lpass').fill('admin123');await finance.locator('#lpass').press('Enter');await finance.locator('#frame').waitFor({state:'visible'});await finance.waitForFunction(()=>document.querySelector('#app').getAttribute('aria-busy')==='false');assert.equal(await finance.locator('#nav [data-p="integrations"]').count(),0);assert.equal(await finance.locator('.task-link:visible').count(),1);await finance.goto('http://127.0.0.1:8081/admin-ui#integrations');await finance.waitForFunction(()=>document.querySelector('#app').getAttribute('aria-busy')==='false');assert.equal(await finance.locator('#pageTitle').textContent(),'经营概览');await finance.close();ok('finance menus, task links and forbidden deep link fallback')
 const main=await browser.newPage({viewport:{width:1440,height:1000}});await main.goto('http://127.0.0.1:8080/admin-ui');await main.locator('#luser').fill('admin');await main.locator('#lpass').fill('admin123');await main.locator('#lpass').press('Enter');await main.locator('#frame').waitFor({state:'visible'});await main.waitForFunction(()=>document.querySelector('#app').getAttribute('aria-busy')==='false');assert.equal(await main.locator('.error-state').count(),0);await main.close();ok('original demo 8080 actual login and read-only dashboard')
 assert.deepEqual(errors,[])
 await fs.writeFile(dir+'/bright-workspace-result.json',JSON.stringify({at:new Date().toISOString(),database:process.env.DB_NAME,adminScriptBaseline:process.env.ADMIN_SCRIPT_REF || 'live',pages,results,pageErrors:errors,limitations:['QA local environment','load-error response simulated','no real payment or external messaging']},null,2))
} finally { await browser.close() }
