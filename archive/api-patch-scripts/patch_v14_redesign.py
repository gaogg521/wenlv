# -*- coding: utf-8 -*-
# V14 页面重做：KPI卡 + 专业表格 + 规范表单
import io

p = 'admin/app.js'
s = io.open(p, encoding='utf-8').read()

# ── 1. 共创分润页重做 ──
start = s.index("async function cocreate() {")
end = s.index("window.saveCo =")
old_cocreate = s[start:end]
new_cocreate = '''async function cocreate() {
  $('#app').innerHTML = '<div class="card"><div class="sk" style="height:120px"></div></div>'
  const prods = await api('GET', '/admin/products')
  const list = await api('GET', '/admin/co-creators')
  const profits = await api('GET', '/admin/co-profits').catch(() => [])
  const totalInvest = list.reduce((s, c) => s + Number(c.invest_amount), 0)
  const totalProfit = profits.reduce((s, c) => s + Number(c.amount), 0)
  const activeCount = list.filter((c) => Number(c.status) === 1).length
  $('#app').innerHTML = `
  <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
    <div class="kpi"><div class="ico" style="background:#fdf3e0">💰</div><div><div class="l">累计投资额</div><div class="v">¥${(totalInvest / 100).toLocaleString()}</div><div class="s">共创人投入</div></div></div>
    <div class="kpi"><div class="ico" style="background:#e3f6ec">🏦</div><div><div class="l">累计分润</div><div class="v">¥${(totalProfit / 100).toLocaleString()}</div><div class="s">已入账待打款</div></div></div>
    <div class="kpi"><div class="ico" style="background:var(--brand-soft)">👥</div><div><div class="l">活跃共创人</div><div class="v">${activeCount}/${list.length}</div><div class="s">生效中</div></div></div>
  </div>
  <div class="card">
    <div class="card-head"><h2>共创人管理</h2><span class="muted">资金商/商品商 · 按产品投资分润 · 结算期自动入账</span></div>
    <div class="row">
      <select id="coProd" class="inp" style="width:240px">${prods.map((p) => `<option value="${p.id}">${esc(p.title)}</option>`).join('')}</select>
      <input id="coName" class="inp" placeholder="姓名" style="width:120px">
      <input id="coMobile" class="inp" placeholder="手机号" style="width:150px">
      <select id="coRole" class="inp" style="width:120px"><option value="1">资金商</option><option value="2">商品商</option></select>
      <input id="coInvest" class="inp" placeholder="投资额(元)" style="width:120px">
      <input id="coPct" class="inp" placeholder="分润 %（如 8）" style="width:120px">
      <button class="btn primary sm" onclick="saveCo()">登记共创人</button>
    </div>
    ${list.length ? `<table><thead><tr><th>编号</th><th>产品</th><th>姓名</th><th>角色</th><th>投资额</th><th>分润比例</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${list.map((x) => `<tr><td class="num">${esc(x.co_no)}</td><td>${esc(x.title)}</td><td>${esc(x.name)}</td>
      <td>${Number(x.role) === 1 ? '<span class="pill s60">资金商</span>' : '<span class="pill s20">商品商</span>'}</td>
      <td class="num">¥${(Number(x.invest_amount) / 100).toLocaleString()}</td>
      <td class="num"><b>${(Number(x.share_pct) / 100).toFixed(1)}%</b></td>
      <td>${Number(x.status) === 1 ? '<span class="pill ok">生效</span>' : '<span class="pill off">停用</span>'}</td>
      <td><div class="td-actions">${Number(x.status) === 1 ? `<button class="btn ghost sm" onclick="toggleCo(${x.id},${x.status})">停用</button>` : `<button class="btn primary sm" onclick="toggleCo(${x.id},${x.status})">启用</button>`}</div></td></tr>`).join('')}</tbody></table>`
    : emptyBox('暂无共创人——上方登记首位共创人')}</div>
  <div class="card">
    <div class="card-head"><h3>共创分润台账</h3><span class="muted">链上分润凭证 · 结算期自动入账</span></div>
    ${profits.length ? `<table><thead><tr><th>期</th><th>共创人</th><th>产品</th><th>基数</th><th>分润额</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${profits.map((x) => `<tr><td>${esc(x.period)}</td><td>${esc(x.name)}</td><td>${esc(x.title)}</td>
      <td class="num">¥${(Number(x.base_amount) / 100).toFixed(2)}</td><td class="money num"><b>¥${(Number(x.amount) / 100).toFixed(2)}</b></td>
      <td>${Number(x.status) === 1 ? '<span class="pill ok">已打款</span>' : '<span class="pill warn">待打款</span>'}</td>
      <td>${Number(x.status) === 0 ? `<button class="btn primary sm" onclick="payCo(${x.id})">标记打款</button>` : '<span class="td-sub">✓</span>'}</td></tr>`).join('')}</tbody></table>`
    : '<div class="empty"><div class="e-ico">📊</div>暂无分润记录——生成结算单后自动入账</div>'}</div>`
}
'''
s = s[:start] + new_cocreate + s[end:]

