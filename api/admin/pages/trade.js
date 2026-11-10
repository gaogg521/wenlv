// 交易履约：订单详情/退款、商品与团期、商户、结算
// 普通脚本（非模块）：与 core.js 共享全局作用域，加载顺序见 index.html

/* ============ 订单 ============ */
async function orderDrawer(no) {
  const o = await api('GET', '/admin/orders/' + no)
  // B12 订单经营明细：成本/毛利/毛利率仅平台经营（super/finance）可取；其他角色拿不到也不展示
  let econ = null
  if (['super', 'finance'].includes(ME?.role)) { try { econ = await api('GET', `/admin/orders/${no}/economics`) } catch { econ = null } }
  // B02/B03/B04：套餐订单项（快照分摊/履约状态/部分退款明细）；可退项一键部分退款（super/finance）
  let itemsData = null
  try { itemsData = await api('GET', `/admin/orders/${no}/items`) } catch { itemsData = null }
  const IT_ST = { 0: '<span class="pill s20">待履约</span>', 1: '<span class="pill ok">已完成</span>', 2: '<span class="pill off">已退款</span>', 3: '<span class="pill warn">赠送</span>' }
  const itemsBlock = itemsData && itemsData.items.length ? (() => {
    const rows = itemsData.items.map((i) => `<tr>
      <td class="td-main">${esc(i.name)}<div class="td-sub">${esc(i.merchant_name || i.merchant_id)} · ${Number(i.kind) === 1 ? '按人凭证' : '服务项'}${Number(i.kind) === 1 ? ` · 凭证 ${i.pass_done}/${i.pass_total}` : ''}</div></td>
      <td class="num">×${i.qty}</td>
      <td class="money num">${fen(i.goods_fen)}</td>
      <td class="num">${fen(i.cash_fen)}</td>
      <td class="num">${itemsData.showCost ? (i.cost_fen != null ? fen(i.cost_fen) : '<span class="muted">未挂</span>') : '—'}</td>
      <td>${IT_ST[i.status] || i.status}</td>
      ${['super','finance'].includes(ME?.role) && Number(i.status) === 0 && Number(i.pass_done) === 0 && Number(i.cash_fen) > 0 ? `<td><button class="btn danger sm" onclick="partialRefundModal('${escJs(no)}', ${i.id}, '${escJs(i.name)}', ${i.cash_fen})">退此项</button></td>` : '<td></td>'}
    </tr>`).join('')
    const prRows = (itemsData.partials || []).map((p) => `<tr><td class="num td-sub">${esc(p.refund_no)}</td><td>${fen(p.cash_fen)}${Number(p.fee_fen) ? '<div class="td-sub">手续费 ' + fen(p.fee_fen) + '</div>' : ''}</td><td><span class="pill ${Number(p.status) === 2 ? 's50' : 's60'}">${Number(p.status) === 2 ? '已退款' : '处理中'}</span><div class="td-sub">${esc(p.reason || '')}</div></td></tr>`).join('')
    return `<h3 style="margin:16px 0 8px">套餐订单项（快照分摊 · ${Number(o.qty)} 份）</h3>
    <table><thead><tr><th>项目 / 提供方</th><th>数量</th><th>项原价</th><th>现金分摊</th><th>成本</th><th>履约</th>${['super','finance'].includes(ME?.role) ? '<th></th>' : ''}</tr></thead><tbody>${rows}</tbody></table>
    ${prRows ? `<h3 style="margin:12px 0 6px">部分退款记录</h3><table><thead><tr><th>退款单</th><th>实退</th><th>状态</th></tr></thead><tbody>${prRows}</tbody></table>` : ''}
    <p class="td-sub">分摊口径：现金/券/旅豆按项原价占比、尾差归最后正额项（Σ=订单金额恒等）；部分退款只退未核销项现金分摊，旅豆/券仅全退冲回。</p>`
  })() : ''
  const econBlock = econ ? (() => {
    const e = econ.economics
    const yuan = (f) => f == null ? '—' : fen(f)
    const costRows = (econ.costSnapshot?.items || []).map((i) => `<tr><td>#${i.itemId} ${esc(i.name)}</td><td>${esc(i.unitCostFen != null ? fen(i.unitCostFen) : '')}/${esc(i.unit === 'per_order' ? '每单' : i.unit === 'room_night' ? '房晚' : '每人')}</td><td class="num">×${i.mapQty}</td><td class="num">${fen(i.lineUnitFen)}</td></tr>`).join('')
    return `<h3 style="margin:16px 0 8px">经营明细（实际成交口径 · ${esc(e.caliber)}）</h3>
    <table>
      <tr><td class="td-sub" style="width:130px">原价商品额</td><td class="num">${yuan(e.originalGoodsFen)}</td></tr>
      <tr><td class="td-sub">实际商品成交额（早鸟/折扣后）</td><td class="num">${yuan(e.effectiveGoodsFen)}</td></tr>
      <tr><td class="td-sub">自由豆补贴 / 旅豆抵扣</td><td class="num">${yuan(e.freedomDiscountFen)} / ${yuan(e.beanDeductFen)}</td></tr>
      <tr><td class="td-sub">实际现金（商品口径）</td><td class="num"><b>${yuan(e.goodsCashFen)}</b>　<span class="td-sub">保费/代收款 ${yuan(e.insuranceFen)} 另列，不算销售收入</span></td></tr>
      <tr><td class="td-sub">直接成本（下单快照）</td><td class="num">${e.costFen != null ? yuan(e.costFen) : '<span class="muted">未维护/不可计算</span>'}${e.costConfirmedFen != null ? ' · 已确认 ' + yuan(e.costConfirmedFen) : ' · <span class="td-sub">确认成本未接入（B04）</span>'}</td></tr>
      ${e.refunded ? `<tr><td class="td-sub">退款冲减</td><td>已全额退款：净销售额与成本计 0（实退现金以退款单为准）</td></tr>` : ''}
      <tr><td class="td-sub">商品经营毛利 / 毛利率</td><td class="num">${e.profitFen != null ? '<b style="color:' + (e.profitFen < 0 ? 'var(--red)' : 'var(--green)') + '">' + yuan(e.profitFen) + ' / ' + e.marginPct.toFixed(2) + '%</b>' : '—'}${e.profitFen != null && e.profitFen < 0 ? ' <span class="pill warn">负毛利</span>' : ''}</td></tr>
    </table>
    ${costRows ? `<details style="margin-top:6px"><summary class="td-sub">成本快照来源（下单时点供给项明细）</summary><table><thead><tr><th>供给项</th><th>单价/单位</th><th>数量</th><th>小计</th></tr></thead><tbody>${costRows}</tbody></table></details>` : (econ.costSnapshot ? '' : '<p class="td-sub">商品未维护供给项成本——在「商品与团期 → 供给项台账」配置后新订单才可计算。</p>')}
    ${(econ.commissions || []).length ? `<p class="td-sub">推广佣金 ${econ.commissions.map((c) => fen(c.amount) + '（' + (c.rate_bp / 100) + '%）').join('、')}——经营收益等已知费用后在资金看板汇总，本单不重复扣减。</p>` : ''}
    <p class="td-sub">本页毛利≠平台最终净利润：未含税费、工资、房租及全部期间费用；促销减价与官方补贴不是可退现金。</p>`
  })() : ''
  drawer(`订单 ${esc(o.order_no)}`, `
    <div class="order-service-actions">
      ${adminCan('order.service') ? `<button class="btn primary sm" onclick="editOrderContact('${escJs(o.order_no)}')" ${[10,20,30].includes(Number(o.status)) ? '' : 'disabled title="已核销或已终结订单保留原联系人"'}>修正联系人</button><button class="btn ghost sm" onclick="orderServiceNote('${escJs(o.order_no)}')">添加客服备注</button>` : '<span class="muted">当前角色可查看订单；联系人修正与备注需运营权限</span>'}
      ${adminCan('order.refund') && [20,30,40].includes(Number(o.status)) ? `<button class="btn danger sm" onclick="refundOrder('${escJs(o.order_no)}')">处理退款</button>` : ''}
      ${Number(o.status) === 10 && adminCan('order.service') ? `<button class="btn danger sm" onclick="cancelUnpaidOrder('${escJs(o.order_no)}')">取消未支付订单</button>` : ''}
      ${adminCan('ticket.manage') || adminCan('order.service') ? `<button class="btn ghost sm" onclick="ticketCreateModal('${escJs(o.order_no)}')">发起售后</button>` : ''}
      ${['super','ops'].includes(ME?.role) && [20,30].includes(Number(o.status)) ? `<button class="btn primary sm" onclick="rescheduleModal('${escJs(o.order_no)}')">改期 / 换团</button>` : ''}
      ${['super','ops'].includes(ME?.role) ? `<button class="btn ghost sm" onclick="rescheduleDrawer('${escJs(o.order_no)}')">改期记录</button>` : ''}
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
    ${itemsBlock}
    ${econBlock}
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
    `<button class="btn ghost" onclick="closeModal()">返回</button><button class="btn danger" onclick="cancelUnpaidSubmit('${escJs(no)}')">确认取消</button>`)
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
  modal('修正订单联系人', `<p class="muted">只修正履约联系方式，不改变订单买家、出行人、价格或团期。当前号码 ${esc(o.contactPhone || '未填写')}。</p><div class="field"><label>联系人</label><input id="serviceName" maxlength="64" value="${esc(o.contact_name || '')}"></div><div class="field"><label>新手机号（不修改留空）</label><input id="servicePhone" type="tel" maxlength="11" autocomplete="off"></div><div class="field"><label>修改原因（必填）</label><textarea id="serviceReason" maxlength="300"></textarea></div>`, `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="saveOrderContact('${escJs(no)}')">保存修正</button>`)
}
async function saveOrderContact(no) {
  try {
    await api('POST', '/admin/orders/' + no + '/contact', { name: $('#serviceName').value, phone: $('#servicePhone').value, reason: $('#serviceReason').value })
    toast('联系人已修正，记录已保存'); closeModal(); await orderDrawer(no)
  } catch (e) { toast(e.message, true) }
}
function orderServiceNote(no) {
  if (!adminCan('order.service')) return toast(adminWhy('order.service'), true)
  modal('添加客服备注', '<p class="muted">仅后台可见，保存后保留操作人和时间。请勿录入完整手机号、证件号等敏感信息。</p><textarea id="serviceNote" maxlength="500" placeholder="4–500 字，记录诉求、核实情况与处理结论"></textarea>', `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="saveOrderServiceNote('${escJs(no)}')">保存备注</button>`)
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
      <td><button class="btn ghost sm" onclick="productProfile(${p.id})">经营总览</button> ${adminCan('product.status') ? `<button class="btn ghost sm" onclick="toggleProduct(${p.id}, ${p.status === 1 ? 0 : 1})">${p.status === 1 ? '下架' : '上架'}</button>` : ''}
          <button class="ghost btn sm" style="border-color:var(--line);color:var(--ink2)" onclick="sessionsDrawer(${p.id})">团期</button>
          ${['super','finance','ops'].includes(ME?.role) ? `<button class="ghost btn sm" style="border-color:var(--line);color:var(--ink2)" onclick="productSupplyEditor(${p.id})">成本构成</button>
          <button class="ghost btn sm" style="border-color:var(--line);color:var(--ink2)" onclick="packageItemsDrawer(${p.id})">套餐项</button>` : ''}
          ${adminCan('entity.product.edit') ? `<button class="ghost btn sm" style="border-color:var(--line);color:var(--ink2)" onclick="editProduct(${p.id})">编辑资料</button>` : ''}
          <button class="ghost btn sm" style="border-color:var(--line);color:var(--ink2)" onclick="productVersions(${p.id})">变更历史</button></td>
    </tr>`).join('')}</tbody></table>` : emptyBox(F.sup || F.scn ? '筛选条件下暂无线路：清一下筛选再试' : '还没有商品——点右上「新增线路」录入第一条')}
  </div>
  <div class="card" style="margin-top:16px">
    <div class="card-head"><h2>供给项台账 · 成本与参考零售价</h2>${['super','ops'].includes(ME?.role) ? `<button class="btn primary sm" onclick="supplyItemEditor()">＋ 新增供给项</button>` : '<span class="muted">供给项维护需运营/超管权限；成本仅平台经营/财务身份可见</span>'}</div>
    <p class="muted" style="margin-bottom:6px">采购/履约成本单价、计价单位（每人/每单/房晚）、生效期与协议版本在此维护；产品通过「成本构成」挂用（×数量）。成本缺失显示"未维护/不可计算"，不默认为 0；真实零成本须填依据。已售订单按下单时点快照复算，新改成本不改历史。</p>
    <div id="supplyItemBox">${skel(3)}</div>
  </div>
  <div class="card" style="margin-top:16px">
    <div class="card-head"><h2>促销折扣 / 价格规则</h2>${['super','ops'].includes(ME?.role) ? `<button class="btn primary sm" onclick="promoDiscountEditor()">＋ 新增折扣规则</button>` : '<span class="muted">折扣规则维护需运营/超管权限</span>'}</div>
    <p class="muted" style="margin-bottom:6px">商品促销降价（如原价299元打8折=按原价80%付款239.20元），与早鸟价可配置叠加、默认不叠加（取较低价）；官方补贴（自由豆）在「资金」模块单独配置。游客端展示、试算、建单与退款按同一规则快照执行。</p>
    <div id="promoDiscountBox">${skel(3)}</div>
  </div>`
  promoDiscountList().catch((e) => { document.getElementById('promoDiscountBox').innerHTML = `<p class="muted">折扣规则加载失败：${esc(e.message)}</p>` })
  supplyItemList().catch((e) => { document.getElementById('supplyItemBox').innerHTML = `<p class="muted">供给项加载失败：${esc(e.message)}</p>` })
}

