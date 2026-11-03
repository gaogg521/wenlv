// 增长与资金：旅豆预算、推广服务商、提现审批、协议变更
// 普通脚本（非模块）：与 core.js 共享全局作用域，加载顺序见 index.html

/* ============ 旅豆预算 ============ */
async function budgets() {
  $('#app').innerHTML = `<div class="card">${skel(3)}</div>`
  const rows = await api('GET', '/admin/budgets')
  const totalSum = rows.reduce((s, b) => s + Number(b.total), 0), grantedSum = rows.reduce((s, b) => s + Number(b.granted), 0)
  $('#app').innerHTML = `<div class="card">
    <div class="card-head"><h2>旅豆预算池</h2><span class="muted">发放双闸：批次 ≤ 总额+回流 且 全局 ≤ 600 万豆/年（严禁超发红线）</span></div>
    <div class="kpi-grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))">
      <div class="kpi"><div class="ico" style="background:var(--brand-soft)">🫘</div><div><div class="l">累计预算</div><div class="v num">${totalSum.toLocaleString()}</div><div class="s">豆</div></div></div>
      <div class="kpi"><div class="ico" style="background:#e3f6ec">✅</div><div><div class="l">累计发放</div><div class="v num">${grantedSum.toLocaleString()}</div><div class="s">豆 · ${(grantedSum / Math.max(totalSum, 1) * 100).toFixed(1)}%</div></div></div>
    </div>
    <div class="row"><button class="btn primary sm" onclick="budgetModal()">＋ 新建批次</button><span class="muted">批次 = 发放双闸的第一道闸：批次余额与全局哨兵双重校验</span></div>
    ${rows.length ? `<table><thead><tr><th>批次</th><th>总额</th><th>已发放</th><th>回流</th><th>余量</th><th>状态</th><th>周期</th></tr></thead><tbody>
    ${rows.map((b) => { const left = Number(b.total) + Number(b.returned) - Number(b.granted); const pct = Number(b.granted) / Math.max(Number(b.total), 1) * 100
      return `<tr><td class="td-main">${esc(b.name)}</td><td class="num">${Number(b.total).toLocaleString()}</td>
      <td><div class="num">${Number(b.granted).toLocaleString()}</div><div style="background:#eef1f5;border-radius:4px;height:5px;width:90px;margin-top:4px"><div style="background:${pct > 80 ? 'var(--red)' : 'var(--brand)'};height:5px;border-radius:4px;width:${Math.min(pct, 100)}%"></div></div></td>
      <td class="num">${Number(b.returned).toLocaleString()}</td><td class="num">${left.toLocaleString()}</td>
      <td><span class="pill ${b.status === 1 ? 'ok' : 'off'}">${b.status === 1 ? '生效' : '停用'}</span><div style="margin-top:4px"><button class="btn ghost sm" onclick="entityEditor('budget', ${b.id}, { onSaved: () => budgets() })">编辑</button> <button class="btn ghost sm" onclick="toggleBudget(${b.id}, ${b.status})">${b.status === 1 ? '停用' : '启用'}</button></div></td>
      <td class="td-sub">${esc(String(b.period_start || '').slice(0, 10))} ~ ${esc(String(b.period_end || '').slice(0, 10))}</td></tr>` }).join('')}</tbody></table>` : emptyBox('暂无预算批次')}
  </div>`
}
function budgetModal() { return entityEditor('budget', null, { onSaved: () => budgets() }) }

