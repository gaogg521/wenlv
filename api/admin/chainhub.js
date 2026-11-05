// 链接入中心：联盟链 / 公链的接入配置、离线自检、只读探测与切换。凭据经后台加密保存（AES-256-GCM），密钥项不回显。
(() => {
  const E = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  const GROUPS = [['alliance', '联盟链', '政务 / 景区 / 金融场景的主流选择：许可制节点，只写指纹'], ['public', '公链', '境外业务与可流通权益：托管签名，私钥不进本服务'], ['dev', '开发与测试', '自测链与未接入状态']]
  const CAP = [['anchor', '存证锚定'], ['confirm', '终局确认'], ['queryByRoot', '按根查重'], ['assets', '资产发行'], ['did', '数字身份']]
  const PRIORITY = ['antchainopen', 'antchaincontract', 'tbaas']   // 联盟链页置顶：蚂蚁链开放联盟链（内置存证 / 合约模式）与腾讯云 TBaaS
  let hub = null, tab = 'alliance'

  window.chainhub = async function chainhub() {
    $('#app').innerHTML = `<div class="card">${skel(6)}</div>`
    hub = await api('GET', '/admin/chain/hub')
    render()
  }
  function render() {
    const cur = hub.providers.find((p) => p.current)
    // 联盟链页：已真机实测的三家（蚂蚁链两个入口 + 腾讯云 TBaaS）固定排最前，其余是模板 / 未实测
    const list = hub.providers.filter((p) => p.group === tab)
    const rank = (p) => { const i = PRIORITY.indexOf(p.id); return i < 0 ? 99 : i }
    list.sort((a, b) => rank(a) - rank(b))
    const gridHtml = tab === 'alliance'
      ? '<div class="ch-sec">已真机实测 · 优先使用</div>' + list.filter((p) => rank(p) < 99).map(card).join('')
        + (list.some((p) => rank(p) === 99) ? '<div class="ch-sec">其他联盟链 · 接口模板 / 未用真实凭据实测</div>' + list.filter((p) => rank(p) === 99).map(card).join('') : '')
      : list.map(card).join('')
    $('#app').innerHTML = `
    <section class="ch-hero">
      <div class="ch-hero-main">
        <div class="ch-eyebrow">ACTIVE CHAIN · 当前锚定链</div>
        <div class="ch-cur">${E(cur ? cur.label : hub.current)}</div>
        <div class="ch-sub">${cur && cur.mode === 'real' ? '<span class="ch-dot ok"></span>凭据齐备，新批次将真实上链' : '<span class="ch-dot warn"></span>未接入真实链：批次停在"已打包 · 待锚定"，接入后按序补锚'}</div>
      </div>
      <div class="ch-kpis">
        <div><b>${hub.pendingBatches}</b><span>待锚定批次</span></div>
        <div><b>${hub.waitingConfirm}</b><span>已提交待确认</span></div>
        <div><b>${hub.providers.filter((p) => p.mode === 'real' && p.group !== 'dev').length}</b><span>已配齐的链</span></div>
      </div>
    </section>
    <div class="ch-tabs">${GROUPS.map(([g, n, d]) => `<button class="ch-tab ${tab === g ? 'on' : ''}" onclick="chTab('${g}')"><b>${n}</b><small>${d}</small></button>`).join('')}</div>
    <div class="ch-grid">${gridHtml}</div>
    <section class="card ch-docs">
      <div class="card-head"><h3>对接约定</h3><span class="muted">与任何一家链对接时，先把这几件事说清楚</span></div>
      <div class="ch-docs-grid">
        <div><h4>上链的只有指纹</h4><p>Merkle 根（64 位十六进制）、前一批根、叶子数、业务日期、批次类型。蚂蚁链「内置存证」入口的原文另带主体、链标识、时间戳与签名（<code>wl-anchor/2</code>）；合约入口只写根 / 前根 / 业务日 / 叶数 / 序号。订单金额、姓名、手机号、身份证号等一律不上链。开放联盟链是<b>共享公开链</b>，上链内容所有人可见、不可删除。</p></div>
        <div><h4>我方提供的端口</h4><p>提交：由我方主动调用对方接口；蚂蚁链、腾讯云 TBaaS 靠我方回查回执确认，<b>不需要对方回调</b>。<br>异步回调（网关类异步链才用）：<code>POST /callback/chain/{链标识}</code>，按该链签名规则验签，回调体 <code>{ txRef, root, blockHeight }</code>。<br>公开复核：<code>/verify</code>、<code>/open/verify/order/{单号}</code>。</p></div>
        <div><h4>状态与幂等</h4><p>已打包 → 已提交·待确认 → 已锚定。需要确认的链核验回执、确认数与交易内容后才记为已锚定；同一业务号对方按首次那笔去重，重试不会重复上链。硬错误（合约回滚、根已存在、内容不符、超时查无此交易）直接转「人工处理」，不空转重试，人工状态不会被自动重提。切换当前链后，旧批次仍回原链核验。</p></div>
        <div><h4>蚂蚁链两个入口怎么选</h4><p><b>内置存证（DEPOSIT）</b>：无需部署，已真机打通，顺序由我方保证，默认入口。<br><b>合约模式</b>：需先部署落根合约（<b>不可逆</b>），链强制序号 +1 / 前根接上，可按根 <code>getRoot</code> 反查。测试合约名 <code>WanderlustRootStoreV3</code>（上面已有测试根），<b>生产请另部署新合约名</b>；V1 / V2 有缺陷已废弃。两者共用同一套凭据与 TPS=1 队列，生产前二选一。</p></div>
        <div><h4>需要对方确认</h4><ol>${hub.checklist.map((x) => `<li>${E(x)}</li>`).join('')}</ol></div>
      </div>
    </section>`
  }
  function card(p) {
    const req = p.keys.filter((k) => k.required)
    const done = req.filter((k) => k.configured).length
    const st = p.stats || {}
    return `<article class="ch-card ${p.current ? 'current' : ''}">
      <header><div><h3>${E(p.label)}</h3><p>${E(p.vendor || '')}</p></div>
        ${p.current ? '<span class="ch-badge cur">当前</span>' : p.mode === 'real' ? '<span class="ch-badge ok">已配齐</span>' : p.group === 'dev' ? '' : '<span class="ch-badge">待配置</span>'}</header>
      <div class="ch-caps">${CAP.map(([k, n]) => `<span class="${p.capabilities[k] ? 'on' : ''}">${p.capabilities[k] ? '✓' : '—'} ${n}</span>`).join('')}</div>
      <dl class="ch-proto">
        <dt>传输</dt><dd>${E(p.protocol.transport || '—')}</dd><dt>签名</dt><dd>${E(p.protocol.sign || '—')}</dd>
        <dt>形态</dt><dd>${E(p.protocol.mode || '—')}</dd><dt>合约</dt><dd>${E(p.protocol.contract || '—')}</dd>
      </dl>
      ${req.length ? `<div class="ch-prog"><i style="width:${Math.round(done / req.length * 100)}%"></i></div><div class="ch-prog-t">必填 ${done}/${req.length}${p.missing.length ? ' · 缺 ' + p.missing.map(E).join(' / ') : ''}</div>` : `<div class="ch-prog-t">${E(p.note || p.docs || '')}</div>`}
      ${st[2] || st[5] ? `<div class="ch-prog-t">已锚定 ${st[2] || 0} 批 · 待确认 ${st[5] || 0} 批</div>` : ''}
      <footer>
        ${p.keys.length ? `<button class="btn primary sm" onclick="chConfig('${p.id}')">配置接入</button>` : ''}
        ${p.hasSelfTest ? `<button class="btn ghost sm" onclick="chSelfTest('${p.id}')">离线自检</button>` : ''}
        ${p.hasProbe ? `<button class="btn ghost sm" onclick="chProbe('${p.id}')">连通性探测</button>` : ''}
        ${!p.current ? `<button class="btn ghost sm" onclick="chActivate('${p.id}')">设为当前链</button>` : ''}
      </footer>
      <div class="ch-result" id="chr_${p.id}"></div>
    </article>`
  }
  window.chTab = (g) => { tab = g; render() }

  window.chConfig = (id) => {
    const p = hub.providers.find((x) => x.id === id)
    const presets = id === 'gateway' ? Object.entries(hub.gatewayPresets).map(([k, v]) => [k, v.label]) : id === 'evm' ? Object.entries(hub.networks).map(([k, v]) => [k, v.label + ' · chainId ' + v.chainId]) : []
    drawer('配置接入 · ' + E(p.label), `
      <p class="muted" style="margin-bottom:14px">${E(p.docs)}</p>
      ${presets.length ? `<div class="field"><label>${id === 'gateway' ? '套用接口模板' : '选择网络'}</label><div class="row" style="margin:0">
        <select id="ch_preset">${presets.map(([k, n]) => `<option value="${k}">${E(n)}</option>`).join('')}</select>
        <button class="btn ghost sm" onclick="chPreset('${id}')">套用</button></div>
        <p class="muted" style="margin-top:6px">${id === 'gateway' ? '模板只填路径、请求体、字段位置与签名算法的常见形态，务必按对方签发的接口文档逐项核对。' : '自动带出 chainId、区块浏览器与默认确认数，可在下方单独覆盖。'}</p></div>` : ''}
      ${p.keys.map((k) => `<div class="field"><label>${E(k.label)}${k.required ? ' <b style="color:#c64e28">*</b>' : ''} <code style="font-size:10px">${k.key}</code></label>
        ${k.multiline ? `<textarea id="chk_${k.key}" rows="3" placeholder="${E(k.secret && k.configured ? '已保存，留空不修改' : (k.ph || ''))}">${k.secret ? '' : E(k.value)}</textarea>`
          : `<input id="chk_${k.key}" ${k.secret ? 'type="password" autocomplete="new-password"' : ''} value="${k.secret ? '' : E(k.value)}" placeholder="${E(k.secret && k.configured ? '已保存 ' + (k.hint || '') + '，留空不修改' : (k.ph || ''))}">`}
        <p class="muted" style="margin-top:4px">${k.configured ? (k.source === 'admin' ? '后台已保存' + (k.updatedBy ? ' · ' + E(k.updatedBy) : '') : '来自环境变量') : '未配置'}</p></div>`).join('')}
      <div class="field"><label>我方回调地址（异步出块时提供给对方）</label><input readonly value="${E(p.callbackUrl)}" onclick="this.select()"></div>
      <div class="row" style="margin-top:8px"><button class="btn primary" onclick="chSave('${id}')">加密保存</button><span class="muted">保存后立即生效；所有修改写入审计日志</span></div>`)
  }
  window.chPreset = async (id) => {
    try { const r = await api('POST', '/admin/chain/preset/' + id, { preset: $('#ch_preset').value }); toast('已套用 ' + r.applied.length + ' 项'); hub = await api('GET', '/admin/chain/hub'); chConfig(id) }
    catch (e) { toast(e.message, true) }
  }
  window.chSave = async (id) => {
    const p = hub.providers.find((x) => x.id === id)
    const values = Object.fromEntries(p.keys.map((k) => [k.key, (document.getElementById('chk_' + k.key)?.value || '').trim()]).filter(([, v]) => v !== ''))
    try {
      const r = await api('POST', '/admin/chain/creds/' + id, { values })
      toast(r.saved ? `已加密保存 ${r.saved} 项` + (r.status.mode === 'real' ? ' · 凭据已齐' : ' · 仍缺 ' + r.status.missing.join(' / ')) : '没有修改')
      closeModal(); hub = await api('GET', '/admin/chain/hub'); render()
    } catch (e) { toast(e.message, true) }
  }
  const showResult = (id, ok, html) => { const el = document.getElementById('chr_' + id); if (el) { el.className = 'ch-result ' + (ok ? 'ok' : 'bad'); el.innerHTML = html } }
  window.chSelfTest = async (id) => {
    try { const r = await api('POST', '/admin/chain/selftest/' + id); showResult(id, r.ok, `<b>${r.ok ? '自检通过' : '自检未通过'}</b><pre>${E(JSON.stringify(r.detail, null, 1))}</pre>`) }
    catch (e) { showResult(id, false, E(e.message)) }
  }
  window.chProbe = async (id) => {
    showResult(id, true, '探测中…')
    try { const r = await api('POST', '/admin/chain/probe/' + id); showResult(id, r.ok, `<b>${r.ok ? '连通' : '不可用'}</b> ${E(r.detail)}`) }
    catch (e) { showResult(id, false, E(e.message)) }
  }
  window.chActivate = (id) => {
    const p = hub.providers.find((x) => x.id === id)
    modal('切换当前锚定链', `<p>切换到 <b>${E(p.label)}</b> 后，新打包的批次将提交到该链。</p>
      <p class="muted" style="margin:8px 0">已提交到原链、等待确认的 ${hub.waitingConfirm} 个批次仍在原链核验，不受影响。</p>
      <label>请输入链标识 <code>${p.id}</code> 确认</label><input id="ch_confirm" placeholder="${p.id}">`,
      `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn danger" onclick="chDoActivate('${id}')">确认切换</button>`)
  }
  window.chDoActivate = async (id) => {
    try { const r = await api('POST', '/admin/chain/activate', { provider: id, confirm: $('#ch_confirm').value.trim() }); closeModal(); toast('当前链已切换为 ' + r.current + (r.note ? '；' + r.note : '')); chainhub() }
    catch (e) { toast(e.message, true) }
  }
})()
