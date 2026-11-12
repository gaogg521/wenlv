function scenicCalcHelpButton(context, id) {
  if (!['super', 'ops', 'finance', 'city_partner', 'merchant_partner', 'scenic_partner'].includes(ME.role) || !ADMIN_CAPABILITIES.modules?.includes('scenics')) return '' // V82：主体方也可见测算入口
  return `<button type="button" class="btn ghost sm scenic-calc-help" data-context="${esc(context)}" data-target="${esc(id)}" onclick="openScenicCalcHelp(this)"><span aria-hidden="true">❓</span> 经营测算</button>`
}

async function openScenicCalcHelp(trigger) {
  const { context, target } = trigger.dataset
  const dialog = document.createElement('dialog')
  dialog.className = 'scenic-calc-dialog'
  dialog.setAttribute('aria-labelledby', 'scenicCalcTitle')
  dialog.innerHTML = `<div class="scenic-calc-dialog-head">
    <h3 id="scenicCalcTitle">经营测算说明</h3><button class="btn ghost sm" type="button" data-close>关闭</button></div>
    <div class="scenic-calc-dialog-body">
      <p>适合用来比较客单价、单量和成本变化，也可按业务源单复盘。</p>
      <p><strong>月经营贡献结余</strong>＝订单量 × 客单价 ×（综合变现率 − 变动成本率 − 权益成本率）− 固定成本。</p>
      <p><strong>最少打平单量</strong>＝固定成本 ÷ 未取整的正向单笔贡献，向上取整。</p>
      <p>情景测算采用输入的假设。实际经营汇总按所选主体、景区和统计期间取数。</p>
      <label data-scenic-field hidden>景区 <select data-scenic aria-label="景区"></select></label>
      <p role="status" data-help-status></p>
      <button type="button" class="btn primary" data-start>打开经营测算</button>
    </div>`
  document.body.append(dialog)
  dialog.addEventListener('close', () => { dialog.remove(); if (trigger.isConnected) trigger.focus() }, { once: true })
  dialog.querySelector('[data-close]').onclick = () => dialog.close()
  dialog.showModal()
  const start = dialog.querySelector('[data-start]')
  const status = dialog.querySelector('[data-help-status]')
  const select = dialog.querySelector('[data-scenic]')
  const merchant = context === 'merchant' ? Number(target) : null
  start.onclick = async () => {
    start.disabled = true
    status.textContent = '正在打开测算…'
    try { await scenicCalculator(context === 'scenic' ? target : select.value, dialog, merchant) }
    catch (e) { if (dialog.open) { start.disabled = false; status.textContent = e.message } }
  }
  if (context !== 'scenic') {
    start.disabled = true
    status.textContent = '正在读取关联景区…'
    dialog.querySelector('[data-scenic-field]').hidden = false
    try {
      const query = merchant ? { merchantId: merchant } : { city: target }
      const rows = await api('GET', '/admin/scenic-calculator/options?' + new URLSearchParams(query))
      for (const row of rows) select.add(new Option(row.name, row.id))
      start.disabled = !rows.length
      status.textContent = rows.length ? '' : '当前经营范围暂无关联景区。'
    } catch (e) { status.textContent = e.message }
  }
}