# ── 2. 暗号管理页重做 ──
start = s.index("async function phrases() {")
end = s.index("window.editPhrase =")
old_phrases = s[start:end]
new_phrases = '''async function phrases() {
  $('#app').innerHTML = '<div class="card"><div class="sk" style="height:120px"></div></div>'
  const list = await api('GET', '/admin/phrases')
  const prods = await api('GET', '/admin/products')
  const noPhrase = prods.filter((p) => !list.some((x) => x.id === p.id))
  $('#app').innerHTML = `
  <div class="kpi-grid" style="grid-template-columns:repeat(2,1fr);margin-bottom:16px">
    <div class="kpi"><div class="ico" style="background:#f1e9fd">🎭</div><div><div class="l">已配暗号产品</div><div class="v">${list.length}</div><div class="s">剧本游入戏凭证</div></div></div>
    <div class="kpi"><div class="ico" style="background:#e8effd">📦</div><div><div class="l">待配置产品</div><div class="v">${noPhrase.length}</div><div class="s">可选配暗号</div></div></div>
  </div>
  <div class="card">
    <div class="card-head"><h2>暗号管理</h2><span class="muted">剧本游「入戏」凭证 · 用户暗号给游客 · 商家暗号核销员对答</span></div>
    ${list.length ? `<table><thead><tr><th>产品</th><th>用户暗号</th><th>商家暗号</th><th>频道</th><th>操作</th></tr></thead><tbody>
    ${list.map((x) => `<tr><td class="td-main">${esc(x.title)}</td>
      <td><code style="background:#f1e9fd;color:#6d28d9">${esc(x.phrase_user)}</code></td>
      <td><code style="background:#e8effd;color:#1d4ed8">${esc(x.phrase_merchant || '—')}</code></td>
      <td><span class="pill off">${esc(x.channel || 'main')}</span></td>
      <td><div class="td-actions">
        <button class="btn ghost sm" onclick="editPhrase(${x.id},'${esc(x.phrase_user)}','${esc(x.phrase_merchant || '')}')">编辑</button>
        <button class="btn danger sm" onclick="editPhrase(${x.id},'','')">清除</button>
      </div></td></tr>`).join('')}</tbody></table>`
    : emptyBox('还没有产品配暗号——下方为产品配一对口令')}
    <div class="card-head" style="margin-top:16px"><h3>为产品配置暗号</h3></div>
    <div class="row">
      <select id="phProd" class="inp" style="width:280px">${noPhrase.map((p) => `<option value="${p.id}">${esc(p.title)}</option>`).join('')}</select>
      <input id="phUser" class="inp" placeholder="用户暗号（如：放生桥边等船否）" style="width:280px">
      <input id="phMer" class="inp" placeholder="商家暗号（如：漕港河里载秋来）" style="width:280px">
      <button class="btn primary sm" onclick="savePhrase()">保存</button>
    </div></div>`
}
'''
s = s[:start] + new_phrases + s[end:]

# ── 3. 逐品佣金页重做 ──
start = s.index("async function rateov() {")
end = s.index("window.saveRate =")
old_rateov = s[start:end]
new_rateov = '''async function rateov() {
  $('#app').innerHTML = '<div class="card"><div class="sk" style="height:120px"></div></div>'
  const prods = await api('GET', '/admin/products')
  const ov = await api('GET', '/admin/rate-overrides').catch(() => [])
  const avgRate = ov.length ? (ov.reduce((s, x) => s + Number(x.promo_rate_bp), 0) / ov.length / 100).toFixed(1) : '—'
  $('#app').innerHTML = `
  <div class="kpi-grid" style="grid-template-columns:repeat(2,1fr);margin-bottom:16px">
    <div class="kpi"><div class="ico" style="background:#fdf3e0">📊</div><div><div class="l">已设覆盖</div><div class="v">${ov.length}</div><div class="s">单品费率覆盖</div></div></div>
    <div class="kpi"><div class="ico" style="background:#e8effd">📈</div><div><div class="l">平均覆盖费率</div><div class="v">${avgRate}%</div><div class="s">上限 12% · 留空=恢复档位</div></div></div>
  </div>
  <div class="card">
    <div class="card-head"><h2>逐品佣金覆盖</h2><span class="muted">D2 扩展 · 单品费率优先于推广商档位 5/8/12%</span></div>
    <div class="row">
      <select id="roProd" class="inp" style="width:280px">${prods.map((p) => `<option value="${p.id}">${esc(p.title)}</option>`).join('')}</select>
      <input id="roBp" class="inp" placeholder="费率 %（如 9.5）" style="width:150px">
      <button class="btn primary sm" onclick="saveRate()">设置覆盖</button>
      <button class="btn ghost sm" onclick="saveRate(true)">清除覆盖</button>
    </div>
    ${ov.length ? `<table><thead><tr><th>产品</th><th>单品费率</th><th>对比档位</th></tr></thead><tbody>
    ${ov.map((x) => `<tr><td class="td-main">${esc(x.title)}</td>
      <td class="money num"><b>${(Number(x.promo_rate_bp) / 100).toFixed(2)}%</b></td>
      <td><span class="pill off">档位 5/8/12% → 覆盖生效</span></td></tr>`).join('')}</tbody></table>`
    : emptyBox('暂无单品覆盖，全部走推广商档位 5/8/12%')}</div>`
}
'''
s = s[:start] + new_rateov + s[end:]

