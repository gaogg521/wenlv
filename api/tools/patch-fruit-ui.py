# -*- coding: utf-8 -*-
# admin-ui 低垂果实 part4（清理版）：FAQ/轮播管理页 + 导出按钮×4 + 导航
import io
p = 'admin/app.js'
s = io.open(p, encoding='utf-8').read()

old = "['content', '内容审核', 'content'], ['promoters', '推广服务商', 'promoters']"
assert old in s
s = s.replace(old, "['content', '内容审核', 'content'], ['faqs', '常见问题', 'audit'], ['banners', '轮播管理', 'flag'], ['promoters', '推广服务商', 'promoters']")

old = "    web3dash: '链上总览', pointassets: '积分资产发行', badges: '勋章资产发行', wallets: '用户数字钱包', contract: '合约调用账户' }[page]"
assert old in s
s = s.replace(old, "    web3dash: '链上总览', pointassets: '积分资产发行', badges: '勋章资产发行', wallets: '用户数字钱包', contract: '合约调用账户', faqs: '常见问题', banners: '轮播管理' }[page]")
old = "web3dash, pointassets, badges, wallets, contract }[page] || dash)()"
assert old in s
s = s.replace(old, "web3dash, pointassets, badges, wallets, contract, faqs, banners }[page] || dash)()")

anchor = "async function contract() {"
assert anchor in s
add = r'''/* ============ CSV 导出（低垂果实 #4）============ */
async function downloadExport(what) {
  try {
    const r = await fetch('/admin/export/' + what, { headers: { Authorization: 'Bearer ' + TOKEN } })
    const j = await r.json()
    const blob = new Blob([j.csv], { type: 'text/csv;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob); a.download = j.filename; a.click()
    URL.revokeObjectURL(a.href)
    toast('已导出 ' + j.filename)
  } catch (e) { toast('导出失败：' + e.message, true) }
}
const EXPBTN = (what, label) => `<button class="btn ghost sm" style="margin-left:auto" onclick="downloadExport('${what}')">⬇ 导出${label || ''}</button>`

/* ============ 常见问题 / 轮播管理（低垂果实 #5）============ */
async function faqs() {
  $('#app').innerHTML = `<div class="card">${skel(3)}</div>`
  const d = await api('GET', '/admin/faqs')
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>常见问题管理</h2><span class="muted">小程序「我的-常见问题」展示位 · 按序号排序</span></div>
    <div class="row">
      <input id="fq" placeholder="问题" style="width:260px">
      <input id="fa" placeholder="答案" style="width:340px">
      <input id="fs" type="number" placeholder="序号" style="width:70px">
      <button class="btn primary sm" onclick="addFaq()">新增</button>
    </div>
    <table style="margin-top:10px"><thead><tr><th>序号</th><th>问题</th><th>答案</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${d.map((f) => `<tr><td class="num">${f.sort}</td><td>${esc(f.question)}</td><td class="td-sub">${esc(String(f.answer).slice(0, 60))}…</td>
      <td>${f.status === 1 ? '<span class="pill ok">上架</span>' : '<span class="pill s70">下架</span>'}</td>
      <td><button class="btn ghost sm" onclick="toggleFaq(${f.id}, ${f.status === 1 ? 0 : 1})">${f.status === 1 ? '下架' : '上架'}</button>
      <button class="btn ghost sm" onclick="delFaq(${f.id})">删除</button></td></tr>`).join('')}
    </tbody></table>
  </div>`
}
async function addFaq() {
  const question = document.getElementById('fq').value.trim(), answer = document.getElementById('fa').value.trim()
  if (!question || !answer) return toast('问题与答案必填', true)
  await api('POST', '/admin/faqs', { question, answer, sort: Number(document.getElementById('fs').value) || 0 })
  toast('已新增'); faqs()
}
async function toggleFaq(id, status) { await api('POST', '/admin/faqs/' + id + '/update', { status }); faqs() }
async function delFaq(id) {
  if (!confirm('确认删除该问题？')) return
  await api('POST', '/admin/faqs/' + id + '/delete', {}); toast('已删除'); faqs()
}
async function banners() {
  $('#app').innerHTML = `<div class="card">${skel(3)}</div>`
  const d = await api('GET', '/admin/banners')
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>轮播媒体管理</h2><span class="muted">小程序首页轮播位 · 图片支持外链或 /uploads 路径</span></div>
    <div class="row">
      <input id="bt" placeholder="标题" style="width:160px">
      <input id="bi" placeholder="图片 URL" style="width:260px">
      <input id="bl" placeholder="跳转路径（选填）" style="width:220px">
      <input id="bs" type="number" placeholder="序号" style="width:70px">
      <button class="btn primary sm" onclick="addBanner()">新增</button>
    </div>
    <table style="margin-top:10px"><thead><tr><th>预览</th><th>标题</th><th>跳转</th><th>序号</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${d.map((b) => `<tr><td><img src="${esc(b.image)}" style="width:72px;height:40px;object-fit:cover;border-radius:6px"></td>
      <td>${esc(b.title)}</td><td class="td-sub">${esc(b.link || '—')}</td><td class="num">${b.sort}</td>
      <td>${b.status === 1 ? '<span class="pill ok">上架</span>' : '<span class="pill s70">下架</span>'}</td>
      <td><button class="btn ghost sm" onclick="toggleBanner(${b.id}, ${b.status === 1 ? 0 : 1})">${b.status === 1 ? '下架' : '上架'}</button>
      <button class="btn ghost sm" onclick="delBanner(${b.id})">删除</button></td></tr>`).join('') || '<tr><td colspan="6" class="td-sub">暂无轮播（首页将隐藏轮播位）</td></tr>'}
    </tbody></table>
  </div>`
}
async function addBanner() {
  const title = document.getElementById('bt').value.trim(), image = document.getElementById('bi').value.trim()
  if (!title || !image) return toast('标题与图片必填', true)
  await api('POST', '/admin/banners', { title, image, link: document.getElementById('bl').value.trim(), sort: Number(document.getElementById('bs').value) || 0 })
  toast('已新增'); banners()
}
async function toggleBanner(id, status) { await api('POST', '/admin/banners/' + id + '/update', { status }); banners() }
async function delBanner(id) {
  if (!confirm('确认删除该轮播？')) return
  await api('POST', '/admin/banners/' + id + '/delete', {}); toast('已删除'); banners()
}

'''
s = s.replace(anchor, add + anchor, 1)

pairs = [
  ('<div class="card-head"><h2>订单</h2><span class="muted">${rows.length} 笔',
   "<div class=\"card-head\"><h2>订单</h2>${EXPBTN('orders', '订单 CSV')}<span class=\"muted\">${rows.length} 笔"),
  ('<div class="card-head"><h2>商品与团期</h2><button class="btn primary sm" onclick="productModal()">＋ 新增线路</button></div>',
   "<div class=\"card-head\"><h2>商品与团期</h2>${EXPBTN('products', '商品 CSV')}<button class=\"btn primary sm\" onclick=\"productModal()\">＋ 新增线路</button></div>"),
  ('<div class="card-head"><h2>商户（履约方）</h2>',
   "<div class=\"card-head\"><h2>商户（履约方）</h2>${EXPBTN('merchants', '商户 CSV')}"),
  ('<div class="card-head"><h2>商户周结算</h2>',
   "<div class=\"card-head\"><h2>商户周结算</h2>${EXPBTN('settlements', '结算 CSV')}"),
]
for old, new in pairs:
    assert old in s, old[:40]
    s = s.replace(old, new, 1)

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('fruit-ui ok')