/* ============ B01 供给项台账 ============ */
const SI_KIND = { 1: '采购', 2: '履约', 3: '赠送' }
const SI_STATE = { 1: '<span class="pill ok">生效</span>', 0: '<span class="pill off">停用</span>' }
async function supplyItemList() {
  const d = await api('GET', '/admin/supply-items?pageSize=50')
  const box = document.getElementById('supplyItemBox')
  if (!box) return
  const canManage = ['super', 'ops'].includes(ME?.role)
  box.innerHTML = d.rows.length ? `<table><thead><tr><th>供给项</th><th>类型/单位</th><th>成本单价</th><th>参考零售价</th><th>提供方</th><th>生效期/协议</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${d.rows.map((r) => `<tr>
      <td class="td-main">${esc(r.name)}<div class="td-sub">v${r.version} · ${esc(r.operator || '')}${r.note ? '<br>依据：' + esc(r.note) : ''}</div></td>
      <td>${SI_KIND[r.kind] || r.kind}<div class="td-sub">${esc(d.unitCn[r.unit] || r.unit)}</div></td>
      <td class="money num">${fen(r.unit_cost_fen)}${Number(r.unit_cost_fen) === 0 ? '<div class="td-sub">真实零成本（有依据）</div>' : ''}</td>
      <td class="num">${r.ref_retail_fen != null ? fen(r.ref_retail_fen) : '—'}<div class="td-sub">参考值，非实际售价</div></td>
      <td class="td-sub">${esc(r.provider_name || (r.provider_type ? r.provider_type + '#' + (r.provider_id || '—') : '平台'))}</td>
      <td class="td-sub">${r.valid_from || '不限'} — ${r.valid_to || '不限'}<br>${esc(r.agreement || '无协议号')}</td>
      <td>${SI_STATE[r.status] || r.status}</td>
      <td><div class="td-actions">${canManage ? `<button class="btn ghost sm" onclick="supplyItemEditor(${r.id})">编辑</button>
        <button class="btn ghost sm" onclick="supplyItemStatus(${r.id}, ${r.status === 1 ? 0 : 1})">${r.status === 1 ? '停用' : '启用'}</button>` : '<span class="muted">仅查看</span>'}</div></td>
    </tr>`).join('')}</tbody></table>` : emptyBox('暂无供给项——先录入采购/履约成本，再到具体产品「成本构成」挂用')
}
window.supplyItemEditor = async (id) => {
  if (!['super', 'ops'].includes(ME?.role)) return toast('供给项维护需运营/超管权限', true)
  let r = {}
  if (id) {
    const d = await api('GET', '/admin/supply-items?pageSize=50')
    r = d.rows.find((x) => Number(x.id) === Number(id)) || {}
    if (!r.id) return toast('供给项不存在', true)
  }
  modal((id ? '编辑供给项 v' + r.version : '新增供给项'), `
    <p class="muted">成本按"分"存储、界面按元展示；计价单位决定如何乘数量（每人/房晚随出行份数放大，每单固定）。参考零售价只是参考，不能冒充产品实际售价。</p>
    <div class="field"><label>名称 *</label><input id="siName" maxlength="80" value="${esc(r.name || '')}" placeholder="如：景区门票采购（成人）"></div>
    <div class="field"><label>类型 *</label><select id="siKind">
      ${[1, 2, 3].map((k) => `<option value="${k}" ${Number(r.kind) === k ? 'selected' : ''}>${SI_KIND[k]}</option>`).join('')}</select></div>
    <div class="field"><label>计价单位 *</label><select id="siUnit">
      <option value="per_person" ${r.unit === 'per_person' || !r.unit ? 'selected' : ''}>每人</option>
      <option value="per_order" ${r.unit === 'per_order' ? 'selected' : ''}>每单</option>
      <option value="room_night" ${r.unit === 'room_night' ? 'selected' : ''}>房晚</option></select></div>
    <div class="field"><label>成本单价（元）* <span class="td-sub">0=真实零成本，必须填依据</span></label><input id="siCost" type="number" step="0.01" min="0" value="${r.unit_cost_fen != null ? (Number(r.unit_cost_fen) / 100).toFixed(2) : ''}"></div>
    <div class="field"><label>参考零售价（元，选填）</label><input id="siRetail" type="number" step="0.01" min="0" value="${r.ref_retail_fen != null ? (Number(r.ref_retail_fen) / 100).toFixed(2) : ''}"></div>
    <div class="field"><label>提供方类型</label><select id="siPType">
      <option value="" ${!r.provider_type ? 'selected' : ''}>平台/不指定</option>
      <option value="scenic" ${r.provider_type === 'scenic' ? 'selected' : ''}>景区</option>
      <option value="supplier" ${r.provider_type === 'supplier' ? 'selected' : ''}>供应商</option>
      <option value="merchant" ${r.provider_type === 'merchant' ? 'selected' : ''}>商户</option></select></div>
    <div class="field"><label>提供方ID（按类型填对应资源ID，可空）</label><input id="siPid" type="number" min="1" value="${esc(r.provider_id || '')}"></div>
    <div class="field"><label>生效期起（选填）</label><input id="siFrom" type="date" value="${esc(r.valid_from || '')}"></div>
    <div class="field"><label>生效期止（选填）</label><input id="siTo" type="date" value="${esc(r.valid_to || '')}"></div>
    <div class="field"><label>协议版本/编号（选填，≤120字）</label><input id="siAgreement" maxlength="120" value="${esc(r.agreement || '')}"></div>
    <div class="field"><label>成本依据与调整说明 *（真实零成本必填，≥4字）</label><textarea id="siNote" maxlength="300">${esc(r.note || '')}</textarea></div>
    <div class="field"><label>操作依据 *（4–300 字，进入审计）</label><input id="siReason" maxlength="300" placeholder="如：2026年采购合同审批单 XX"></div>
    <div id="siErr" class="td-sub" style="color:var(--red)"></div>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="supplyItemSave(${id || 0})">保存供给项</button>`)
}
window.supplyItemSave = async (id) => {
  const numOrNull = (k) => { const v = document.getElementById(k).value; return v === '' ? null : Math.round(Number(v) * 100) }
  try {
    await api('POST', '/admin/supply-items', {
      id: id || undefined, name: document.getElementById('siName').value.trim(), kind: Number(document.getElementById('siKind').value),
      unit: document.getElementById('siUnit').value, unitCostFen: numOrNull('siCost'), refRetailFen: numOrNull('siRetail'),
      providerType: document.getElementById('siPType').value || null, providerId: document.getElementById('siPid').value || null,
      validFrom: document.getElementById('siFrom').value || null, validTo: document.getElementById('siTo').value || null,
      agreement: document.getElementById('siAgreement').value.trim(), note: document.getElementById('siNote').value.trim(),
      reason: document.getElementById('siReason').value.trim(),
    })
    closeModal(); toast('供给项已保存'); products()
  } catch (e) { document.getElementById('siErr').textContent = e.message }
}
window.supplyItemStatus = (id, status) => {
  modal(status === 1 ? '启用供给项' : '停用供给项', `
    <p class="muted">${status === 1 ? '启用后新订单按该成本快照；已售订单不受影响。' : '停用后不再计入产品成本构成（已售订单保留原快照）。'}</p>
    <div class="field"><label>操作依据 *（4–300 字）</label><input id="siStReason" maxlength="300"></div><div id="siStErr" class="td-sub" style="color:var(--red)"></div>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn ${status === 1 ? 'primary' : 'danger'}" onclick="supplyItemStatusSubmit(${id}, ${status})">确认</button>`)
}
window.supplyItemStatusSubmit = async (id, status) => {
  try {
    await api('POST', '/admin/supply-items/status', { id, status, reason: document.getElementById('siStReason').value.trim() })
    closeModal(); toast(status === 1 ? '已启用' : '已停用'); products()
  } catch (e) { document.getElementById('siStErr').textContent = e.message }
}
// 产品成本构成：挂用供给项×数量，实时预览每份成本与团期预计毛利
window.productSupplyEditor = async (pid) => {
  if (!['super', 'ops'].includes(ME?.role)) return toast('成本构成维护需运营/超管权限', true)
  const [items, prev] = await Promise.all([api('GET', '/admin/supply-items?pageSize=100'), api('GET', `/admin/products/${pid}/cost-preview`)])
  const cur = prev.breakdown ? prev.breakdown.items.map((i) => ({ itemId: i.itemId, qty: i.mapQty })) : []
  window.__siRows = cur.length ? cur : [{ itemId: items.rows[0]?.id, qty: 1 }]
  const rowHtml = () => (window.__siRows || []).map((x, i) => `<div class="row" style="gap:6px;margin:4px 0">
    <select class="inp" onchange="window.__siRows[${i}].itemId=Number(this.value)" style="flex:1;min-width:0">${items.rows.map((it) => `<option value="${it.id}" ${Number(x.itemId) === Number(it.id) ? 'selected' : ''}>#${it.id} ${esc(it.name)}（${fen(it.unit_cost_fen)}/${esc(items.unitCn[it.unit] || it.unit)}）</option>`).join('')}</select>
    <input class="inp" type="number" min="1" max="9999" value="${x.qty}" onchange="window.__siRows[${i}].qty=Number(this.value)" style="width:76px" title="数量">
    <button class="btn ghost sm" onclick="window.__siRows.splice(${i},1);document.getElementById('siRows').innerHTML=siRowHtml()">删</button></div>`).join('')
  window.siRowHtml = rowHtml
  const previewRows = prev.rows.map((s) => `<tr><td>${esc(s.departDate)}</td><td class="money num">${fen(s.unitFen)}</td>
    <td class="num">${s.costFen != null ? fen(s.costFen) : '<span class="muted">未维护</span>'}</td>
    <td class="num">${s.profitFen != null ? '<b style="color:' + (s.profitFen < 0 ? 'var(--red)' : 'var(--green)') + '">' + fen(s.profitFen) + '</b>' : '—'}</td>
    <td class="num">${s.marginPct != null ? s.marginPct.toFixed(2) + '%' : '—'}</td></tr>`).join('')
  modal('成本构成 · 产品 #' + pid, `
    <p class="muted">预计成本 = Σ（供给项成本单价×数量）＋按单位随出行份数放大；下方预览按当前生效配置×各团期实时价实时计算。修改价格或成本时不需手算表格；已售订单按下单时点快照，不受本次调整影响。</p>
    <div id="siRows">${rowHtml()}</div>
    <button class="btn ghost sm" onclick="window.__siRows.push({itemId:${items.rows[0]?.id || 0},qty:1});document.getElementById('siRows').innerHTML=siRowHtml()">＋ 添加供给项</button>
    <h3 style="margin:12px 0 6px">团期预计毛利（当前配置 × 实时价）</h3>
    <table><thead><tr><th>出发日</th><th>有效单价</th><th>每份成本</th><th>预计毛利</th><th>毛利率</th></tr></thead><tbody>${previewRows || '<tr><td colspan="5" class="muted">暂无在售团期</td></tr>'}</tbody></table>
    <p class="td-sub">参考零售价之和不能冒充套餐实际售价；确认成本随 B04 结算接入前一律"未确认"。</p>
    <div class="field"><label>操作依据 *（4–300 字）</label><input id="psReason" maxlength="300"></div>
    <div id="psErr" class="td-sub" style="color:var(--red)"></div>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="productSupplySave(${pid})">保存成本构成</button>`)
}
window.productSupplySave = async (pid) => {
  try {
    await api('POST', `/admin/products/${pid}/supply`, { items: window.__siRows, reason: document.getElementById('psReason').value.trim() })
    closeModal(); toast('成本构成已保存'); products()
  } catch (e) { document.getElementById('psErr').textContent = e.message }
}

/* ============ D01 促销折扣规则 ============ */
const PD_STATE = { 1: '<span class="pill ok">启用中</span>', 0: '<span class="pill off">已停用</span>' }
async function promoDiscountList() {
  const d = await api('GET', '/admin/promo-discounts?pageSize=50')
  const box = document.getElementById('promoDiscountBox')
  if (!box) return
  const canManage = ['super', 'ops'].includes(ME?.role)
  box.innerHTML = d.rows.length ? `<table><thead><tr><th>活动</th><th>折扣</th><th>生效时间</th><th>适用范围</th><th>叠加策略</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${d.rows.map((r) => {
      const zhe = (Number(r.discount_bp) / 1000).toFixed(2).replace(/\.?0+$/, '')
      const scope = []
      const J = (v) => { try { return typeof v === 'string' ? JSON.parse(v || '[]') : (v || []) } catch { return [] } }
      if (J(r.products).length) scope.push('产品 #' + J(r.products).join(' #'))
      if (J(r.cities).length) scope.push('城市 ' + J(r.cities).join('、'))
      if (J(r.channels).length) scope.push('渠道 ' + J(r.channels).join('、'))
      if (J(r.dates).length) scope.push('团期 ' + J(r.dates).join('、'))
      return `<tr>
      <td class="td-main">${esc(r.name)}<div class="td-sub">v${r.version} · ${esc(r.operator || '')}</div></td>
      <td class="money num">${esc(zhe)}折<div class="td-sub">按原价 ${Math.round(Number(r.discount_bp) / 100)}% 付款</div></td>
      <td class="td-sub">${esc(String(r.from_time).slice(0, 16))}<br>— ${esc(String(r.to_time).slice(0, 16))}</td>
      <td class="td-sub">${scope.length ? scope.join('<br>') : '全部产品/城市/渠道/团期'}</td>
      <td>${Number(r.stack_early) === 1 ? '<span class="pill warn">与早鸟叠加</span><div class="td-sub">先早鸟价再乘折扣</div>' : '<span class="pill off">不叠加</span><div class="td-sub">早鸟与折扣取较低价</div>'}</td>
      <td>${PD_STATE[r.status] || r.status}</td>
      <td><div class="td-actions">${canManage ? `<button class="btn ghost sm" onclick="promoDiscountEditor(${r.id})">编辑</button>
        <button class="btn ghost sm" onclick="promoDiscountStatus(${r.id}, ${r.status === 1 ? 0 : 1})">${r.status === 1 ? '停用' : '启用'}</button>` : '<span class="muted">仅查看</span>'}</div></td>
    </tr>`}).join('')}</tbody></table>` : emptyBox('暂无折扣规则——点右上「新增折扣规则」创建（如：新品上市 8 折）')
}
/* ============ B02/B03/B04 套餐项与部分退款 ============ */
// 订单抽屉里对单个未核销项发起部分退款（super/finance；平台原因不扣手续费，留审计）
window.partialRefundModal = (no, itemId, name, cashFen) => {
  modal('按项部分退款 · ' + esc(no), `
    <p class="td-sub">退「${esc(name)}」现金分摊 <b>${fen(cashFen)}</b>。平台原因退款不扣手续费；游客自助部分退款按退改梯度扣手续费。旅豆/券不在部分退款中冲回（全退才走既有冲回流程）。</p>
    <div class="field"><label>退款原因 *（4–300 字，进入审计）</label><input id="prReason" maxlength="300" placeholder="如：客人临时取消该单项服务"></div>
    <div id="prErr" class="td-sub" style="color:var(--red)"></div>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn danger" onclick="partialRefundSubmit('${escJs(no)}', ${itemId})">确认退款</button>`)
}
window.partialRefundSubmit = async (no, itemId) => {
  try {
    const r = await api('POST', `/admin/orders/${no}/partial-refund`, { itemIds: [itemId], reason: document.getElementById('prReason').value.trim() })
    closeModal(); toast(r.refunded ? '部分退款完成：' + fen(r.cashFen) : '退款已受理（' + r.refundNo + '）'); orderDrawer(no)
  } catch (e) { document.getElementById('prErr').textContent = e.message }
}
// 产品套餐项配置（B02）：按人凭证/服务项、提供方门店、成本来源、单价与每份数量
window.packageItemsDrawer = async (pid) => {
  if (!['super', 'ops', 'finance'].includes(ME?.role)) return toast('套餐项查看需平台权限', true)
  const [d, merchants, items] = await Promise.all([api('GET', `/admin/products/${pid}/package-items`), api('GET', '/admin/merchants'), api('GET', '/admin/supply-items?pageSize=100').catch(() => ({ rows: [] }))])
  const sum = d.rows.reduce((a, r) => a + Number(r.unit_price_fen) * Number(r.qty_per_unit), 0)
  drawer('套餐项配置 · 产品 #' + pid, `
    ${['super','ops'].includes(ME?.role) ? `<div class="row" style="margin:0 0 10px"><button class="btn primary sm" onclick="packageItemEditor(${pid})">＋ 新增套餐项</button></div>` : '<span class="muted">套餐项维护需运营/超管权限</span>'}
    <p class="td-sub">项原价之和 = ¥${(sum / 100).toFixed(2)}（应与团期定价一致；不一致时下单以 Σ项价×缩放为准，早鸟/折扣按比例作用于各项）。配置改动只影响未来订单，已售订单保留下单快照。</p>
    ${d.rows.length ? `<table><thead><tr><th>项目</th><th>类型</th><th>提供方门店</th><th>单价×每份</th><th>成本来源</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${d.rows.map((r) => `<tr><td class="td-main">${esc(r.name)}<div class="td-sub">v${r.version} · ${esc(r.operator || '')}</div></td>
      <td>${Number(r.kind) === 1 ? '按人凭证' : '服务项'}</td>
      <td class="td-sub">${esc((merchants.find((m) => Number(m.id) === Number(r.merchant_id)) || {}).name || r.merchant_id)}</td>
      <td class="num">${fen(r.unit_price_fen)} × ${r.qty_per_unit}</td>
      <td class="td-sub">${r.supply_item_id ? '#' + r.supply_item_id + ' ' + esc((items.rows.find((x) => Number(x.id) === Number(r.supply_item_id)) || {}).name || '') : '—'}</td>
      <td>${r.status === 1 ? '<span class="pill ok">启用</span>' : '<span class="pill off">停用</span>'}</td>
      <td><div class="td-actions">${['super','ops'].includes(ME?.role) ? `<button class="btn ghost sm" onclick="packageItemEditor(${pid}, ${r.id})">编辑</button>
        <button class="btn ghost sm" onclick="packageItemStatus(${pid}, ${r.id}, ${r.status === 1 ? 0 : 1})">${r.status === 1 ? '停用' : '启用'}</button>` : '<span class="muted">仅查看</span>'}</div></td></tr>`).join('')}</tbody></table>` : emptyBox('该产品暂未配置套餐项——非套餐产品无需配置')}
    <p class="td-sub">下单后订单项快照见订单详情「套餐订单项」；服务项由提供方商户端「待履约」核销，按人凭证项随订单出票、凭证挂项并由归属店核销。</p>`)
}
window.packageItemEditor = async (pid, id) => {
  if (!['super', 'ops'].includes(ME?.role)) return toast('套餐项维护需运营/超管权限', true)
  let r = {}
  if (id) {
    const d = await api('GET', `/admin/products/${pid}/package-items`)
    r = d.rows.find((x) => Number(x.id) === Number(id)) || {}
    if (!r.id) return toast('套餐项不存在', true)
  }
  const merchants = await api('GET', '/admin/merchants')
  const items = await api('GET', '/admin/supply-items?pageSize=100').catch(() => ({ rows: [] }))
  modal((id ? '编辑套餐项 v' + r.version : '新增套餐项'), `
    <div class="field"><label>项目名称 *</label><input id="piName" maxlength="80" value="${esc(r.name || '')}" placeholder="如：景区大门票（成人）"></div>
    <div class="field"><label>类型 *</label><select id="piKind">
      <option value="1" ${Number(r.kind) === 1 || !r.kind ? 'selected' : ''}>按人凭证（出票、扫码核销）</option>
      <option value="2" ${Number(r.kind) === 2 ? 'selected' : ''}>服务项（商户端履约核销）</option></select></div>
    <div class="field"><label>提供方门店 *（跨店隔离：仅该店可核销）</label><select id="piMerchant">${merchants.filter((m) => m.status === 1).map((m) => `<option value="${m.id}" ${Number(r.merchant_id) === Number(m.id) ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></div>
    <div class="field"><label>项单价（元）*</label><input id="piPrice" type="number" step="0.01" min="0" value="${r.unit_price_fen != null ? (Number(r.unit_price_fen) / 100).toFixed(2) : ''}"></div>
    <div class="field"><label>每份产品包含数量 *</label><input id="piQty" type="number" min="1" max="99" value="${r.qty_per_unit || 1}"></div>
    <div class="field"><label>成本来源供给项（选填，B01）</label><select id="piSupply"><option value="">不挂（项级成本不计算）</option>${items.rows.map((x) => `<option value="${x.id}" ${Number(r.supply_item_id) === Number(x.id) ? 'selected' : ''}>#${x.id} ${esc(x.name)}（${fen(x.unit_cost_fen)}）</option>`).join('')}</select></div>
    <div class="field"><label>操作依据 *（4–300 字）</label><input id="piReason" maxlength="300"></div>
    <div id="piErr" class="td-sub" style="color:var(--red)"></div>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="packageItemSave(${pid}, ${id || 0})">保存套餐项</button>`)
}
window.packageItemSave = async (pid, id) => {
  try {
    await api('POST', `/admin/products/${pid}/package-items`, {
      id: id || undefined, name: document.getElementById('piName').value.trim(), kind: Number(document.getElementById('piKind').value),
      merchantId: Number(document.getElementById('piMerchant').value), unitPriceFen: Math.round(Number(document.getElementById('piPrice').value) * 100),
      qtyPerUnit: Number(document.getElementById('piQty').value), supplyItemId: document.getElementById('piSupply').value || null,
      reason: document.getElementById('piReason').value.trim(),
    })
    closeModal(); toast('套餐项已保存'); packageItemsDrawer(pid)
  } catch (e) { document.getElementById('piErr').textContent = e.message }
}
window.packageItemStatus = (pid, id, status) => {
  modal(status === 1 ? '启用套餐项' : '停用套餐项', `
    <p class="muted">${status === 1 ? '启用后新订单包含该项目。' : '停用后新订单不再包含；已售订单快照不变。'}该项原价变化会影响套餐原价合计，请同步核对团期定价。</p>
    <div class="field"><label>操作依据 *（4–300 字）</label><input id="piStReason" maxlength="300"></div><div id="piStErr" class="td-sub" style="color:var(--red)"></div>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn ${status === 1 ? 'primary' : 'danger'}" onclick="packageItemStatusSubmit(${pid}, ${id}, ${status})">确认</button>`)
}
window.packageItemStatusSubmit = async (pid, id, status) => {
  try {
    await api('POST', `/admin/products/${pid}/package-items/status`, { id, status, reason: document.getElementById('piStReason').value.trim() })
    closeModal(); toast(status === 1 ? '已启用' : '已停用'); packageItemsDrawer(pid)
  } catch (e) { document.getElementById('piStErr').textContent = e.message }
}

window.promoDiscountEditor = async (id) => {
  if (!['super', 'ops'].includes(ME?.role)) return toast('折扣规则维护需运营/超管权限', true)
  let r = {}
  if (id) {
    const d = await api('GET', '/admin/promo-discounts?pageSize=50')
    r = d.rows.find((x) => Number(x.id) === Number(id)) || {}
    if (!r.id) return toast('规则不存在', true)
  }
  const J = (v) => { try { return typeof v === 'string' ? JSON.parse(v || '[]') : (v || []) } catch { return [] } }
  const zhe = r.discount_bp != null ? (Number(r.discount_bp) / 1000).toFixed(2).replace(/\.?0+$/, '') : ''
  modal((id ? '编辑折扣规则 v' + r.version : '新增折扣规则'), `
    <p class="muted">填「8」表示 8 折（按原价 80% 付款）；折数范围 0–10、最多两位小数。折扣按商品真实定价比例计算，不使用人为抬高的假原价。</p>
    <div class="field"><label>活动名称 *</label><input id="pdName" maxlength="80" value="${esc(r.name || '')}" placeholder="如：开季特惠 8 折"></div>
    <div class="field"><label>折扣（折）* <span class="td-sub" id="pdZheHint"></span></label><input id="pdZhe" type="number" step="0.01" min="0.01" max="10" value="${esc(zhe)}" placeholder="8 = 按8折付款"></div>
    <div class="field"><label>生效时间 *</label><input id="pdFrom" type="datetime-local" value="${esc(r.from_time ? String(r.from_time).slice(0, 16).replace(' ', 'T') : '')}"></div>
    <div class="field"><label>失效时间 *</label><input id="pdTo" type="datetime-local" value="${esc(r.to_time ? String(r.to_time).slice(0, 16).replace(' ', 'T') : '')}"></div>
    <div class="field"><label>适用产品ID（逗号分隔，留空全部）</label><input id="pdProducts" value="${esc(J(r.products).join(','))}" placeholder="如：1,3"></div>
    <div class="field"><label>适用城市代码（逗号分隔，留空全部）</label><input id="pdCities" value="${esc(J(r.cities).join(','))}" placeholder="如：310118"></div>
    <div class="field"><label>适用渠道（逗号分隔，留空全部）</label><input id="pdChannels" value="${esc(J(r.channels).join(','))}" placeholder="如：main"></div>
    <div class="field"><label>适用团期日期 YYYY-MM-DD（逗号分隔，留空全部）</label><input id="pdDates" value="${esc(J(r.dates).join(','))}"></div>
    <div class="field"><label>叠加策略</label><select id="pdStack">
      <option value="0" ${Number(r.stack_early) !== 1 ? 'selected' : ''}>不叠加（默认）：早鸟价与折扣价取较低者</option>
      <option value="1" ${Number(r.stack_early) === 1 ? 'selected' : ''}>叠加：先取生效早鸟单价再乘折扣（未命中早鸟按原价乘折扣）</option></select></div>
    <div class="field"><label>操作依据 *（4–300 字，进入审计）</label><textarea id="pdReason" maxlength="300" placeholder="如：开季促销活动审批单号 XX"></textarea></div>
    <div id="pdErr" class="td-sub" style="color:var(--red)"></div>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="promoDiscountSave(${id || 0})">保存规则</button>`)
  const hint = () => { const z = Number(document.getElementById('pdZhe').value); document.getElementById('pdZheHint').textContent = Number.isFinite(z) && z > 0 && z <= 10 ? '按原价 ' + Math.round(z * 100) + '% 付款' : '' }
  document.getElementById('pdZhe').addEventListener('input', hint); hint()
}
window.promoDiscountSave = async (id) => {
  const list = (k) => document.getElementById(k).value.split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean)
  try {
    await api('POST', '/admin/promo-discounts', {
      id: id || undefined, name: document.getElementById('pdName').value.trim(), zhe: Number(document.getElementById('pdZhe').value),
      from: document.getElementById('pdFrom').value, to: document.getElementById('pdTo').value,
      products: list('pdProducts'), cities: list('pdCities'), channels: list('pdChannels'), dates: list('pdDates'),
      stackEarly: Number(document.getElementById('pdStack').value) === 1, reason: document.getElementById('pdReason').value.trim(),
    })
    closeModal(); toast('折扣规则已保存'); products()
  } catch (e) { document.getElementById('pdErr').textContent = e.message }
}
window.promoDiscountStatus = (id, status) => {
  modal(status === 1 ? '启用折扣规则' : '停用折扣规则', `
    <p class="muted">${status === 1 ? '启用后游客端立即按该规则试算与建单（已售订单快照不变）。' : '停用后不再对新订单生效；已建订单保留其价格快照，活动到期不改旧单金额。'}</p>
    <div class="field"><label>操作依据 *（4–300 字）</label><input id="pdStReason" maxlength="300"></div><div id="pdStErr" class="td-sub" style="color:var(--red)"></div>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn ${status === 1 ? 'primary' : 'danger'}" onclick="promoDiscountStatusSubmit(${id}, ${status})">确认</button>`)
}
window.promoDiscountStatusSubmit = async (id, status) => {
  try {
    await api('POST', '/admin/promo-discounts/status', { id, status, reason: document.getElementById('pdStReason').value.trim() })
    closeModal(); toast(status === 1 ? '已启用' : '已停用'); products()
  } catch (e) { document.getElementById('pdStErr').textContent = e.message }
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
      <td><span class="pill ${m.status === 1 ? 'ok' : 'warn'}">${m.status === 1 ? '生效' : '进件中'}</span><div style="margin-top:4px"><button class="btn primary sm" onclick="merchantProfile(${m.id})">全景</button> ${adminCan('entity.merchant.edit') ? `<button class="btn ghost sm" onclick="editMerchant(${m.id},'${escJs(m.name)}','${escJs(m.city_code)}','${escJs(m.wxpay_sub_mchid || '')}','${escJs(m.kind || 'other')}')">编辑</button>` : ''}</div><div style="margin-top:4px">${m.status === 0 && adminCan('merchant.approve') ? `<button class="btn primary sm" onclick="approveMerchant(${m.id})">审批通过</button>` : (m.status === 0 ? '<span class="td-sub">待运营/超管审批</span>' : '')}</div></td></tr>`).join('')}</tbody></table>` : emptyBox('暂无商户')}
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
      ${adminCan('settle.pay') ? '<button class="btn primary sm" onclick="genSettlements()">生成本周结算单</button>' : '<span class="muted">结算生成与回单登记由超级管理员或财务办理</span>'}</div>
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
          ${s.status === 1 && adminCan('settle.pay') ? `<button class="btn primary sm" style="margin-left:10px" onclick="confirmSettle(${s.id})">财务复核</button>` : ''}${s.status === 2 && adminCan('settle.pay') ? `<button class="btn primary sm" onclick="paymentReceipt(${s.id})">登记支付回单</button>` : ''}${s.status === 4 && adminCan('settle.pay') ? `<button class="btn ghost sm" style="margin-left:10px" onclick="resolveDispute(${s.id})">处理异议</button>` : ''}</div>
      </div>
      ${Number(s.total_amount) > 0 ? `<div class="split-bar">${parts.map((v, i) => `<span style="background:${COLORS[i]};flex:${Math.max(v, 1)}">${v ? Math.round(v / total * 100) + '%' : ''}</span>`).join('')}</div>` : '<p class="muted" style="margin:0">本期无完成订单，仅计入退改手续费</p>'}
      ${s.payment_ref ? `<p class="muted">支付流水 ${esc(s.payment_ref)} · ${esc(s.paid_at || '')} · ${esc(s.payment_note || '')}</p>` : ''}
      <div class="split-legend" ${Number(s.total_amount) > 0 ? '' : 'hidden'}>${NAMES.map((n, i) => `<span><em style="width:9px;height:9px;border-radius:3px;display:inline-block;background:${COLORS[i]};margin-right:5px"></em>${n} ${fen(parts[i])}</span>`).join('')}</div>
      ${Number(s.fee_total) ? `<div class="fee-line"><span>退改手续费 <b>${fen(s.fee_total)}</b>（${s.fee_count} 笔）</span>
        <span>商户分成 ${s.fee_share_bp != null ? (Number(s.fee_share_bp) / 100) + '%' : '—'} · <b>${fen(s.fee_merchant)}</b></span><span>平台 <b>${fen(s.fee_platform)}</b></span></div>` : ''}
      ${s.cost_total != null ? `<div class="payable-line" style="color:var(--ink2)">确认成本 <b>${fen(s.cost_total)}</b><span class="muted"> · 部分退款冲减 ${fen(s.partial_deduct || 0)} · 毛利（收入−成本） ${fen(Number(s.total_amount) - Number(s.cost_total))}</span></div>` : ``}
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
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="rescheduleSubmit('${escJs(orderNo)}')">提交申请</button>`)
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
        ${Number(r.status) === 0 && ME?.role === 'super' && !rescheduleIsApplicant(r) ? `<button class="btn primary sm" onclick="rescheduleVerdict(${r.id}, 1, '${escJs(orderNo)}')">通过</button><button class="btn danger sm" onclick="rescheduleVerdict(${r.id}, 0, '${escJs(orderNo)}')">驳回</button>` : ''}
        ${Number(r.status) === 0 && (rescheduleIsApplicant(r) || ME?.role === 'super') ? `<button class="btn ghost sm" onclick="rescheduleCancel(${r.id}, '${escJs(orderNo)}')">撤回</button>` : ''}
        ${Number(r.status) === 1 && ['super','ops'].includes(ME?.role) ? `<button class="btn primary sm" onclick="rescheduleExec(${r.id}, '${escJs(orderNo)}')">执行换团</button>` : ''}
      </div></td></tr>`).join('')}</tbody></table>` : emptyBox('该订单暂无改期申请')}
    <p class="td-sub">执行时服务端会再次校验订单状态与目标团期名额；失败整体回滚并登记「执行失败」，可重新发起。</p>`)
}
window.rescheduleVerdict = async (id, pass, orderNo) => {
  modal(pass ? '通过改期申请' : '驳回改期申请', `
    <p class="td-sub">${pass ? '通过后进入「待执行」，执行时再校验名额与订单状态；审批人不能与申请人相同。' : '驳回后申请终态；如需再改请重新发起申请。'}</p>
    <div class="field"><label>审批意见（选填，进入审计）</label><input id="rsVerdictNote" maxlength="300"></div>
    <div id="rsVerdictErr" class="td-sub" style="color:var(--red)"></div>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn ${pass ? 'primary' : 'danger'}" onclick="rescheduleVerdictSubmit(${id}, ${pass ? 1 : 0}, '${escJs(orderNo)}')">确认${pass ? '通过' : '驳回'}</button>`)
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
      <td>${ME?.role === 'super' && restorable ? `<button class="btn ghost sm" onclick="versionRestore(${pid}, ${v.versionNo}, '${escJs(String(snap.after?.price_from ?? ''))}')">恢复此版本</button>` : '<span class="td-sub">仅超管可恢复</span>'}</td></tr>`
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