/* ============ 推广服务商 ============ */
async function promoters() {
  $('#app').innerHTML = `<div class="card">${skel(3)}</div>`
  const rows = await api('GET', '/admin/promoters')
  $('#app').innerHTML = `<div class="card">
    <div class="card-head"><h2>推广服务商</h2><span class="muted">一级 CPS · 三档 5% / 8% / 12% 封顶（数据库 CHECK 焊死，无层级字段）</span></div>
    <div class="row"><button class="btn primary sm" onclick="promoterModal()">＋ 开通推广资格</button>
      <span class="muted">开通后推广员在小程序 A「推广中心」生成专属海报码 · 一级 CPS 无层级</span></div>
    ${rows.length ? `<table><thead><tr><th>用户</th><th>档位</th><th>费率</th><th>90 天有效成交</th><th>评分</th><th>状态</th></tr></thead><tbody>
    ${rows.map((p) => `<tr><td><div class="td-main">${esc(p.nickname || '')}</div><div class="td-sub">ID ${p.user_id}</div></td>
      <td>${['', '基础', '优选', '金牌'][p.tier]}</td><td><b>${p.rate_bp / 100}%</b></td>
      <td class="money num">${fen(p.valid_gmv_90d)}</td><td>⭐ ${p.service_score}</td>
      <td><span class="pill ${p.status === 1 ? 'ok' : 'off'}">${p.status === 1 ? '生效' : '冻结'}</span><div style="margin-top:4px"><button class="btn ghost sm" onclick="entityEditor('promoter', ${p.user_id}, { onSaved: () => promoters() })">资料</button> <button class="btn ghost sm" onclick="togglePromoter(${p.user_id}, ${p.status})">${p.status === 1 ? '冻结' : '解冻'}</button> <button class="btn ghost sm" onclick="changePromoterTier(${p.user_id}, ${p.tier})">调档</button></div></td></tr>`).join('')}</tbody></table>` : emptyBox('还没有推广员')}
  </div>`
}
function promoterModal() {
  modal('开通推广服务商', `
    <div class="field"><label>用户 ID *</label><input id="pr_uid" type="number" placeholder="在「权益账户」按昵称搜索用户后取其 ID"></div>
    <div class="field"><label>合作档位 *</label><select id="pr_tier">
      <option value="1">基础档 · 5%（按 90 天有效成交口径计佣）</option>
      <option value="2">优选档 · 8%</option>
      <option value="3">金牌档 · 12%（平台封顶，数据库 CHECK 焊死）</option></select></div>
    <p class="muted">规则：一级 CPS、无层级裂变；费率写入后由订单结算自动分账；后续可在列表「调档/冻结」。</p>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="addPromoter()">确认开通</button>`)
}
async function addPromoter() {
  try {
    if (!Number($('#pr_uid').value)) return toast('请填写用户 ID', true)
    const uidVal = Number($('#pr_uid').value)
    const r = { ...(await api('POST', '/admin/promoters/register', { userId: Number($('#pr_uid').value), tier: Number($('#pr_tier').value) })), userId: uidVal }
    toast('已开通，费率 ' + r.rateBp / 100 + '%，请补全服务商资料'); closeModal()
    const uid = Number($('#pr_uid')?.value) || null
    await promoters()
    if (r.userId || uid) entityEditor('promoter', r.userId || uid, { onSaved: () => promoters() })
  } catch (e) { toast(e.message, true) }
}