# ── 4. 实名认证页重做 ──
start = s.index("async function kyc() {")
end = s.index("window.kycResolve =")
old_kyc = s[start:end]
new_kyc = '''async function kyc() {
  $('#app').innerHTML = '<div class="card"><div class="sk" style="height:120px"></div></div>'
  const list = await api('GET', '/admin/kyc')
  const st = { 0: '<span class="pill warn">待审</span>', 1: '<span class="pill ok">已通过</span>', 2: '<span class="pill s70">已驳回</span>' }
  const pending = list.filter((x) => x.status === 0).length
  const passed = list.filter((x) => x.status === 1).length
  $('#app').innerHTML = `
  <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
    <div class="kpi"><div class="ico" style="background:#fdf3e0">📋</div><div><div class="l">待审</div><div class="v">${pending}</div><div class="s">等待人工审核</div></div></div>
    <div class="kpi"><div class="ico" style="background:#e3f6ec">✓</div><div><div class="l">已通过</div><div class="v">${passed}</div><div class="s">实名认证成功</div></div></div>
    <div class="kpi"><div class="ico" style="background:#fdecec">✗</div><div><div class="l">已驳回</div><div class="v">${list.filter((x) => x.status === 2).length}</div><div class="s">资料不符</div></div></div>
  </div>
  <div class="card">
    <div class="card-head"><h2>实名认证审核</h2><span class="muted">身份证号加密落库 · 仅展示脱敏号</span></div>
    ${list.length ? `<table><thead><tr><th>用户</th><th>姓名</th><th>证件号（脱敏）</th><th>状态</th><th>提交时间</th><th>操作</th></tr></thead><tbody>
    ${list.map((x) => `<tr><td>${esc(x.nickname || ('用户' + x.user_id))}</td><td>${esc(x.real_name)}</td><td class="num">${esc(x.id_no_mask)}</td>
      <td>${st[x.status] || x.status}</td><td class="td-sub">${String(x.created_at).slice(0, 16)}</td>
      <td>${x.status === 0 ? `<button class="btn primary sm" onclick="kycResolve(${x.id},'pass')">通过</button>
        <button class="btn danger sm" onclick="kycResolve(${x.id},'reject')">驳回</button>` : (x.reject_note ? `<span class="td-sub">${esc(x.reject_note)}</span>` : '')}</td></tr>`).join('')}</tbody></table>`
    : emptyBox('暂无实名认证申请')}</div>`
}
'''
s = s[:start] + new_kyc + s[end:]

# ── 5. 术语映射页重做 ──
start = s.index("async function terms() {")
end = s.index("/* ============ WEB3 工作区 ============ */")
old_terms = s[start:end]
new_terms = '''async function terms() {
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>术语映射</h2><span class="muted">后台 Web3 口径 ↔ 小程序合规口径 · D6 双层口径总表</span></div>
    <div class="muted" style="margin-bottom:12px">后台不上小程序审核，可用 Web3 真实词汇；两个小程序端一律走合规词。改动任何界面文案前先对照本表，避免口径串台。</div>
    <table><thead><tr><th style="width:160px">小程序合规词（用户可见）</th><th style="width:220px">后台/存证链词（内部运营）</th><th>使用边界</th></tr></thead><tbody>
    ${TERM_MAP.map((t) => `<tr><td><b style="color:var(--brand-deep)">${t[0]}</b></td><td><code>${t[1]}</code></td><td class="td-sub">${t[2]}</td></tr>`).join('')}</tbody></table>
    <div class="note" style="margin-top:14px;padding:12px;background:#fdf3e0;border-radius:8px;color:#92400e">
      <b>⚠ D6 红线：</b>不对应股权/Token 收益权、不按层级计酬、境内外隔离。链词仅出现在本后台与存证报告，<b>绝不回灌小程序</b>。
    </div></div>`
}
'''
s = s[:start] + new_terms + s[end:]

io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('all V14 pages redesigned')
