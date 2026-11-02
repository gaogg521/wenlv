import io

p = 'admin/app.js'
s = io.open(p, encoding='utf-8').read()

# 1) NAV：治理组加 4 项；WEB3 组加术语映射
old_nav = "  ['治理', [['config', '参数中心', 'config'], ['attest', '存证中心', 'eco'], ['risk', '风控', 'risk'], ['audit', '审计日志', 'audit']]],"
assert old_nav in s, 'nav'
new_nav = "  ['治理', [['config', '参数中心', 'config'], ['attest', '存证中心', 'eco'], ['risk', '风控', 'risk'], ['audit', '审计日志', 'audit'], ['phrases', '暗号管理', 'flag'], ['rateov', '逐品佣金', 'promoters'], ['kyc', '实名认证', 'audit'], ['cocreate', '共创分润', 'eco']]],"
s = s.replace(old_nav, new_nav)
old_w3 = "['contract', '合约调用账户', 'sys']]],"
assert old_w3 in s, 'w3nav'
s = s.replace(old_w3, "['contract', '合约调用账户', 'sys'], ['terms', '术语映射', 'flag']]],")

# 2) crumb 名称表 + go() 视图分派
old_name = "wallets: '用户数字钱包', contract: '合约调用账户', faqs: '常见问题', banners: '轮播管理' }[page]"
assert old_name in s, 'name'
s = s.replace(old_name, "wallets: '用户数字钱包', contract: '合约调用账户', faqs: '常见问题', banners: '轮播管理', phrases: '暗号管理', rateov: '逐品佣金', kyc: '实名认证', cocreate: '共创分润', terms: '术语映射' }[page]")
old_disp = "({ dash, orders, products, merchants, settlements, budgets, promoters, config, risk, audit, system, features, content, withdrawals, agreements, attest, security, integrations, web3dash, pointassets, badges, wallets, contract, faqs, banners }[page] || dash)()"
assert old_disp in s, 'disp'
s = s.replace(old_disp, "({ dash, orders, products, merchants, settlements, budgets, promoters, config, risk, audit, system, features, content, withdrawals, agreements, attest, security, integrations, web3dash, pointassets, badges, wallets, contract, faqs, banners, phrases, rateov, kyc, cocreate, terms }[page] || dash)()")