async function scenicCalculator(id, dialog, merchantId) {
  const root = '/admin/scenics/' + Number(id) + '/calculator'
  const endpoint = (suffix = '') => root + suffix + (merchantId ? '?merchantId=' + merchantId : '')
  const data = await api('GET', endpoint())
  if (!dialog.open) return
  const fields = [
    ['orders', '月订单量（单）', 1], ['priceFen', '客单价（元）', 100],
    ['revenueBp', '综合变现率（%）', 100], ['variableBp', '变动成本率（%）', 100],
    ['equityBp', '权益成本率（%）', 100], ['fixedFen', '月固定成本（元）', 100],
  ]
  dialog.classList.add('scenic-calc-dialog-wide')
  dialog.innerHTML = `<div class="scenic-calc-dialog-head">
      <h3 id="scenicCalcTitle">经营测算 · ${esc(data.scenic.name)}</h3><button type="button" class="btn ghost sm" data-back>关闭测算</button>
    </div>
    <div class="scenic-calc scenic-calc-dialog-body">
      ${data.merchant ? '<p>商户范围 · ' + esc(data.merchant.name) + '</p>' : ''}
      <p class="muted">实际经营按支付日期和当前关联商品归集订单，退款统计截至计算时点。下方测算假设按月填写。</p>
      <form data-form>
        <h4>实际数据范围</h4>
        <div class="scenic-calc-fields">
          <label>实际统计起日<input type="date" name="from" required value="${esc(data.today.slice(0, 7))}-01"></label>
          <label>实际统计止日<input type="date" name="to" required value="${esc(data.today)}"></label>
        </div>
        <h4>测算假设</h4>
        <div class="scenic-calc-fields">
          ${fields.map(([key, label, scale]) => `<label>${label}<input required name="${key}" type="number" min="0" step="${1 / scale}" value="${data.example[key] / scale}"></label>`).join('')}
        </div>
        <div class="scenic-calc-actions">
          <button class="btn primary" type="submit">按最新数据重算</button>
          <button class="btn ghost" type="button" data-save>保存本次复盘</button>
          <button class="btn ghost" type="button" data-reset>恢复示例</button>
          <button class="btn ghost" type="button" data-import disabled>带入订单量和客单价</button>
          <label>历史复盘 <select data-history><option value="">请选择</option></select></label>
        </div>
      </form>
      <p role="status" data-status></p><div data-output></div>
    </div>`
  const container = dialog.querySelector('.scenic-calc')
  const form = container.querySelector('[data-form]')
  const status = container.querySelector('[data-status]')
  const history = container.querySelector('[data-history]')
  const importButton = container.querySelector('[data-import]')
  const setInputs = inputs => fields.forEach(([key, , scale]) => { form.elements[key].value = inputs[key] / scale })
  const addReview = (id, at) => history.add(new Option('#' + id + ' · ' + String(at).replace('T', ' ').slice(0, 19), id), 1)
  for (const row of [...data.reviews].reverse()) addReview(row.id, row.created_at)
  let latest = null
  let fingerprint = null
  async function load(action) {
    if (container.dataset.busy || (action !== 'history' && !form.reportValidity())) return
    if (action === 'save' && !fingerprint) {
      status.textContent = '请先重算并确认结果，再保存复盘。'
      return
    }
    container.dataset.busy = '1'
    status.textContent = '正在读取经营数据…'
    importButton.disabled = true
    latest = null
    container.querySelector('[data-output]').replaceChildren()
    try {
      const inputs = Object.fromEntries(fields.map(([key, , scale]) => [key, Math.round(form.elements[key].valueAsNumber * scale)]))
      const body = { from: form.elements.from.value, to: form.elements.to.value, inputs, fingerprint }
      const result = action === 'history'
        ? await api('GET', endpoint('/reviews/' + Number(history.value)))
        : await api('POST', endpoint(action === 'save' ? '/reviews' : ''), body)
      if (action === 'save') addReview(result.reviewId, result.at)
      history.value = result.reviewId || ''
      latest = result.actual
      fingerprint = result.fingerprint
      importButton.disabled = !latest.orders
      form.elements.from.value = result.from
      form.elements.to.value = result.to
      setInputs(result.scenario.inputs)
      status.textContent = (result.reviewId ? '复盘 #' + result.reviewId : '实时计算') +
        ' · 公式版本 ' + result.scenario.formulaVersion + ' · ' + new Date(result.at).toLocaleString('zh-CN')
      container.querySelector('[data-output]').innerHTML = scenicCalcResult(result)
      container.querySelectorAll('[data-order-detail]').forEach(button => {
        button.onclick = () => { dialog.close(); orderDrawer(button.dataset.orderDetail).catch(e => toast(e.message, true)) }
      })
    } catch (err) {
      fingerprint = null
      status.textContent = err.message || '读取失败'
    } finally {
      delete container.dataset.busy
    }
  }
  dialog.querySelector('[data-back]').onclick = () => dialog.close()
  dialog.querySelector('[data-back]').focus()
  container.querySelector('[data-save]').onclick = () => load('save')
  container.querySelector('[data-reset]').onclick = () => { setInputs(data.example); load('live') }
  importButton.onclick = () => {
    if (!latest?.orders) return
    form.elements.orders.value = latest.orders
    form.elements.priceFen.value = latest.avgGoodsFen / 100
    status.textContent = '已带入本期订单量与客单价。月度测算请确认所选周期为一个月，再重算。'
  }
  history.onchange = () => history.value && load('history')
  form.onsubmit = event => { event.preventDefault(); load('live') }
  await load('live')
}

