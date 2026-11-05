// 交易履约：订单详情/退款、商品与团期、商户、结算
// 普通脚本（非模块）：与 core.js 共享全局作用域，加载顺序见 index.html

/* ============ 订单 ============ */
async function orderDrawer(no) {
  const o = await api('GET', '/admin/orders/' + no)
  drawer(`订单 ${esc(o.order_no)}`, `
    <div class="order-service-actions">
      ${adminCan('order.service') ? `<button class="btn primary sm" onclick="editOrderContact('${esc(o.order_no)}')" ${[10,20,30].includes(Number(o.status)) ? '' : 'disabled title="已核销或已终结订单保留原联系人"'}>修正联系人</button><button class="btn ghost sm" onclick="orderServiceNote('${esc(o.order_no)}')">添加客服备注</button>` : '<span class="muted">当前角色可查看订单；联系人修正与备注需运营权限</span>'}
      ${adminCan('order.refund') && [20,30,40].includes(Number(o.status)) ? `<button class="btn danger sm" onclick="refundOrder('${esc(o.order_no)}')">处理退款</button>` : ''}
      ${Number(o.status) === 10 && adminCan('order.service') ? `<button class="btn danger sm" onclick="cancelUnpaidOrder('${esc(o.order_no)}')">取消未支付订单</button>` : ''}
      ${adminCan('ticket.manage') || adminCan('order.service') ? `<button class="btn ghost sm" onclick="ticketCreateModal('${esc(o.order_no)}')">发起售后</button>` : ''}
      ${['super','ops'].includes(ME?.role) && [20,30].includes(Number(o.status)) ? `<button class="btn primary sm" onclick="rescheduleModal('${esc(o.order_no)}')">改期 / 换团</button>` : ''}
      ${['super','ops'].includes(ME?.role) ? `<button class="btn ghost sm" onclick="rescheduleDrawer('${esc(o.order_no)}')">改期记录</button>` : ''}
    </div>
    ${(o.tickets?.length) ? `<h3 style="margin:16px 0 8px">售后工单</h3><table>
      ${o.tickets.map((t) => `<tr><td class="num">${esc(t.ticket_no)}</td><td>${TICKET_CAT[t.category] || esc(t.category)}<div class="td-sub">${esc(t.assignee || '待认领')}</div></td>
        <td>${TICKET_ST[t.status] || t.status}</td>
        <td><button class="btn ghost sm" onclick="closeModal();window.__tkQ.page=1;tickets().then(() => setTimeout(() => ticketDrawer(${t.id}), 600))">时间线</button></td></tr>`).join('')}</table>` : ''}
    <div class="row" style="gap:8px"><span class="pill s${o.status}">${ST[o.status]}</span>
      <span class="money" style="font-size:18px">${fen(o.amount_pay)}</span>
      ${o.bean_deducted ? `<span class="pill warn">抵扣 ${o.bean_deducted} 豆</span>` : ''}</div>
    <table style="margin-top:10px">
      <tr><td class="td-sub" style="width:90px">商品</td><td class="td-main">${esc(o.title)}</td></tr>
      <tr><td class="td-sub">用户</td><td>${esc(o.nickname)}（ID ${o.user_id}）</td></tr>
      <tr><td class="td-sub">联系人</td><td>${esc(o.contact_name || '—')}</td></tr>
      <tr><td class="td-sub">联系电话</td><td>${esc(o.contactPhone || '—')}</td></tr>
      <tr><td class="td-sub">支付流水</td><td class="num">${esc(o.pay?.wx_trans_no || '—')} ${o.pay ? `<span class="pill ${o.pay.status === 1 ? 'ok' : 'off'}">${['待支付', '成功', '关闭', '退款中', '已退款'][o.pay.status]}</span>` : ''}</td></tr>
    </table>
    ${o.passes?.length ? `<h3 style="margin:16px 0 8px">入园凭证</h3><table>
      ${o.passes.map((p) => `<tr><td>#${p.id} ${esc(p.name)}</td><td><span class="pill ${p.status === 1 ? 's30' : p.status === 2 ? 's50' : 'off'}">${['', '待核销', '已核销', '已过期', '已冲正'][p.status]}</span></td></tr>`).join('')}</table>` : ''}
    ${o.refunds?.length ? `<h3 style="margin:16px 0 8px">退款单</h3><table>
      ${o.refunds.map((r) => `<tr><td class="num">${esc(r.refund_no)}<div class="td-sub">${esc(r.operator || '')} · ${esc(r.reason || '')}</div></td>
        <td>实退 <b>${fen(r.amount)}</b>${Number(r.fee_amount) ? `<div class="td-sub">手续费 ${fen(r.fee_amount)}（${Math.round(Number(r.fee_rate) * 1000) / 10}% · 距出发 ${r.days_to_depart} 天）</div>` : '<div class="td-sub">全额</div>'}</td>
        <td><span class="pill ${Number(r.status) === 2 ? 's50' : 's60'}">${['申请', '处理中', '已退款', '已拒绝'][r.status] || r.status}</span></td></tr>`).join('')}</table>` : ''}
    <h3 style="margin:16px 0 10px">客服处理记录</h3>
    ${(o.serviceRecords || []).map(r => { let v = r.after_val; if (typeof v === 'string') { try { v = JSON.parse(v) } catch { v = {} } } return `<div class="rv-box"><b>${r.action === 'contact-update' ? '联系人修正' : '客服备注'}</b><p>${esc(v?.note || [v?.name,v?.phone,v?.reason].filter(Boolean).join(' · '))}</p><span class="td-sub">${esc(r.actor)} · ${esc(String(r.created_at).slice(0,19))}</span></div>` }).join('') || '<p class="muted">暂无客服处理记录</p>'}
    <h3 style="margin:16px 0 10px">状态机时间线（order_event 审计）</h3>
    <ul class="tl">${(o.events || []).map((e) => `<li>
      <div class="t">${ST[e.from_st] || e.from_st} → ${ST[e.to_st] || e.to_st}</div>
      <div class="d">${esc(String(e.detail || '').replace(/"/g, ''))} · ${esc(e.actor)} · ${esc(String(e.created_at).slice(5, 19))}</div></li>`).join('')}</ul>`)
}
// 取消未支付订单（T04）：走订单状态机，释放名额与旅豆；与支付回调并发由状态守卫裁决
window.cancelUnpaidOrder = (no) => {
  modal('取消未支付订单 · ' + esc(no), `
    <p class="td-sub">仅待支付订单可取消；将释放占用名额、退回已抵扣旅豆并写入订单事件。若支付回调先到达，取消会失败并提示核对（不会出现已付款却无订单）。</p>
    <div class="field"><label>取消原因 *（4–200 字，进入审计与订单事件）</label><input id="cuReason" maxlength="200"></div>
    <div id="cuErr" class="td-sub" style="color:var(--red)"></div>`,
    `<button class="btn ghost" onclick="closeModal()">返回</button><button class="btn danger" onclick="cancelUnpaidSubmit('${esc(no)}')">确认取消</button>`)
}
window.cancelUnpaidSubmit = async (no) => {
  try {
    await api('POST', '/admin/orders/' + no + '/cancel-unpaid', { reason: ($('#cuReason').value || '').trim() })
    closeModal(); toast('订单已取消，名额已释放'); orders()
  } catch (e) { $('#cuErr').textContent = e.message }
}
async function editOrderContact(no) {
  if (!adminCan('order.service')) return toast(adminWhy('order.service'), true)
  const o = await api('GET', '/admin/orders/' + no)
  modal('修正订单联系人', `<p class="muted">只修正履约联系方式，不改变订单买家、出行人、价格或团期。当前号码 ${esc(o.contactPhone || '未填写')}。</p><div class="field"><label>联系人</label><input id="serviceName" maxlength="64" value="${esc(o.contact_name || '')}"></div><div class="field"><label>新手机号（不修改留空）</label><input id="servicePhone" type="tel" maxlength="11" autocomplete="off"></div><div class="field"><label>修改原因（必填）</label><textarea id="serviceReason" maxlength="300"></textarea></div>`, `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="saveOrderContact('${esc(no)}')">保存修正</button>`)
}
async function saveOrderContact(no) {
  try {
    await api('POST', '/admin/orders/' + no + '/contact', { name: $('#serviceName').value, phone: $('#servicePhone').value, reason: $('#serviceReason').value })
    toast('联系人已修正，记录已保存'); closeModal(); await orderDrawer(no)
  } catch (e) { toast(e.message, true) }
}
function orderServiceNote(no) {
  if (!adminCan('order.service')) return toast(adminWhy('order.service'), true)
  modal('添加客服备注', '<p class="muted">仅后台可见，保存后保留操作人和时间。请勿录入完整手机号、证件号等敏感信息。</p><textarea id="serviceNote" maxlength="500" placeholder="4–500 字，记录诉求、核实情况与处理结论"></textarea>', `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="saveOrderServiceNote('${esc(no)}')">保存备注</button>`)
}
async function saveOrderServiceNote(no) {
  try { await api('POST', '/admin/orders/' + no + '/service-notes', { note: $('#serviceNote').value }); toast('客服备注已保存'); closeModal(); await orderDrawer(no) }
  catch (e) { toast(e.message, true) }
}
async function refundOrder(no) {
  let qt = null
  try { qt = (await api('GET', '/admin/orders/' + no)).refundQuote } catch (e) { /* 试算失败不阻断客服全额处理 */ }
  const policyLine = !qt ? '<p class="muted">该订单已核销或状态不适用退改梯度，只能由客服全额处理。</p>'
    : qt.allowed ? `<p>按退改规则：距出发 <b>${qt.daysToDepart}</b> 天，手续费 <b>${fen(qt.feeFen)}</b>（${Math.round(qt.rate * 1000) / 10}%），实退 <b>${fen(qt.refundFen)}</b>。</p>`
    : `<p class="muted">按退改规则不可自助退款：${esc(qt.reason)}</p>`
  modal('退款处理', `<p>订单 <code>${esc(no)}</code></p>${policyLine}
    <label>处理原因（写入审计与存证）</label><textarea id="rf_reason" placeholder="如：游客行程变更 / 已核销售后，经核实服务未履约"></textarea>
    <p class="muted" style="margin-top:8px">两种方式都会执行全量冲正：原路退款 · 退回抵扣旅豆 · 入园凭证作废 · 关联佣金置无效。</p>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button>
     ${qt && qt.allowed ? `<button class="btn ghost" onclick="doRefund('${no}','policy')">按规则退 ${fen(qt.refundFen)}</button>` : ''}
     <button class="btn danger" onclick="doRefund('${no}','full')">全额退款（客服特批）</button>`)
}
async function doRefund(no, mode) {
  const reason = ($('#rf_reason')?.value || '').trim()
  if (mode === 'full' && !reason) return toast('全额特批请填写处理原因', true)
  try {
    const r = await api('POST', '/admin/orders/' + no + '/refund', { mode, reason })
    closeModal()
    toast(r.refunded ? `退款完成：实退 ${fen(r.refundFen)}${r.feeFen ? '，手续费 ' + fen(r.feeFen) : ''}` : '退款已受理，待支付通道确认')
    orders()
  } catch (e) { toast(e.message, true) }
}
async function completeOrder(no) {
  try { await api('POST', '/admin/dev/complete', { orderNo: no }); toast('观察期结束：返豆与佣金已入账'); orders() }
  catch (e) { toast(e.message, true) }
}


/* ============ 商品与团期 ============ */
async function products() {
  $('#app').innerHTML = `<div class="card">${skel(5)}</div>`
  const [rows, merchantRows, supRows, scenRows, info] = await Promise.all([api('GET', '/admin/products'), api('GET', '/admin/merchants'),
    ADMIN_CAPABILITIES.modules.includes('suppliers') ? api('GET', '/admin/suppliers').catch(() => []) : Promise.resolve([]), api('GET', '/admin/scenics').catch(() => []), eeCompleteness('product')])
  const supOpts = supRows.filter((s) => s.status === 1).map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')
  const scenOpts = scenRows.filter((s) => s.status === 1).map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')
  const F = window.__fprod || (window.__fprod = { sup: '', scn: '' })
  const frs = rows.filter((p) => (!F.sup || String(p.supplier_id || '') === F.sup) && (!F.scn || String(p.scenic_id || '') === F.scn))
  $('#app').innerHTML = `<div class="card">
    <div class="card-head"><h2>商品与团期</h2>${EXPBTN('products', '商品 CSV')}${adminCan('entity.product.create') ? `<button class="btn primary sm" onclick="entityEditor('product', null, { onSaved: (id) => products().then(() => sessionsDrawer(id)) })">＋ 新增线路</button>` : '<span class="muted">当前角色仅查看，商品维护需运营权限</span>'}</div>
    <p class="muted" style="margin-bottom:6px">新建线路会打开完整编辑器：基本信息 → 图文 → 行程节点 → 费用须知 → 履约资源 → 分享设置；保存后添加团期，检查无误再上架。</p>
    <div class="row" style="margin:10px 0 0">
      <select id="f_supplier" onchange="window.__fprod={sup:this.value,scn:document.getElementById('f_scenic').value};products()">
        <option value="">全部供应商</option>${supRows.map((s) => `<option value="${s.id}" ${F.sup === String(s.id) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
      <select id="f_scenic" onchange="window.__fprod={sup:document.getElementById('f_supplier').value,scn:this.value};products()">
        <option value="">全部景区</option>${scenRows.map((s) => `<option value="${s.id}" ${F.scn === String(s.id) ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
      <span class="muted">筛选出 ${frs.length}/${rows.length} 条线路</span>
    </div>
    ${frs.length ? `<table><thead><tr><th></th><th>商品</th><th>分类</th><th>城市</th><th>价格</th><th>履约商户</th><th>供给链</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${frs.map((p) => `<tr>
      <td>${eeThumb(info[p.id])}</td>
      <td><div class="td-main">${esc(p.title)}</div><div class="td-sub">${esc(p.days_desc || '')}${p.bean_gift ? ' · 完成得 ' + p.bean_gift + ' 豆' : ''}</div>${eeBar(info[p.id])}</td>
      <td><span class="pill off">${esc(CAT_CN[p.cat] || p.cat)}</span></td><td>${esc(CITY_CN[p.city_code] || p.city_code)}</td>
      <td class="money num">${fen(p.price_from)}</td><td class="td-sub">${esc(p.merchant_name || p.merchant_id)}</td>
      <td class="td-sub">${p.supplier_name ? '供:' + esc(p.supplier_name) : ''}${p.supplier_name && p.scenic_name ? '<br>' : ''}${p.scenic_name ? '景:' + esc(p.scenic_name) : ''}${!p.supplier_name && !p.scenic_name ? '—' : ''}</td>
      <td><span class="pill ${p.status === 1 ? 'ok' : 'off'}">${p.status === 1 ? '上架' : '下架'}</span></td>
      <td><button class="btn ghost sm" onclick="productProfile(${p.id})">数据</button> ${adminCan('product.status') ? `<button class="btn ghost sm" onclick="toggleProduct(${p.id}, ${p.status === 1 ? 0 : 1})">${p.status === 1 ? '下架' : '上架'}</button>` : ''}
          <button class="ghost btn sm" style="border-color:var(--line);color:var(--ink2)" onclick="sessionsDrawer(${p.id})">团期</button>
          ${adminCan('entity.product.edit') ? `<button class="ghost btn sm" style="border-color:var(--line);color:var(--ink2)" onclick="editProduct(${p.id})">编辑资料</button>` : ''}
          <button class="ghost btn sm" style="border-color:var(--line);color:var(--ink2)" onclick="productVersions(${p.id})">变更历史</button></td>
    </tr>`).join('')}</tbody></table>` : emptyBox(F.sup || F.scn ? '筛选条件下暂无线路：清一下筛选再试' : '还没有商品——点右上「新增线路」录入第一条')}
  </div>`
}

/* 商品编辑 + 素材（P0 宣传力：实拍图集/行程/费用包含/集合点/安全告知） */
let EDIT_P = null
async function editProduct(id) { return entityEditor('product', id, { onSaved: () => products() }) }
function lines(v) { return v.split('\n').map((s) => s.trim()).filter(Boolean) }
async function toggleProduct(id, status) { try { await api('POST', `/admin/products/${id}/status`, { status }); products() } catch (e) { toast(e.message, true) } }
function sessionModal(pid, priceFen) { return entityEditor('session', null, { parentId: pid, defaults: priceFen ? { price_adult: priceFen / 100 } : {}, onSaved: () => sessionsDrawer(pid) }) }
/** 团期管理：列出某线路全部团期，逐个用完整编辑器维护 */
async function sessionsDrawer(pid) {
  const d = await api('GET', '/admin/products/' + pid + '/sessions')
  const STS = { 1: '报名中', 2: '已成团', 3: '已截止', 4: '已取消', 5: '未成团' }
  drawer('团期管理 · ' + esc(d.title), `
    <div class="row" style="margin:0 0 12px">${adminCan('entity.session.create') ? `<button class="btn primary sm" onclick="sessionModal(${pid}, ${d.priceFrom})">＋ 新增团期</button>` : '<span class="muted">团期维护需运营权限</span>'}<span class="muted">${d.sessions.length} 个团期</span></div>
    ${d.sessions.length ? `<table><thead><tr><th>出发日</th><th>价格</th><th>报名/名额</th><th>状态</th><th></th></tr></thead><tbody>
    ${d.sessions.map((x) => `<tr><td class="num">${esc(String(x.depart_date).slice(0, 10))}</td><td class="money num">${fen(x.price_adult)}${x.early_price ? `<div class="td-sub">早鸟 ${fen(x.early_price)}</div>` : ''}</td>
      <td class="num">${x.booked}/${x.quota}<div class="td-sub">${x.min_go} 人成团</div></td><td><span class="pill ${x.status === 1 ? 's30' : 'off'}">${STS[x.status] || x.status}</span></td>
      <td>${adminCan('entity.session.edit') ? `<button class="btn ghost sm" onclick="entityEditor('session', ${x.id}, { onSaved: () => sessionsDrawer(${pid}) })">编辑</button>` : '<span class="muted">仅查看</span>'}</td></tr>`).join('')}</tbody></table>` : emptyBox('还没有团期')}`)
}

/* ============ 商户 ============ */
async function merchants() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  const [rows, info, mlv] = await Promise.all([api('GET', '/admin/merchants'), eeCompleteness('merchant'), api('GET', '/admin/merchant/levels').catch(() => [])])
  const lvName = (n) => ((mlv.find((l) => l.lv === Number(n)) || {}).name) || ('Lv' + n)
  $('#app').innerHTML = `<div class="card">
    <div class="card-head"><h2>商户（履约方）</h2>${EXPBTN('merchants', '商户 CSV')}<span class="muted">收付通二级商户进件后填入子商户号</span></div>
    <div class="row" style="margin-top:0">${adminCan('entity.merchant.create') ? '<button class="btn primary sm" onclick="addMerchant()">＋ 新增商户</button>' : ''}<span class="muted">品牌门店 · 营业信息 · 资质证照 · 结算账户 · 联系人与合作，新建后进入"进件中"，审核通过方可履约</span></div>
    ${rows.length ? `<table><thead><tr><th></th><th>商户号</th><th>名称</th><th>类目</th><th>城市</th><th>收付通子商户</th><th>评分</th><th>经营等级</th><th>状态</th></tr></thead><tbody>
    ${rows.map((m) => `<tr><td>${eeThumb(info[m.id])}</td><td class="num">${esc(m.merchant_no)}</td><td><div class="td-main">${esc(m.name)}</div>${eeBar(info[m.id])}</td><td><span class="pill off">${esc(MERCHANT_KIND[m.kind] || '其他')}</span></td><td>${esc(CITY_CN[m.city_code] || m.city_code)}</td>
      <td class="num">${esc(m.wxpay_sub_mchid || '—')}</td><td>⭐ ${m.score}</td><td><img src="/badge-art/mlevel/${Number(m.level) || 1}.svg" width="28" height="28" style="vertical-align:middle" alt=""> ${esc(lvName(m.level))}</td>
      <td><span class="pill ${m.status === 1 ? 'ok' : 'warn'}">${m.status === 1 ? '生效' : '进件中'}</span><div style="margin-top:4px"><button class="btn primary sm" onclick="merchantProfile(${m.id})">全景</button> ${adminCan('entity.merchant.edit') ? `<button class="btn ghost sm" onclick="editMerchant(${m.id},'${esc(m.name)}','${esc(m.city_code)}','${esc(m.wxpay_sub_mchid || '')}','${esc(m.kind || 'other')}')">编辑</button>` : ''}</div><div style="margin-top:4px">${m.status === 0 && adminCan('merchant.approve') ? `<button class="btn primary sm" onclick="approveMerchant(${m.id})">审批通过</button>` : (m.status === 0 ? '<span class="td-sub">待运营/超管审批</span>' : '')}</div></td></tr>`).join('')}</tbody></table>` : emptyBox('暂无商户')}
  </div>`
}
async function addMerchant() { return entityEditor('merchant', null, { onSaved: () => merchants() }) }

/* ============ 结算 ============ */
async function settlements() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  const rows = await api('GET', '/admin/settlements')
  const COLORS = ['#2563eb', '#0ea5e9', '#d97706', '#7c3aed', '#64748b']
  const NAMES = ['履约结算', '平台服务费', '推广服务费', '权益预算', '留存毛利']
  $('#app').innerHTML = `<div class="card">
    <div class="card-head"><h2>商户周结算</h2>${EXPBTN('settlements', '结算 CSV')}
      <button class="btn primary sm" onclick="genSettlements()">生成本周结算单</button></div>
    <p class="muted" style="margin:-8px 0 14px">商户确认 → 财务复核 → 实际支付 → 回单登记。当前为人工回单模式，复核不会自动划款。
      退改手续费按商户资料「退改手续费分成」或参数中心 <code>settlement.refund_fee_merchant_pct</code> 计入，生成时快照比例。</p>
    ${rows.length ? rows.map((s) => {
      const parts = [Number(s.amt_fulfill), Number(s.amt_service), Number(s.amt_promoter), Number(s.amt_beanbudget), Number(s.amt_retained)]
      const total = Number(s.total_amount) || 1 // 只有手续费、无订单的结算单 total=0，按 1 防除零
      return `<div style="padding:14px 0;border-bottom:1px solid #f1f4f8">
      <div class="row" style="justify-content:space-between;margin:0 0 10px">
        <div><b>${esc(s.merchant_name)}</b> <span class="muted">${esc(s.period)} · ${s.order_count} 单</span></div>
        <div><span class="money" style="font-size:16px">${fen(s.total_amount)}</span>
          <span class="pill ${s.status === 3 ? 'ok' : s.status === 4 ? 'warn' : 'off'}" style="margin-left:10px">${['待商户确认', '待财务复核', '待实际支付', '已登记支付回单', '异议处理中'][s.status]}</span>
          ${s.status === 1 ? `<button class="btn primary sm" style="margin-left:10px" onclick="confirmSettle(${s.id})">财务复核</button>` : ''}${s.status === 2 ? `<button class="btn primary sm" onclick="paymentReceipt(${s.id})">登记支付回单</button>` : ''}${s.status === 4 ? `<button class="btn ghost sm" style="margin-left:10px" onclick="resolveDispute(${s.id})">处理异议</button>` : ''}</div>
      </div>
      ${Number(s.total_amount) > 0 ? `<div class="split-bar">${parts.map((v, i) => `<span style="background:${COLORS[i]};flex:${Math.max(v, 1)}">${v ? Math.round(v / total * 100) + '%' : ''}</span>`).join('')}</div>` : '<p class="muted" style="margin:0">本期无完成订单，仅计入退改手续费</p>'}
      ${s.payment_ref ? `<p class="muted">支付流水 ${esc(s.payment_ref)} · ${esc(s.paid_at || '')} · ${esc(s.payment_note || '')}</p>` : ''}
      <div class="split-legend" ${Number(s.total_amount) > 0 ? '' : 'hidden'}>${NAMES.map((n, i) => `<span><em style="width:9px;height:9px;border-radius:3px;display:inline-block;background:${COLORS[i]};margin-right:5px"></em>${n} ${fen(parts[i])}</span>`).join('')}</div>
      ${Number(s.fee_total) ? `<div class="fee-line"><span>退改手续费 <b>${fen(s.fee_total)}</b>（${s.fee_count} 笔）</span>
        <span>商户分成 ${s.fee_share_bp != null ? (Number(s.fee_share_bp) / 100) + '%' : '—'} · <b>${fen(s.fee_merchant)}</b></span><span>平台 <b>${fen(s.fee_platform)}</b></span></div>` : ''}
      ${s.split_snapshot ? (() => { const sp = typeof s.split_snapshot === 'string' ? JSON.parse(s.split_snapshot) : s.split_snapshot; return `<p class="muted" style="margin:6px 0 0">本单比例快照：履约 ${sp.fulfill / 100}% · 服务费 ${sp.service / 100}% · 权益 ${sp.beanbudget / 100}%（参数中心 settlement.split_*）</p>` })() : ''}
      <div class="payable-line">应付商户 <b>${fen(Number(s.amt_fulfill) + Number(s.fee_merchant || 0))}</b><span class="muted">= 履约结算 ${fen(s.amt_fulfill)}${Number(s.fee_merchant) ? ' + 手续费分成 ' + fen(s.fee_merchant) : ''}</span></div>
    </div>` }).join('') : emptyBox('暂无结算单——有已完成订单后点右上角生成')}
  </div>`
}
async function genSettlements() {
  try {
    const r = await api('POST', '/admin/settlements/generate', {})
    const n = (r.created || []).length
    toast(n ? `已生成 ${n} 份结算单（${r.period}；同周已出过账的商户出补充单）` : `没有新的可结算订单或手续费（${r.period}）`)
    settlements()
  } catch (e) { toast(e.message, true) }
}
async function resolveDispute(id) {
  const note = prompt('异议处理说明（处理后交回商户重新确认）：', '')
  if (!note || !note.trim()) return
  try { await api('POST', '/admin/settlements/' + id + '/dispute', { note }); toast('异议已处理'); settlements() } catch (e) { toast(e.message, true) }
}
async function confirmSettle(id) {
  try { await api('POST', `/admin/settlements/${id}/confirm`, {}); toast('复核通过，待实际支付并登记回单'); settlements() } catch (e) { toast(e.message, true) }
}

function paymentReceipt(id) {
  modal('登记实际支付回单', `<p class="muted">请先核对收款商户、应结金额与实际银行/支付平台回单。本操作只登记支付证据。</p><label>支付流水号</label><input id="receiptRef" maxlength="128" placeholder="填写回单中的真实流水号"><label>核对说明</label><textarea id="receiptNote" maxlength="500" placeholder="收款方、金额、支付日期与核对说明"></textarea><div id="receiptError" class="lerr"></div>`, `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="savePaymentReceipt(${id})">确认登记</button>`)
}
async function savePaymentReceipt(id) {
  try {
    await api('POST', '/admin/settlements/' + id + '/payment', { paymentRef: $('#receiptRef').value.trim(), note: $('#receiptNote').value.trim() })
    closeModal(); toast('回单已登记，可在审计日志追溯'); settlements()
  } catch (e) { $('#receiptError').textContent = e.message }
}

// ===== R-02：改期 / 换团（申请 → 审批 → 执行；价差与旅豆抵扣显式化，资金边界如实）=====
window.rescheduleModal = async (orderNo) => {
  const o = await api('GET', '/admin/orders/' + orderNo)
  const sess = await api('GET', '/admin/products/' + o.product_id + '/sessions')
  const others = (sess.sessions || sess || []).filter((s) => Number(s.id) !== Number(o.session_id) && Number(s.status) === 1 && Number(s.quota) - Number(s.booked) >= Number(o.qty))
  const cur = (sess.sessions || sess || []).find((s) => Number(s.id) === Number(o.session_id))
  if (!others.length) return toast('没有可换的目标团期（需同商品、在售且名额足够）', true)
  modal('改期 / 换团 · ' + orderNo, `
    <p class="td-sub">当前团期：${cur ? esc(String(cur.depart_date).slice(0, 10)) : o.session_id} · ${Number(o.qty)} 人 · 订单金额 ${fen(o.amount_pay)}</p>
    <div class="field"><label>目标团期 *（同商品、在售、名额足够）</label>
      <select id="rsTo" class="inp" onchange="rescheduleDiff(${o.product_id})">${others.map((s) => `<option value="${s.id}" data-price="${s.price_adult}">${esc(String(s.depart_date).slice(0, 10))} · 剩 ${Number(s.quota) - Number(s.booked)} 位 · ¥${(Number(s.price_adult) / 100).toFixed(0)}</option>`).join('')}</select></div>
    <p class="td-sub" id="rsDiff">价差以选择后计算为准。</p>
    <div class="field"><label>游客旅豆抵扣补款（分，选填；不超过需补款价差）</label><input id="rsBean" type="number" min="0" value="0"></div>
    <div class="field"><label>改期原因 *（4–300 字，进入审计与时间线）</label><input id="rsReason" maxlength="300" placeholder="例如：游客临时行程变化，申请换至下周同款团期"></div>
    <p class="td-sub">流程：提交申请 → 另一位超级管理员审批 → 执行换团（执行时再校验名额与订单状态）。需补款/应退差在执行后如实登记，走财务流程，不在系统内虚构到账。</p>
    <div id="rsErr" class="td-sub" style="color:var(--red)"></div>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="rescheduleSubmit('${esc(orderNo)}')">提交申请</button>`)
  rescheduleDiff(o.product_id, o.qty)
}
window.rescheduleDiff = (productId) => {
  const sel = document.getElementById('rsTo')
  if (!sel) return
  const opt = sel.options[sel.selectedIndex]
  void productId
  document.getElementById('rsDiff').textContent = '所选团期单价：¥' + (Number(opt?.dataset.price || 0) / 100).toFixed(0) + '——价差以提交时服务端计算为准（正=需补款，负=应退差）。'
}
window.rescheduleSubmit = async (orderNo) => {
  try {
    const r = await api('POST', '/admin/orders/' + orderNo + '/reschedule', {
      toSessionId: Number(document.getElementById('rsTo').value),
      reason: ($('#rsReason').value || '').trim(),
      diffBean: Number(document.getElementById('rsBean').value) || 0,
    })
    closeModal(); toast('申请 ' + r.reqNo + ' 已提交（' + r.note + '），待另一位超级管理员审批'); orderDrawer(orderNo)
  } catch (e) { $('#rsErr').textContent = e.message }
}
const RS_ST_PILL = { 0: '<span class="pill warn">待审批</span>', 1: '<span class="pill s20">待执行</span>', 2: '<span class="pill off">已驳回</span>', 3: '<span class="pill ok">已执行</span>', 4: '<span class="pill off">已撤回</span>', 5: '<span class="pill s70">执行失败</span>' }
const rescheduleIsApplicant = (r) => r.applicant_uid != null
  ? ME?.uid == null || Number(r.applicant_uid) === Number(ME.uid)
  : r.applicant === 'admin:' + (ME?.displayName || ME?.username || '')
window.rescheduleDrawer = async (orderNo) => {
  const d = await api('GET', '/admin/reschedules?kw=' + encodeURIComponent(orderNo) + '&pageSize=20')
  drawer('改期记录 · ' + esc(orderNo), `
    ${d.rows.length ? `<table><thead><tr><th>申请号</th><th>换至</th><th>价差 / 旅豆抵扣</th><th>状态</th><th>申请人 / 审批</th><th>操作</th></tr></thead><tbody>
    ${d.rows.map((r) => `<tr><td class="num td-sub">${esc(r.req_no)}</td>
      <td class="td-sub">${esc(r.product_title || '')}<br>团期 #${r.to_session_id}</td>
      <td class="num">${r.price_diff > 0 ? '补 ' + fen(r.price_diff) : r.price_diff < 0 ? '退 ' + fen(-r.price_diff) : '同价'}${Number(r.diff_bean) ? '<br><span class="td-sub">旅豆抵 ' + fen(r.diff_bean) + '</span>' : ''}</td>
      <td>${RS_ST_PILL[r.status] || r.status}${r.exec_note ? '<div class="td-sub">' + esc(r.exec_note) + '</div>' : ''}</td>
      <td class="td-sub">${esc(r.applicant || '')}${r.approver ? '<br>审批：' + esc(r.approver) : ''}</td>
      <td><div class="td-actions">
        ${Number(r.status) === 0 && ME?.role === 'super' && !rescheduleIsApplicant(r) ? `<button class="btn primary sm" onclick="rescheduleVerdict(${r.id}, 1, '${esc(orderNo)}')">通过</button><button class="btn danger sm" onclick="rescheduleVerdict(${r.id}, 0, '${esc(orderNo)}')">驳回</button>` : ''}
        ${Number(r.status) === 0 && (rescheduleIsApplicant(r) || ME?.role === 'super') ? `<button class="btn ghost sm" onclick="rescheduleCancel(${r.id}, '${esc(orderNo)}')">撤回</button>` : ''}
        ${Number(r.status) === 1 && ['super','ops'].includes(ME?.role) ? `<button class="btn primary sm" onclick="rescheduleExec(${r.id}, '${esc(orderNo)}')">执行换团</button>` : ''}
      </div></td></tr>`).join('')}</tbody></table>` : emptyBox('该订单暂无改期申请')}
    <p class="td-sub">执行时服务端会再次校验订单状态与目标团期名额；失败整体回滚并登记「执行失败」，可重新发起。</p>`)
}
window.rescheduleVerdict = async (id, pass, orderNo) => {
  modal(pass ? '通过改期申请' : '驳回改期申请', `
    <p class="td-sub">${pass ? '通过后进入「待执行」，执行时再校验名额与订单状态；审批人不能与申请人相同。' : '驳回后申请终态；如需再改请重新发起申请。'}</p>
    <div class="field"><label>审批意见（选填，进入审计）</label><input id="rsVerdictNote" maxlength="300"></div>
    <div id="rsVerdictErr" class="td-sub" style="color:var(--red)"></div>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn ${pass ? 'primary' : 'danger'}" onclick="rescheduleVerdictSubmit(${id}, ${pass ? 1 : 0}, '${esc(orderNo)}')">确认${pass ? '通过' : '驳回'}</button>`)
}
window.rescheduleVerdictSubmit = async (id, pass, orderNo) => {
  try {
    const r = await api('POST', `/admin/reschedules/${id}/verdict`, { pass: pass === 1, note: ($('#rsVerdictNote').value || '').trim() })
    closeModal(); toast(r.note || '已处理'); rescheduleDrawer(orderNo)
  } catch (e) { $('#rsVerdictErr').textContent = e.message }
}
window.rescheduleExec = async (id, orderNo) => {
  if (!confirm('执行换团会转移名额并按价差调整订单金额（旅豆抵扣同时扣减）；失败会整体回滚。确定执行？')) return
  try { const r = await api('POST', `/admin/reschedules/${id}/execute`); toast(r.status === 3 ? '已执行换团' : '已处理'); rescheduleDrawer(orderNo) } catch (e) { toast(e.message, true) }
}
window.rescheduleCancel = async (id, orderNo) => {
  try { await api('POST', `/admin/reschedules/${id}/cancel`); toast('已撤回'); rescheduleDrawer(orderNo) } catch (e) { toast(e.message, true) }
}

// ===== R-01：商品关键变更历史（版本簿只增不改；恢复=写一条新版本把旧值带回来）=====
const VER_FIELD_CN = { price_from: '起售价', title: '线路标题', bean_gift: '完成赠豆', status: '状态', supplier_id: '供应商', scenic_id: '景区', city_code: '城市', profile: '扩展资料' }
window.productVersions = async (pid) => {
  const d = await api('GET', `/admin/master-versions?kind=product&refId=${pid}`)
  drawer('变更历史 · 商品 #' + pid, `
    ${d.rows.length ? `<table><thead><tr><th>版本</th><th>变更字段</th><th>变化</th><th>操作人 / 时间</th><th>操作</th></tr></thead><tbody>
    ${d.rows.map((v) => {
      const snap = typeof v.snapshot === 'string' ? JSON.parse(v.snapshot) : v.snapshot
      const fields = (snap.changedFields || []).map((k) => VER_FIELD_CN[k] || k).join('、')
      const diff = (snap.changedFields || []).map((k) => `<div class="td-sub">${esc(VER_FIELD_CN[k] || k)}：${esc(String(snap.before?.[k] ?? '—'))} → <b>${esc(String(snap.after?.[k] ?? '—'))}</b></div>`).join('')
      const restorable = (snap.changedFields || []).some((k) => ['price_from', 'title', 'bean_gift', 'status', 'supplier_id', 'scenic_id'].includes(k))
      return `<tr><td class="num">v${v.versionNo}${snap.restoredFrom ? '<div class="td-sub">恢复自 v' + snap.restoredFrom + '</div>' : ''}</td>
      <td class="td-sub">${esc(fields || '—')}</td><td>${diff || '—'}</td>
      <td class="td-sub">${esc(v.changedBy)}<br>${esc(String(v.createdAt).slice(5, 16).replace('T', ' '))}${v.reason ? '<br>' + esc(v.reason) : ''}</td>
      <td>${ME?.role === 'super' && restorable ? `<button class="btn ghost sm" onclick="versionRestore(${pid}, ${v.versionNo}, '${esc(String(snap.after?.price_from ?? ''))}')">恢复此版本</button>` : '<span class="td-sub">仅超管可恢复</span>'}</td></tr>`
    }).join('')}</tbody></table>` : emptyBox('暂无关键变更记录——价格/状态/归属等关键变更会自动留版本')}
    <p class="td-sub">版本簿只增不改；「恢复此版本」会写一条新版本把该版本的值带回来（金额为存储口径：分），价格变化同步上链留痕。</p>`)
}
window.versionRestore = (pid, versionNo, price) => {
  modal('恢复版本 v' + versionNo + ' · 商品 #' + pid, `
    <p>将把该版本执行后的值恢复为当前值（同价/同状态则仅记录恢复动作）。</p>
    <div class="field"><label>恢复原因 *（4–200 字，进入审计与版本簿）</label><input id="vrReason" maxlength="200" placeholder="例如：误改价格，恢复至审批过的版本"></div>
    <div id="vrErr" class="td-sub" style="color:var(--red)"></div>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="versionRestoreSubmit(${pid}, ${versionNo})">确认恢复</button>`)
}
window.versionRestoreSubmit = async (pid, versionNo) => {
  try {
    await api('POST', '/admin/master-versions/restore', { kind: 'product', refId: pid, versionNo, reason: ($('#vrReason').value || '').trim() })
    closeModal(); toast('已恢复并写入新版本'); productVersions(pid)
  } catch (e) { $('#vrErr').textContent = e.message }
}
