const operatingSliderFields = [
  ['orders', '月订单量', 0, 12000, 100, 1, '单'],
  ['priceFen', '客单价', 9900, 129900, 1000, 100, '元'],
  ['revenueBp', '综合变现率', 0, 4000, 10, 100, '%'],
  ['variableBp', '变动成本率', 0, 2000, 10, 100, '%'],
  ['equityBp', '权益成本率', 0, 1000, 10, 100, '%'],
  ['fixedFen', '月固定成本', 0, 50000000, 100000, 100, '元'],
]

function operatingScenarioPanel(collapsible = false) {
  if (!['super', 'ops', 'finance', 'city_partner', 'merchant_partner', 'scenic_partner'].includes(ME?.role)) return ''
  const title = '<strong>经营测算与示范案例</strong> <span class="operating-demo-tag">示例</span>'
  return collapsible
    ? `<details class="card operating-demo operating-demo-fold"><summary>${title}</summary><div data-operating-demo></div></details>`
    : `<section class="card operating-demo"><h2>${title}</h2><div data-operating-demo></div></section>`
}

async function mountOperatingScenario(container) {
  const panel = container?.querySelector('[data-operating-demo]')
  if (!panel) return
  try {
    const { calculate, example, formulaVersion } = await import('/admin-ui/scenic-formula.js')
    if (!panel.isConnected) return
    const countText = value => Number(value).toLocaleString('zh-CN')
    const format = (value, scale, suffix) => scale === 1 ? countText(value) + ' ' + suffix
      : suffix === '%' ? (value / scale).toLocaleString('zh-CN', { maximumFractionDigits: 2 }) + '%'
      : (value < 0 ? '−' : '') + fen(Math.abs(value))
    const cash = value => format(value, 100, '元')
    const fields = operatingSliderFields
    panel.innerHTML = `
      <p class="muted">拖动六项假设，查看每月结余、打平条件与不同客单价和单量的影响。示例参数可自由调整。</p>
      <div class="operating-demo-grid">
        <form data-sliders>
          ${fields.map(([key, label, min, max, step]) => `<label class="operating-slider"><span>${label}</span><output></output>
            <input name="${key}" type="range" min="${min}" max="${max}" step="${step}" value="${example[key]}" aria-label="${label}"></label>`).join('')}
          <div class="operating-demo-actions">
            <button type="button" class="btn ghost sm" data-reset>恢复示例假设</button>
            <button type="button" class="btn ghost sm" data-example>试试 4,900 单</button>
          </div>
        </form>
        <div data-scenario-results></div>
      </div>
      <div data-scenario-paths></div>
      <div data-scenario-grid></div>
      <details class="operating-demo-note"><summary>查看公式与取数口径</summary>
        <p>月 GMV＝月订单量 × 客单价。月经营贡献结余＝GMV ×（综合变现率 − 变动成本率 − 权益成本率）− 月固定成本。</p>
        <p>单笔贡献为正且固定成本大于零时，最少打平单量为固定成本除以未取整的单笔贡献并向上取整。公式版本 ${formulaVersion}。</p>
        <p>本区使用手填假设。税费、退款损失和资本开支未单列，实际收入与结算请看上方经营数据和业务源单。</p>
      </details>
      <details class="operating-demo-note" open>
        <summary>朱家角「江南谜案」· ¥298 示例闭环</summary>
        <p>一笔主题游从获客到复购的示例。金额与步骤用于讲解经营流程。示例分账中，合作方 ¥196.60，平台服务与留存 ¥86.50，权益预留 ¥14.90。</p>
        <ol class="operating-demo-steps">
          <li><b>内容获客</b><span>创作者分享主题游，来源码关联首单。</span></li>
          <li><b>交易与出票</b><span>游客付款，收到入园凭证。</span></li>
          <li><b>线下履约与二销</b><span>商户核销凭证，合作餐饮或文化体验的二销另有订单。</span></li>
          <li><b>贡献确认</b><span>核对成交、归因、履约与退款记录。</span></li>
          <li><b>分账与权益</b><span>确认履约款、佣金和权益预留，分别记录业务凭证。</span></li>
          <li><b>复购</b><span>游客在下一笔订单使用旅豆，关联首单和抵扣记录。</span></li>
          <li><b>持续投入</b><span>商户结合复购与获客成本，评估续约和预算投入。</span></li>
        </ol>
        <dl class="operating-demo-split">
          ${[['履约成本',17280],['推广分润',2380],['平台服务费',3580],['权益预留',1490],['平台留存',5070],['合计',29800]].map(([label,value]) => `<div><dt>${label}</dt><dd>${cash(value)}</dd></div>`).join('')}
        </dl>
      </details>`
    const form = panel.querySelector('[data-sliders]')
    const row = (label, value) => `<div><dt>${label}</dt><dd>${value}</dd></div>`
    const labelOf = { loss: '亏损', even: '打平', profit: '盈利' }
    function draw() {
      const inputs = Object.fromEntries(fields.map(([key]) => [key, form.elements[key].valueAsNumber]))
      const s = calculate(inputs)
      fields.forEach(([key, , , , , scale, unit]) => {
        const value = format(inputs[key], scale, unit)
        form.elements[key].closest('label').querySelector('output').textContent = value
        form.elements[key].setAttribute('aria-valuetext', value)
      })
      const count = s.breakEvenOrders == null ? '增加订单量无法打平' : countText(s.breakEvenOrders) + ' 单/月'
      panel.querySelector('[data-scenario-results]').innerHTML = `<dl class="operating-demo-results">
        ${row('月 GMV', cash(s.gmvFen))}
        ${row('月收入 · GMV × 变现率', cash(s.revenueFen))}
        ${row('变动成本 + 权益成本', cash(s.variableFen + s.equityFen))}
        ${row('月固定成本', cash(s.fixedFen))}
        ${row('月经营贡献结余 · ' + labelOf[s.status], `<strong class="operating-${s.status}">${cash(s.balanceFen)}</strong>`)}
        ${row('最少打平单量', count)}
        ${row('单笔贡献', cash(s.unitFen))}
      </dl>`
      const paths = [['price','提高客单价','priceFen',cash],['rate','提高综合变现率','revenueBp',v => format(v,100,'%')],['fixed','降低月固定成本','fixedFen',cash],['orders','增加月订单量','orders',v => format(v,1,'单')]]
      panel.querySelector('[data-scenario-paths]').innerHTML = `<h3>四条打平路径</h3><div class="operating-demo-paths">${paths.map(([key,label,input,fmt]) => {
        const x = s.paths[key]
        const result = x.status === 'available' ? `${fmt(inputs[input])} → <b>${fmt(x.value)}</b><small>回代结余 ${cash(x.balanceFen)}</small>`
          : x.status === 'satisfied' ? '当前已打平或盈利' : '当前范围内无法达标'
        return `<div><strong>${label}</strong><div>${result}</div></div>`
      }).join('')}</div>`
      panel.querySelector('[data-scenario-grid]').innerHTML = `<h3>敏感性 · 客单价 × 月订单量</h3>
        <div class="scenic-calc-table"><table class="operating-demo-table"><thead><tr><th scope="col">客单价</th>
        ${s.sensitivity[0].cells.map(c => `<th scope="col">${countText(c.orders)} 单</th>`).join('')}</tr></thead><tbody>
        ${s.sensitivity.map(r => `<tr><th scope="row">${cash(r.priceFen)}</th>
          ${r.cells.map(c => `<td class="operating-${c.status}">${cash(c.balanceFen)} <small>${labelOf[c.status]}</small></td>`).join('')}</tr>`).join('')}</tbody></table></div>`
    }
    form.addEventListener('input', draw)
    form.addEventListener('submit', e => e.preventDefault())
    panel.querySelector('[data-reset]').onclick = () => { form.reset(); draw() }
    panel.querySelector('[data-example]').onclick = () => { form.reset(); form.elements.orders.value = 4900; draw() }
    draw()
  } catch (error) {
    panel.textContent = '经营测算暂时无法加载，请刷新页面重试。'
    console.error(error)
  }
}