/* ============ 提现审批（资金出口）============ */
async function withdrawals() {
  $('#app').innerHTML = `<div class="card">${skel(3)}</div>`
  // T03/T10：服务端分页 + 状态筛选（契约 { rows, total, page, pageSize }）
  window.__wdQ = window.__wdQ || { page: 1, status: '' }
  const data = await api('GET', '/admin/withdrawals?' + new URLSearchParams({ page: window.__wdQ.page, status: window.__wdQ.status }).toString())
  const rows = data.rows
  const wdPages = Math.max(1, Math.ceil(data.total / data.pageSize))
  $('#app').innerHTML = `<div class="card">
    <div class="card-head"><h2>推广服务费提现审批</h2><span class="muted">资金出口 · 财务角色审批 · 打款流水必填留痕</span></div>
    <div class="cfg-tabs">${[['', '全部'], [0, '待审'], [1, '已打款'], [2, '已驳回']].map(([v, n]) => `<button class="cfg-tab ${String(window.__wdQ.status) === String(v) ? 'on' : ''}" onclick="window.__wdQ.status='${v}';window.__wdQ.page=1;withdrawals()">${n}</button>`).join('')}</div>
    ${rows.length ? `<table><thead><tr><th>申请号</th><th>推广员</th><th>金额</th><th>备注</th><th>状态</th><th>审批</th><th>操作</th></tr></thead><tbody>
    ${rows.map((w) => `<tr><td class="num">#${w.id}</td><td>${esc(w.nickname)}${Number(w.user_status) === 0 ? ' <span class="pill s70">已冻结</span>' : ''}<div class="td-sub">ID ${w.promoter_id}</div></td>
      <td class="money num">${fen(w.amount)}</td><td class="td-sub">${esc(w.proposer_note || '')}</td>
      <td>${['<span class="pill warn">待审</span>', '<span class="pill ok">已打款</span>', '<span class="pill s70">已驳回</span>'][w.status]}</td>
      <td class="td-sub">${esc(w.reviewed_by || '—')}${w.pay_ref ? '<div>' + esc(w.pay_ref) + '</div>' : ''}</td>
      <td>${w.status === 0 ? `${Number(w.user_status) === 0 ? '<span class="td-sub">账号冻结，暂停打款</span>' : `<button class="btn primary sm" onclick="approveWithdraw(${w.id}, true)">登记实际打款</button>`}
        <button class="btn danger sm" onclick="approveWithdraw(${w.id}, false)">驳回</button>` : ''}</td></tr>`).join('')}
    </tbody></table>` : emptyBox(window.__wdQ.status !== '' ? '没有符合条件的提现申请。' : '暂无提现申请（推广员在小程序 A「推广中心」发起）')}
    <div class="pagination"><span>共 ${Number(data.total).toLocaleString()} 条 · 第 ${data.page} / ${wdPages} 页</span><div><button class="btn ghost sm" ${data.page <= 1 ? 'disabled' : ''} onclick="window.__wdQ.page--;withdrawals()">上一页</button> <button class="btn ghost sm" ${data.page >= wdPages ? 'disabled' : ''} onclick="window.__wdQ.page++;withdrawals()">下一页</button></div></div>
  </div>`
}
async function approveWithdraw(id, pass) {
  const payRef = pass ? prompt('请先完成实际支付，填写回单中的真实打款流水号：', '') : null
  if (pass && !payRef) return
  try { await api('POST', '/admin/withdrawals/' + id + '/verdict', { pass, payRef }); toast(pass ? '已打款并留痕' : '已驳回'); withdrawals() } catch (e) { toast(e.message, true) }
}


/* ============ 协议变更 ============ */
async function agreements() {
  $('#app').innerHTML = `<div class="card">${skel(3)}</div>`
  const rows = await api('GET', '/admin/agreements')
  $('#app').innerHTML = `<div class="card">
    <div class="card-head"><h2>商户协议变更</h2><span class="muted">生效即重算五口径分账 · 财务审批</span></div>
    ${rows.length ? `<table><thead><tr><th>商户</th><th>科目</th><th>变更</th><th>理由</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${rows.map((a) => `<tr><td class="td-main">${esc(a.merchant_name)}</td><td><code>${esc(a.item_code)}</code></td>
      <td><span class="diff-old">${fen(a.old_price)}</span> → <span class="diff-new">${fen(a.new_price)}</span></td>
      <td class="td-sub">${esc(a.reason || '')}</td>
      <td>${['<span class="pill warn">待审</span>', '<span class="pill ok">生效</span>', '<span class="pill s70">驳回</span>'][a.status]}</td>
      <td>${a.status === 0 ? `<button class="btn primary sm" onclick="verdict('agreements', ${a.id}, true)">同意</button>
        <button class="btn danger sm" onclick="verdict('agreements', ${a.id}, false)">驳回</button>` : ''}</td></tr>`).join('')}
    </tbody></table>` : emptyBox('暂无协议变更申请（商户端小程序 B 发起）')}
  </div>`
}
async function verdict(kind, id, pass) {
  try { await api('POST', `/admin/${kind}/${id}/verdict`, { pass }); toast(pass ? '已通过' : '已驳回'); kind === 'content' ? content() : agreements() } catch (e) { toast(e.message, true) }
}