function scenicCalcResult({ scenario: s, actual: a, sources, from, to }) {
  const i = s.inputs
  const cash = value => value == null ? '待核实' : (value < 0 ? '−' : '') + fen(Math.abs(value))
  const percent = bp => (bp / 100).toFixed(2) + '%'
  const path = (key, fmt) => {
    const x = s.paths[key]
    if (x.status === 'satisfied') return '已达标'
    if (x.status !== 'available') return '当前范围内无法达标'
    return esc(fmt(x.value)) + '（回代结余 ' + cash(x.balanceFen) + '）'
  }
  const orderCount = n => Number(n).toLocaleString('zh-CN') + ' 单'
  return `
    <section>
      <h3>情景测算</h3>
      <div class="scenic-calc-fields">
        <div>月 GMV <strong>${cash(s.gmvFen)}</strong></div>
        <div>月经营贡献结余 <strong>${cash(s.balanceFen)}</strong> · ${{ loss:'亏损', profit:'盈利', even:'打平' }[s.status]}</div>
        <div>单笔贡献 <strong>${cash(s.unitFen)}</strong></div>
        <div>最少打平单量 <strong>${s.breakEvenOrders == null ? '单靠增加订单无法打平' : orderCount(s.breakEvenOrders)}</strong></div>
      </div>
      <details open><summary>查看公式与代入值</summary>
        <ul>
          <li>GMV＝${orderCount(i.orders)} × ${cash(i.priceFen)}＝${cash(s.gmvFen)}</li>
          <li>收入＝${cash(s.gmvFen)} × ${percent(i.revenueBp)}＝${cash(s.revenueFen)}</li>
          <li>变动成本＝${cash(s.gmvFen)} × ${percent(i.variableBp)}＝${cash(s.variableFen)}</li>
          <li>权益成本＝${cash(s.gmvFen)} × ${percent(i.equityBp)}＝${cash(s.equityFen)}</li>
          <li>月结余＝${cash(s.gmvFen)} × (${percent(i.revenueBp)} − ${percent(i.variableBp)} − ${percent(i.equityBp)}) − ${cash(s.fixedFen)}＝${cash(s.balanceFen)}</li>
          <li>四条路径按单变量求解。客单价、变现率和订单量向上取到有效档，固定成本上限向下取到分。</li>
          <li>单笔贡献＝${cash(i.priceFen)} × ${percent(s.marginBp)}。固定成本大于零且单笔贡献为正时，平衡单量＝固定成本 ÷ 未取整单笔贡献，向上取整。</li>
          ${s.roundingDifferenceFen ? '<li>各项独立保留到分，展示尾差 ' + cash(s.roundingDifferenceFen) + '。</li>' : ''}
        </ul>
      </details>
      <h4>四条达标路径</h4>
      <ul><li>最低客单价 ${path('price', cash)}</li><li>最低变现率 ${path('rate', percent)}</li><li>固定成本上限 ${path('fixed', cash)}</li><li>最低月单量 ${path('orders', orderCount)}</li></ul>
      <h4>敏感性 · 月经营贡献结余</h4>
      <div class="scenic-calc-table"><table><thead><tr><th>客单价</th>${s.sensitivity[0].cells.map(c => '<th>' + orderCount(c.orders) + '</th>').join('')}</tr></thead>
      <tbody>${s.sensitivity.map(row => '<tr><th>' + cash(row.priceFen) + '</th>' + row.cells.map(c => '<td>' + cash(c.balanceFen) + ' · ' + { loss:'亏损', profit:'盈利', even:'打平' }[c.status] + '</td>').join('') + '</tr>').join('')}</tbody></table></div>
    </section>
    <section>
      <h3>实际经营与业务源单</h3>
      <p>${esc(from)} 至 ${esc(to)} · 已支付 ${orderCount(a.orders)} · ${a.scope === 'merchant' ? '同景区本商户' : '同景区'}复购 ${orderCount(a.repeatOrders)}</p>
      <p>商品净实收＝商品现金 ${cash(a.goodsFen)} − 成功商品退款 ${cash(a.refundFen)}＝<strong>${cash(a.netFen)}</strong>。整单退款中如含代收且未拆分，商品退款及净实收标为待核实。</p>
      ${a.costsVisible ? '<p>本期订单确认成本 ' + cash(a.confirmedCostFen) + '。存在未确认成本时暂不汇总。</p>' : ''}
      <p class="muted">按关联商品查看订单，结算单可能包含其他订单。应付与到账按结算单处理。</p>
      ${sources.length ? sources.map(o => `
        <details class="scenic-calc-source"><summary>${esc(o.orderNo)} · ${esc(o.title)} · ${cash(o.netFen)}${o.repeatOrder ? ' · 复购' : ''}</summary>
        <ul>
          ${o.firstOrderNo ? '<li>同景区首单 ' + esc(o.firstOrderNo) + '</li>' : ''}
          <li>获客来源码 ${esc(o.promoScene || '无记录')} · 核销凭证 ${o.verifiedPasses} 张 · 旅豆抵扣 ${cash(o.beanDeductFen)}</li>
          ${['super','ops','finance'].includes(ME.role) ? '<li><button class="btn ghost sm" data-order-detail="' + esc(o.orderNo) + '">查看后台订单</button></li>' : ''}
          <li>支付记录 #${o.paymentId} · 现金 ${cash(o.paymentFen)} · 保费 ${cash(o.insuranceFen)} · 商品现金 ${cash(o.goodsFen)}</li>
          ${o.refunds.map(r => `<li>退款单 ${esc(r.no)} · 已退 ${cash(r.amountFen)} · 手续费 ${cash(r.feeFen)}</li>`).join('')}
          ${o.freedomFen ? '<li>自由豆补贴 ' + cash(o.freedomFen) + ' · 状态 ' + esc(({ locked:'锁定',used:'已使用',refunded:'已退款',released:'已释放' })[o.freedomStatus] || '待核实') + '</li>' : ''}
          ${a.costsVisible ? '<li>订单确认成本 ' + cash(o.confirmedCostFen) + ' · 有效佣金记录 ' + cash(o.commissionFen) + '</li>' : ''}
          <li>${o.settlement ? '结算单 #' + o.settlement.id + ' · ' + esc(o.settlement.period) + ' · ' + (['待商户确认','待财务复核','待实际支付','已登记支付回单','异议处理中'][o.settlement.status] || '待核实') : '暂无结算记录'}</li>
        </ul></details>`).join('') : '<p class="muted">期间内暂无支付记录。先在商品中关联景区，再检查实际统计日期。</p>'}
    </section>`
}