# 3) 四个视图 + 术语映射（追加到 WEB3 工作区段前）
anchor = "/* ============ WEB3 工作区 ============ */"
assert anchor in s, 'views-anchor'
views = r'''/* ============ 暗号 / 逐品佣金 / KYC / 共创 ============ */
async function phrases() {
  $('#app').innerHTML = '<div class="card"><div class="sk" style="height:120px"></div></div>'
  const list = await api('GET', '/admin/phrases')
  const prods = await api('GET', '/admin/products')
  const noPhrase = prods.filter((p) => !list.some((x) => x.id === p.id))
  $('#app').innerHTML = `<div class="card"><div class="card-head"><h3>暗号管理（剧本游「入戏」凭证）</h3>
    <span class="muted">用户暗号给游客 · 商家暗号核销员对答 · 命中即核销</span></div>
    ${list.length ? `<table><thead><tr><th>产品</th><th>用户暗号</th><th>商家暗号</th><th>操作</th></tr></thead><tbody>
    ${list.map((x) => `<tr><td>${esc(x.title)}</td><td>${esc(x.phrase_user)}</td><td>${esc(x.phrase_merchant || '—')}</td>
      <td><button class="btn sm" onclick="editPhrase(${x.id},'${esc(x.phrase_user)}','${esc(x.phrase_merchant || '')}')">编辑</button>
      <button class="btn ghost sm" onclick="editPhrase(${x.id},'','')">清除</button></td></tr>`).join('')}</tbody></table>`
    : emptyBox('还没有产品配暗号——下方为产品配一对口令')}
    <div class="card-head" style="margin-top:14px"><h3>为产品配置暗号</h3></div>
    <div class="row" style="gap:10px;flex-wrap:wrap">
      <select id="phProd" class="inp" style="max-width:280px">${noPhrase.map((p) => `<option value="${p.id}">${esc(p.title)}</option>`).join('')}</select>
      <input id="phUser" class="inp" placeholder="用户暗号（如：放生桥边等船否）" style="max-width:260px">
      <input id="phMer" class="inp" placeholder="商家暗号（如：漕港河里载秋来）" style="max-width:260px">
      <button class="btn primary" onclick="savePhrase()">保存</button>
    </div></div>`
}
window.editPhrase = (id, u, m) => {
  editPhrase._id = id
  $('#app').querySelectorAll('input.inp')[0].value = u
  $('#app').querySelectorAll('input.inp')[1].value = m
  editPhrase._editing = true
}
window.savePhrase = async () => {
  const inputs = $('#app').querySelectorAll('input.inp')
  const pid = editPhrase._editing ? editPhrase._id : $('#phProd').value
  await api('POST', '/admin/phrases/' + pid, { userPhrase: inputs[0].value, merchantPhrase: inputs[1].value })
  editPhrase._editing = false
  go('phrases')
}
async function rateov() {
  $('#app').innerHTML = '<div class="card"><div class="sk" style="height:120px"></div></div>'
  const prods = await api('GET', '/admin/products')
  const ov = await api('GET', '/admin/rate-overrides').catch(() => [])
  $('#app').innerHTML = `<div class="card"><div class="card-head"><h3>逐品佣金覆盖（D2 扩展）</h3>
    <span class="muted">单品费率优先于推广商档位 · 上限 12% · 留空=恢复档位费率</span></div>
    <div class="row" style="gap:10px;flex-wrap:wrap">
      <select id="roProd" class="inp" style="max-width:280px">${prods.map((p) => `<option value="${p.id}">${esc(p.title)}</option>`).join('')}</select>
      <input id="roBp" class="inp" placeholder="费率 %（如 9.5）" style="max-width:160px">
      <button class="btn primary" onclick="saveRate()">设置</button>
      <button class="btn ghost" onclick="saveRate(true)">清除覆盖</button>
    </div>
    ${ov.length ? `<table style="margin-top:12px"><thead><tr><th>产品</th><th>单品费率</th></tr></thead><tbody>
    ${ov.map((x) => `<tr><td>${esc(x.title)}</td><td><b>${(Number(x.promo_rate_bp) / 100).toFixed(2)}%</b></td></tr>`).join('')}</tbody></table>`
    : '<div class="muted" style="margin-top:12px">暂无单品覆盖，全部走推广商档位 5/8/12%</div>'}</div>`
}
window.saveRate = async (clear) => {
  const bp = clear ? null : Math.round(parseFloat($('#roBp').value) * 100)
  await api('POST', '/admin/rate-overrides/' + $('#roProd').value, { rateBp: bp })
  go('rateov')
}
async function kyc() {
  $('#app').innerHTML = '<div class="card"><div class="sk" style="height:120px"></div></div>'
  const list = await api('GET', '/admin/kyc')
  const st = { 0: '<span class="pill warn">待审</span>', 1: '<span class="pill ok">已通过</span>', 2: '<span class="pill s70">已驳回</span>' }
  $('#app').innerHTML = `<div class="card"><div class="card-head"><h3>实名认证审核</h3><span class="muted">身份证号加密落库 · 仅展示脱敏号</span></div>
    ${list.length ? `<table><thead><tr><th>用户</th><th>姓名</th><th>证件号（脱敏）</th><th>状态</th><th>时间</th><th>操作</th></tr></thead><tbody>
    ${list.map((x) => `<tr><td>${esc(x.nickname)}</td><td>${esc(x.real_name)}</td><td class="num">${esc(x.id_no_mask)}</td>
      <td>${st[x.status] || x.status}</td><td class="td-sub">${String(x.created_at).slice(0, 16)}</td>
      <td>${x.status === 0 ? `<button class="btn primary sm" onclick="kycResolve(${x.id},'pass')">通过</button>
        <button class="btn ghost sm" onclick="kycResolve(${x.id},'reject')">驳回</button>` : (x.reject_note ? '<span class="td-sub">' + esc(x.reject_note) + '</span>' : '')}</td></tr>`).join('')}</tbody></table>`
    : emptyBox('暂无实名认证申请')}</div>`
}
window.kycResolve = async (id, action) => {
  let note = null
  if (action === 'reject') {
    note = prompt('驳回原因：') || '资料不符'
  }
  await api('POST', '/admin/kyc/' + id + '/resolve', { action, note })
  go('kyc')
}
async function cocreate() {
  $('#app').innerHTML = '<div class="card"><div class="sk" style="height:120px"></div></div>'
  const prods = await api('GET', '/admin/products')
  const list = await api('GET', '/admin/co-creators')
  const profits = await api('GET', '/admin/co-profits').catch(() => [])
  $('#app').innerHTML = `<div class="card"><div class="card-head"><h3>共创人（资金商/商品商 · 按产品投资分润）</h3>
    <span class="muted">结算期自动按 产品GMV占比 × 留存毛利 × share_pct 入账</span></div>
    <div class="row" style="gap:10px;flex-wrap:wrap">
      <select id="coProd" class="inp" style="max-width:240px">${prods.map((p) => `<option value="${p.id}">${esc(p.title)}</option>`).join('')}</select>
      <input id="coName" class="inp" placeholder="姓名" style="max-width:120px">
      <input id="coMobile" class="inp" placeholder="手机号" style="max-width:150px">
      <select id="coRole" class="inp" style="max-width:120px"><option value="1">资金商</option><option value="2">商品商</option></select>
      <input id="coInvest" class="inp" placeholder="投资额(元)" style="max-width:120px">
      <input id="coPct" class="inp" placeholder="分润 %（如 8）" style="max-width:120px">
      <button class="btn primary" onclick="saveCo()">登记</button>
    </div>
    ${list.length ? `<table style="margin-top:12px"><thead><tr><th>编号</th><th>产品</th><th>姓名</th><th>角色</th><th>投资额</th><th>分润</th><th>状态</th></tr></thead><tbody>
    ${list.map((x) => `<tr><td class="num">${esc(x.co_no)}</td><td>${esc(x.title)}</td><td>${esc(x.name)}</td>
      <td>${Number(x.role) === 1 ? '资金商' : '商品商'}</td><td class="num">¥${(Number(x.invest_amount) / 100).toFixed(0)}</td>
      <td class="num">${(Number(x.share_pct) / 100).toFixed(1)}%</td>
      <td>${Number(x.status) === 1 ? '<span class="pill ok">生效</span>' : '<span class="pill off">停用</span>'}
      <button class="btn ghost sm" onclick="toggleCo(${x.id},${x.status})">${Number(x.status) === 1 ? '停用' : '启用'}</button></td></tr>`).join('')}</tbody></table>`
    : '<div class="muted" style="margin-top:12px">暂无共创人</div>'}
    <div class="card-head" style="margin-top:14px"><h3>共创分润台账（链上分润凭证）</h3></div>
    ${profits.length ? `<table><thead><tr><th>期</th><th>共创人</th><th>产品</th><th>基数</th><th>分润额</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${profits.map((x) => `<tr><td>${esc(x.period)}</td><td>${esc(x.name)}（${esc(x.co_no)}）</td><td>${esc(x.title)}</td>
      <td class="num">¥${(Number(x.base_amount) / 100).toFixed(2)}</td><td class="num"><b>¥${(Number(x.amount) / 100).toFixed(2)}</b></td>
      <td>${Number(x.status) === 1 ? '<span class="pill ok">已打款</span>' : '<span class="pill warn">待打款</span>'}</td>
      <td>${Number(x.status) === 0 ? `<button class="btn primary sm" onclick="payCo(${x.id})">标记打款</button>` : ''}</td></tr>`).join('')}</tbody></table>`
    : '<div class="muted">暂无分润记录——生成结算单后自动入账</div>'}</div>`
}
window.saveCo = async () => {
  await api('POST', '/admin/co-creators', { productId: $('#coProd').value, name: $('#coName').value, mobile: $('#coMobile').value,
    role: Number($('#coRole').value), investAmount: Math.round(parseFloat($('#coInvest').value || '0') * 100), sharePct: Math.round(parseFloat($('#coPct').value || '0') * 100) })
  go('cocreate')
}
window.toggleCo = async (id, st) => { await api('POST', '/admin/co-creators/' + id + '/status', { status: st === 1 ? 0 : 1 }); go('cocreate') }
window.payCo = async (id) => { await api('POST', '/admin/co-profits/' + id + '/pay'); go('cocreate') }

/* ============ 术语映射（合规词 ↔ 链词，D6 双层口径） ============ */
const TERM_MAP = [
  ['旅豆', '向往自由链积分（Bean Token）', '小程序端一律叫「旅豆」；后台台账/存证语境可用链上口径'],
  ['入园凭证', '链上权益凭证（Pass NFT 语义）', '凭证编号即链上资产编号；小程序端禁提 NFT'],
  ['存证中心', '上链存证（Merkle Anchor）', '对外讲「一网可信」；后台展示 Merkle 根与锚定批次'],
  ['积分资产发行', 'Token Issuance（按预算批次）', '发行即 mint 语义，但受 global_cap 哨兵约束，严禁超发'],
  ['勋章', '链上数字勋章（Badge SBT 语义）', '不可转让（SBT）；小程序端叫「勋章」'],
  ['用户数字钱包', '用户权益账户（Wallet 视图）', '仅后台可见链词；小程序端无钱包概念'],
  ['共创分润', '链上分润凭证（Revenue Share）', '分润台账每期上链锚定；小程序端不出现'],
  ['推广服务商', '分销合约节点（Affiliate Node）', 'D2 定稿禁止层级计酬；链词仅内部运营语境'],
]
async function terms() {
  $('#app').innerHTML = `<div class="card"><div class="card-head"><h3>术语映射表（后台 Web3 口径 ↔ 小程序合规口径）</h3></div>
    <div class="muted" style="margin-bottom:10px">后台不上小程序审核，可用 Web3 真实词汇；两个小程序端一律走合规词。改动任何界面文案前先对照本表，避免口径串台。</div>
    <table><thead><tr><th>小程序合规词（用户可见）</th><th>后台/存证链词（内部运营）</th><th>使用边界</th></tr></thead><tbody>
    ${TERM_MAP.map((t) => `<tr><td><b>${t[0]}</b></td><td>${t[1]}</td><td class="td-sub">${t[2]}</td></tr>`).join('')}</tbody></table>
    <div class="note" style="margin-top:10px">红线（D6）：不对应股权/Token 收益权、不按层级计酬、境内外隔离。链词仅出现在本后台与存证报告，绝不回灌小程序。</div></div>`
}

'''
s = s.replace(anchor, views + anchor)

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('admin app.js patched')
