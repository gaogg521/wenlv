// 可信存证（后台可用链上词汇）：存证中心、术语映射、数字身份、链与资产、链路总览、积分台账、勋章、权益账户
// 普通脚本（非模块）：与 core.js 共享全局作用域，加载顺序见 index.html

/* ============ 存证中心（Web3 对外窗口）============ */
async function attest() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  const d = await api('GET', '/admin/attest/center')
  // 语义分档（NOOP 期绝不显示"已上链"）：1 已打包·待锚定 / 2 已锚定 / 3 重试 / 4 人工
  const STMAP = ['<span class="pill warn">待打包</span>', '<span class="pill s20">已打包·待锚定</span>',
    '<span class="pill ok">已锚定</span>', '<span class="pill s70">锚定失败重试</span>', '<span class="pill s70">人工处理</span>']
  const real = (d.chain && d.chain.mode) === 'real'
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>存证中心</h2><span class="muted">${esc(d.chainMode)}</span></div>
    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
      ${(d.queue || []).map((qq) => `<div class="kpi"><div class="ico" style="background:var(--brand-soft)">⛓</div>
        <div><div class="l">${BIZ_CN[qq.biz_type] || esc(qq.biz_type)}</div><div class="v" style="font-size:18px">${Number(qq.pending)} 待打包</div>
        <div class="s">已打包 ${Number(qq.packed || 0)} · 已锚定 ${Number(qq.anchored)} · 累计 ${Number(qq.total)}</div></div></div>`).join('') || '<div class="kpi"><div class="s">暂无事件</div></div>'}
    </div>
    <div class="row" style="margin-top:10px">
      <button class="btn ghost sm" onclick="runJob('attest-pack','attest')">① 打包（出 Merkle 根）</button>
      <button class="btn ghost sm" onclick="runJob('attest-anchor','attest')">② 补锚（按 seq 升序）</button>
      <button class="btn ghost sm" onclick="runJob('bean-day-close','attest')">③ 封存昨日旅豆账本</button>
      <button class="btn ghost sm" onclick="runJob('attest-reconcile','attest')">④ 六条不变式对账</button>
      <span class="muted">${real ? '已接入' + esc((d.chain && d.chain.label) || '当前链') + '：补锚将真实上链' : 'NOOP：①后停留在「已打包·待锚定」，②不会产生假交易号'}</span>
    </div>
    <div class="row" style="margin-top:6px"><input id="vref" placeholder="输入订单号验证（如 WL20261024…）" style="width:320px">
      <button class="btn primary sm" onclick="verifyAttest()">验证</button>
      <span class="muted">公开验证口（无登录只读）：/open/verify/order/{单号} · /open/verify/bean-day/{日期} —— 给景区 / 政府 / 投资人的「一网可信」窗口</span></div>
    <div id="vout"></div>
  </div>
  <div class="card">
    <div class="card-head"><h3>存证批次（Merkle 根 · 链式前根）</h3><span class="muted">prev_root 指向上批根：改任一批必须改其后所有批次，而最新根在链上</span></div>
    ${(d.batches || []).length ? `<table><thead><tr><th>seq</th><th>业务日</th><th>Merkle 根</th><th>前根</th><th>叶数</th><th>尝试</th><th>链上编号</th><th>状态</th></tr></thead><tbody>
      ${d.batches.map((b) => `<tr><td class="num">#${b.seq}${Number(b.is_day_close) ? ' <span class="pill off">账本日终</span>' : ''}</td>
        <td>${esc(String(b.biz_date).slice(0, 10))}</td>
        <td><code>${esc(String(b.merkle_root).slice(0, 20))}…</code></td>
        <td class="td-sub">${b.prev_root ? '<code>' + esc(String(b.prev_root).slice(0, 12)) + '…</code>' : '链起点'}</td>
        <td class="num">${Number(b.leaf_count)}</td>
        <td class="td-sub">${Number(b.attempt) || 0}${b.last_err ? '<br><span class="pill s70">' + esc(String(b.last_err).slice(0, 24)) + '</span>' : ''}</td>
        <td class="td-sub">${b.chain_tx_ref ? esc(b.chain_tx_ref) : '—'}</td>
        <td>${STMAP[b.status] || ''}</td></tr>`).join('')}</tbody></table>` : emptyBox('尚无批次：点上方「① 打包」即可出根')}
  </div>
  <div class="card">
    <div class="card-head"><h3>旅豆账本日终封存</h3><span class="muted">借贷恒等（Σ借=Σ贷）才允许封存 —— 「严禁超发」的唯一外部证明</span></div>
    ${(d.dayRoots || []).length ? `<table><thead><tr><th>业务日</th><th>叶数</th><th>Σ贷（发放）</th><th>Σ借（消耗）</th><th>恒等</th><th>Merkle 根</th><th>对外</th></tr></thead><tbody>
      ${d.dayRoots.map((r) => `<tr><td class="num">${esc(String(r.biz_date).slice(0, 10))}</td><td class="num">${Number(r.leaf_count)}</td>
        <td class="num">${Number(r.credit_sum)}</td><td class="num">${Number(r.debit_sum)}</td>
        <td>${Number(r.debit_sum) === Number(r.credit_sum) ? '<span class="pill ok">恒等</span>' : '<span class="pill s70">不平</span>'}</td>
        <td><code>${esc(String(r.merkle_root).slice(0, 20))}…</code></td>
        <td><a class="btn ghost sm" target="_blank" rel="noopener" href="/open/report/bean-day/${String(r.biz_date).slice(0, 10)}">证明 PDF</a>
            <a class="btn ghost sm" target="_blank" rel="noopener" href="/verify?date=${String(r.biz_date).slice(0, 10)}">公开复核</a></td></tr>`).join('')}</tbody></table>` : emptyBox('尚无封存记录：点上方「③ 封存昨日旅豆账本」')}
  </div>
  <div class="card">
    <div class="card-head"><h3>最近事件</h3></div>
    <table><thead><tr><th>类型</th><th>业务单号</th><th>版本</th><th>状态</th><th>批次</th><th>Merkle 根</th><th>时间</th></tr></thead><tbody>
    ${(d.recent || []).map((e) => `<tr><td>${bizTag(esc(e.biz_type))}</td><td class="num">${esc(e.biz_ref)}</td>
      <td class="num">v${Number(e.version_no ?? 1)}</td>
      <td>${STMAP[e.status]}</td><td class="td-sub">${e.seq ? '#' + e.seq : '—'}</td>
      <td class="td-sub">${e.merkle_root ? '<code>' + esc(String(e.merkle_root).slice(0, 16)) + '…</code>' : '—'}</td>
      <td class="td-sub">${esc(String(e.created_at).slice(5, 19))}</td></tr>`).join('')}
    </tbody></table>
  </div>`
}

/* ============ 术语映射（合规词 ↔ 内部口径；数据源 = 服务端 LEXICON.TERMS，与小程序同一份字典） ============ */
async function terms() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  const lex = await api('GET', '/admin/lexicon')
  const TERM_MAP = lex.TERMS || []
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>术语映射</h2><span class="muted">后台内部口径 ↔ 小程序合规口径 · 字典更新于 ${esc(lex.updatedAt)}</span></div>
    <div class="muted" style="margin-bottom:12px">后台不上小程序审核，可用内部词汇；两个小程序端一律走合规词（小程序文案取自同一份字典 /c/lexicon）。改动任何界面文案前先对照本表，避免口径串台。</div>
    <table><thead><tr><th style="width:160px">小程序合规词（用户可见）</th><th style="width:260px">后台 / 存证口径（内部运营）</th><th>使用边界</th></tr></thead><tbody>
    ${TERM_MAP.map((t) => `<tr><td><b style="color:var(--brand-deep)">${esc(t[0])}</b></td><td><code>${esc(t[1])}</code></td><td class="td-sub">${esc(t[2])}</td></tr>`).join('')}</tbody></table>
    <div class="note" style="margin-top:14px;padding:12px;background:#fdf3e0;border-radius:8px;color:#92400e">
      <b>⚠ D6 红线：</b>不对应股权/Token 收益权、不按层级计酬、境内外隔离。内部口径仅出现在本后台与存证报告，<b>绝不回灌小程序</b>。
    </div></div>`
}


/* ============ WEB3 工作区 ============ */
/* ============ 数字身份（VC-JWT）============ */
async function vcPage() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  const d = await api('GET', '/admin/web3/vc')
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>数字身份 · 可携出旅行凭证</h2><span class="muted">${esc(d.policy)}</span></div>
    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
      <div class="kpi"><div class="ico" style="background:var(--brand-soft)">🪪</div><div><div class="l">已签发</div><div class="v" style="font-size:18px">${d.total}</div><div class="s">持有人 ${d.holders}</div></div></div>
      <div class="kpi"><div class="ico" style="background:#e3f6ec">✅</div><div><div class="l">有效</div><div class="v" style="font-size:18px">${d.active}</div><div class="s">未过期未吊销</div></div></div>
      <div class="kpi"><div class="ico" style="background:#fdecea">⛔</div><div><div class="l">已吊销</div><div class="v" style="font-size:18px">${d.revoked}</div><div class="s">吊销即时生效</div></div></div>
      <div class="kpi"><div class="ico" style="background:#fdf3e0">🔑</div><div><div class="l">公钥指纹</div><div class="v mono" style="font-size:12px">${esc(String(d.keyFingerprint).slice(0, 16))}…</div><div class="s">Ed25519</div></div></div>
    </div>
    <div class="row" style="margin-top:10px"><span class="muted">issuer</span><code>${esc(d.issuer)}</code>
      <span class="muted" style="margin-left:12px">kid</span><code>${esc(d.kid)}</code>
      <a class="btn ghost sm" style="margin-left:auto" target="_blank" rel="noopener" href="/vc">打开验签台</a>
      <a class="btn ghost sm" target="_blank" rel="noopener" href="/open/vc/issuer">公钥 JWKS</a></div>
    <div class="muted" style="margin-top:8px">凭证只含旅行事实（等级/成长区间/入会年月/行程数/城市数/徽章名），姓名手机号身份证订单号金额<strong>从不下发</strong>；第三方可凭公钥离线验签。</div>
  </div>

  <div class="card">
    <div class="card-head"><h3>代用户签发（演示 / 客服）</h3><span class="muted">签完可直接复制凭证去验签台验证</span></div>
    <div class="row">
      <input id="vcUid" type="number" placeholder="用户 id" style="width:120px">
      <select id="vcScope"><option value="travel">travel（含行程/城市/徽章）</option><option value="basic">basic（仅等级/入会）</option></select>
      <button class="btn primary sm" onclick="issueVc()">签发</button>
      <button class="btn ghost sm" onclick="openVerifyVc()">用当前凭证打开验签台</button>
    </div>
    <div id="vcOut"></div>
  </div>

  <div class="card">
    <div class="card-head"><h3>最近签发</h3><span class="muted">吊销后验签立即失败</span></div>
    ${(d.recent || []).length ? `<table><thead><tr><th>#</th><th>用户</th><th>DID</th><th>范围</th><th>签发</th><th>到期</th><th>状态</th><th>操作</th></tr></thead><tbody>
      ${d.recent.map((v) => `<tr><td class="num">${v.id}</td>
        <td class="td-main">${esc(v.nickname || '用户' + v.user_id)}</td>
        <td class="td-sub mono">${esc(String(v.did).slice(0, 18))}…</td>
        <td><span class="pill off">${esc(v.scope)}</span></td>
        <td class="td-sub">${esc(String(v.issued_at).slice(5, 19))}</td>
        <td class="td-sub">${esc(String(v.expires_at).slice(5, 19))}</td>
        <td>${v.revoked_at ? '<span class="pill s70">已吊销</span>' : (new Date(v.expires_at) > new Date() ? '<span class="pill ok">有效</span>' : '<span class="pill off">已过期</span>')}</td>
        <td>${v.revoked_at ? '—' : `<button class="btn ghost sm" onclick="revokeVc(${v.id})">吊销</button>`}</td></tr>`).join('')}
    </tbody></table>` : emptyBox('尚未签发过凭证：上方选一个用户签发即可')}
  </div>`
  window.__vcLast = ''
}

async function issueVc() {
  const userId = Number(document.getElementById('vcUid').value)
  const scope = document.getElementById('vcScope').value
  if (!userId) return toast('请填用户 id', true)
  try {
    const r = await api('POST', '/admin/web3/vc/issue', { userId, scope })
    window.__vcLast = r.jwt
    document.getElementById('vcOut').innerHTML = `
      <div class="card" style="margin-top:12px;background:#f0faf7">
        <div class="row" style="margin:0"><span class="pill ok">已签发</span>
          <span class="muted">${esc(r.did)} · 有效期至 ${esc(String(r.expiresAt).slice(0, 19))}</span></div>
        <textarea readonly style="width:100%;height:88px;margin-top:10px;font-family:monospace;font-size:11px">${esc(r.jwt)}</textarea>
        <div class="row" style="margin-top:8px"><button class="btn ghost sm" onclick="copyVc()">复制凭证</button>
          <button class="btn primary sm" onclick="openVerifyVc()">去验签</button></div>
      </div>
`
    toast('已签发')
  } catch (e) { toast(e.message, true) }
}

function copyVc() {
  const t = window.__vcLast || ''
  if (!t) return toast('还没有凭证', true)
  navigator.clipboard?.writeText(t).then(() => toast('已复制')).catch(() => toast('复制失败，请手动选择', true))
}

function openVerifyVc() {
  const t = window.__vcLast || ''
  window.open(t ? '/vc?jwt=' + encodeURIComponent(t) : '/vc', '_blank')
}

async function revokeVc(id) {
  const reason = prompt('吊销原因（会写进审计）', '违规或用户申请')
  if (!reason) return
  try { await api('POST', '/admin/web3/vc/' + id + '/revoke', { reason }); toast('已吊销'); vcPage() }
  catch (e) { toast(e.message, true) }
}


/* ============ 链与资产（多链能力矩阵 + 资产发行台账）============ */
async function chainAssetsPage() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  const d = await api('GET', '/admin/web3/assets')
  const c = await api('GET', '/admin/web3/chain').catch(() => ({}))
  const cur = d.chain || {}
  const cap = cur.capabilities || {}
  const mark = (b) => (b ? '<span class="pill ok">支持</span>' : '<span class="pill off">—</span>')
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>链与资产</h2><span class="muted">当前链：<b>${esc(cur.label || cur.provider)}</b> · ${cur.mode === 'real' ? '<span class="pill ok">已接入</span>' : '<span class="pill warn">未接入（NOOP）</span>'}</span></div>
    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
      <div class="kpi"><div class="ico" style="background:var(--brand-soft)">⛓</div><div><div class="l">已发行</div><div class="v" style="font-size:18px">${d.issued}</div><div class="s">累计 ${d.total}</div></div></div>
      <div class="kpi"><div class="ico" style="background:#fdf3e0">⏳</div><div><div class="l">待发行</div><div class="v" style="font-size:18px">${d.pending}</div><div class="s">凭据到位后补发</div></div></div>
      <div class="kpi"><div class="ico" style="background:#fdecea">⚠️</div><div><div class="l">失败</div><div class="v" style="font-size:18px">${d.failed}</div><div class="s">可重试</div></div></div>
      <div class="kpi"><div class="ico" style="background:#e8effd">🧩</div><div><div class="l">支持资产</div><div class="v" style="font-size:15px">${cap.assets ? '是' : '否'}</div><div class="s">${cap.assets ? '可发行徽章/NFT' : '当前链只做存证'}</div></div></div>
    </div>
    <div class="muted" style="margin-top:10px">切换链：改环境变量 <code>CHAIN_PROVIDER=chaingen|tbaas|antchain|evm|noop</code> 后重启，业务与页面零改动。当前缺：${(cur.missing || []).length ? '<b>' + esc(cur.missing.join('、')) + '</b>' : '无'}。</div>
  </div>

  <div class="card">
    <div class="card-head"><h3>多链能力矩阵</h3><span class="muted">不同链能做不同的事：联盟链只存证，公链才发资产</span></div>
    <table><thead><tr><th>链</th><th>存证锚定</th><th>按根反查</th><th>资产发行</th><th>DID</th><th>状态</th><th>说明</th></tr></thead><tbody>
    ${(d.providers || []).map((p) => `<tr>
      <td class="td-main">${esc(p.label)}${p.current ? ' <span class="pill ok">当前</span>' : ''}</td>
      <td>${mark(p.capabilities.anchor)}</td><td>${mark(p.capabilities.queryByRoot)}</td>
      <td>${mark(p.capabilities.assets)}</td><td>${mark(p.capabilities.did)}</td>
      <td>${p.mode === 'real' ? '<span class="pill ok">已配置</span>' : '<span class="pill off">缺凭据</span>'}</td>
      <td class="td-sub">${esc(p.docs || '')}</td></tr>`).join('')}
    </tbody></table>
  </div>

  ${(c.preflight || []).length ? `
  <div class="card">
    <div class="card-head"><h3>预埋体检</h3><span class="muted">离线自检 · 不需要凭据 · ${(c.summary || {}).ready}/${(c.summary || {}).total} 家通过</span></div>
    <table><thead><tr><th>链</th><th>离线自检</th><th>凭据</th><th>必问对方</th></tr></thead><tbody>
    ${(c.preflight || []).filter((p) => p.id !== 'noop' && p.id !== 'mock').map((p) => `<tr>
      <td class="td-main">${esc(p.label)}${p.active ? ' <span class="pill ok">当前</span>' : ''}</td>
      <td>${p.selfOk ? '<span class="pill ok">通过</span>' : '<span class="pill warn">失败</span>'}</td>
      <td class="td-sub">${p.missing.length ? '缺 <b>' + esc(p.missing.join('、')) + '</b>' : '<span class="pill ok">齐备</span>'}</td>
      <td class="td-sub"><details><summary>${p.ask.length} 条</summary><ul style="margin:6px 0 0 16px;padding:0">${p.ask.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></details></td>
    </tr>`).join('')}
    </tbody></table>
    <div class="muted" style="margin-top:10px">填空模板：<code>api/config/chains/</code>（链数根 / 腾讯TBaaS / 蚂蚁链鲸探 / EVM公链），每份含「找谁要、接口约定、必问 4 问」。命令行同源：<code>node scripts/chain-preflight.mjs</code></div>
  </div>` : ''}

  <div class="card">
    <div class="card-head"><h3>发行一件资产</h3><span class="muted">微信渠道被硬禁（D10）；不支持资产的链会明确报错</span></div>
    <div class="row">
      <select id="akKind">${(d.kinds || []).map((k) => `<option value="${k.id}">${esc(k.label)}</option>`).join('')}</select>
      <select id="akChannel">${(d.channels || []).map((c) => `<option value="${c.id}" ${c.allowed ? '' : 'disabled'}>${esc(c.label)}${c.allowed ? '' : '（禁止）'}</option>`).join('')}</select>
      <input id="akUid" type="number" placeholder="用户 id" style="width:110px">
      <input id="akToken" placeholder="tokenId（可空）" style="width:140px">
      <input id="akName" placeholder="名称，如「瑜伽修行者」" style="width:200px">
      <button class="btn primary sm" onclick="issueAsset()">发行</button>
    </div>
    <div id="akOut"></div>
  </div>

  <div class="card">
    <div class="card-head"><h3>发行台账</h3><span class="muted">未发行也留痕：台账先记，链上后补</span></div>
    ${(d.rows || []).length ? `<table><thead><tr><th>#</th><th>类型</th><th>渠道</th><th>链</th><th>用户</th><th>tokenId</th><th>交易号</th><th>状态</th><th>操作</th></tr></thead><tbody>
      ${d.rows.map((r) => `<tr><td class="num">${r.id}</td>
        <td>${esc(r.kind)}</td><td class="td-sub">${esc(r.channel)}</td><td class="td-sub">${esc(r.provider)}</td>
        <td class="td-sub">${esc(r.nickname || '用户' + r.user_id)}</td>
        <td class="td-sub mono">${esc(r.token_id || '—')}</td>
        <td class="td-sub mono">${r.tx_ref ? esc(String(r.tx_ref).slice(0, 14)) + '…' : '—'}</td>
        <td>${r.status == 1 ? '<span class="pill ok">已发行</span>' : (r.status == 0 ? '<span class="pill warn">待发行</span>' : '<span class="pill s70">失败</span>')}
          ${r.err ? '<div class="td-sub">' + esc(String(r.err).slice(0, 30)) + '</div>' : ''}</td>
        <td>${r.status == 1 ? '—' : `<button class="btn ghost sm" onclick="retryAsset(${r.id})">重试</button>`}</td></tr>`).join('')}
    </tbody></table>` : emptyBox('还没有发行记录：上方选类型与用户发行一件试试')}
  </div>`
}

async function issueAsset() {
  const kind = document.getElementById('akKind').value
  const channel = document.getElementById('akChannel').value
  const userId = Number(document.getElementById('akUid').value)
  const tokenId = document.getElementById('akToken').value.trim() || null
  const name = document.getElementById('akName').value.trim() || '数字徽章'
  if (!userId) return toast('请填用户 id', true)
  try {
    const r = await api('POST', '/admin/web3/assets/issue', { kind, channel, userId, tokenId, meta: { name } })
    document.getElementById('akOut').innerHTML = r.status === 1
      ? `<div class="card" style="margin-top:12px;background:#f0faf7"><span class="pill ok">已发行</span>
         <span class="muted">txRef ${esc(String(r.txRef).slice(0, 18))}… · tokenId ${esc(r.tokenId || '—')}</span></div>`
      : `<div class="card" style="margin-top:12px;background:#fff8ec"><span class="pill warn">${r.status === 0 ? '已入待发行队列' : '发行失败'}</span>
         <span class="muted">${esc(r.note || r.err || '')}</span></div>`
    toast(r.status === 1 ? '已发行' : r.status === 0 ? '已入队' : '未发行')
  } catch (e) { toast(e.message, true) }
}

async function retryAsset(id) {
  try { const r = await api('POST', '/admin/web3/assets/' + id + '/retry'); toast(r.status === 1 ? '已补发' : (r.reason || r.err || '未完成')); chainAssetsPage() }
  catch (e) { toast(e.message, true) }
}


// ---- 链上总览：链路视图（3D 区块链）+ KPI + 事件动态 ----
const BLOCK_ST = ['<span class="dpill warn">待打包</span>', '<span class="dpill info">已打包·待锚定</span>',
  '<span class="dpill ok">已锚定</span>', '<span class="dpill err">锚定重试</span>', '<span class="dpill err">人工处理</span>',
  '<span class="dpill warn">已提交·待确认</span>']
/** 3D 区块：tone = blue | green | gold | gray；sm = 小号；pulse = 等待链上确认中 */
function cube3d(tone, opt = {}) {
  const cls = ['cube-zone', tone && tone !== 'blue' ? 't-' + tone : '', opt.sm ? 'sm' : '', opt.pulse ? 'pulse' : '', opt.ghost ? 'ghost' : ''].filter(Boolean).join(' ')
  // 特效层全部是 .cube3d 的兄弟节点：不参与 preserve-3d，加光晕/滤镜不会把立方体压平
  // 特效集中在区块本身：面网格 + 棱线流光 + 呼吸内核 + 悬停展开；外围只保留底座涟漪、一圈轨道和瞄准角标
  const fx = opt.ghost ? '' : '<span class="fx-ripple"></span><span class="fx-ripple r2"></span>'
    + '<span class="fx-orbit"><i></i></span>' + '<span class="fx-hud"></span>'
  return `<div class="${cls}"${opt.label ? '' : ' aria-hidden="true"'}>${fx}<div class="cube3d">`
    + '<div class="fc"></div>'.repeat(6) + '<div class="core">' + '<i></i>'.repeat(6) + '</div></div>'
    + (opt.label ? `<div class="ghost-label">${opt.label}</div>` : '') + '</div>'
}
// 演示模式：纯前端模拟一条 8 节点的链（含分支/待打包/已锚定），不动真库，仅供形态预览
function mockChain() {
  const HEX = ['3f9a1c7e5d24b806', '8d02e4b1a97c33f5', '5c77aa190e6db248', 'e21b6d40fa93c715',
    '9b48f0c26d1eab73', '17d5a93e04fb8c62', '4e6c88d2b17a05f3', 'b0f3126a7de948c1']
  const root = (i) => HEX[i % 8] + '9f4c1a2b7de50863'
  const mk = (seq, kind, status, date, leaves) => ({ id: 900 + seq, seq, biz_date: date,
    merkle_root: root(seq - 1), prev_root: seq === 1 ? null : root(seq - 2), leaf_count: leaves,
    is_day_close: kind === 'day' ? 1 : 0, status, attempt: 0,
    chain_tx_ref: status === 2 ? 'DEMO-TX-' + String(seq).padStart(4, '0') : null,
    anchored_at: status === 2 ? date + ' 09:12:00' : null })
  return [
    mk(1, 'mix', 2, '2026-10-27', 9), mk(2, 'day', 2, '2026-10-27', 6), mk(3, 'mix', 2, '2026-10-28', 14),
    mk(4, 'mix', 1, '2026-10-29', 11), mk(5, 'day', 1, '2026-10-30', 7), mk(6, 'mix', 1, '2026-10-30', 12),
    mk(7, 'mix', 0, '2026-10-31', 16), mk(8, 'day', 0, '2026-10-31', 8),
  ]
}
function mockBlockEvents(b) {
  const TYPES = ['order', 'pass_issue', 'bean_grant', 'pass_verify', 'refund', 'settlement', 'bean_deduct']
  const REF = { order: 'WL2026', pass_issue: 'pass-', pass_verify: 'pass-1-', bean_grant: 'bt-BT', bean_deduct: 'bt-BT', refund: 'RF', settlement: 'settle-' }
  return Array.from({ length: Math.min(Number(b.leaf_count), 10) }, (_, i) => {
    const t = TYPES[(b.seq + i) % TYPES.length]
    return { id: i, leaf_index: i, biz_type: t, biz_ref: REF[t] + String(20261020 + b.seq * 7 + i) + (t === 'order' ? '' : ''), version_no: 1,
      payload_hash: String(b.merkle_root).slice(0, 12) + (i * 7 % 100).toString().padStart(2, '0') + 'a1b2c3d4e5f60718', status: Number(b.status), created_at: b.biz_date + ' 1' + (i % 10) + ':1' + (i % 6) + ':00' }
  })
}
function toggleDemoChain() {
  window.__demoChain = !window.__demoChain
  web3dash()
}
function blockNodeHTML(b) {
  const dayClose = Number(b.is_day_close) === 1
  const st = Number(b.status)
  const root8 = String(b.merkle_root).slice(0, 8)
  const tone = st === 0 ? 'gray' : st === 3 ? 'red' : (dayClose ? 'gold' : (st === 2 ? 'green' : 'blue'))
  const cls = 'chain-node' + (dayClose ? ' branch' : '') + (st === 2 ? ' anchored' : '')
  return `<div class="${cls}" id="bnode-${b.id}" tabindex="0" onclick="openBlock(${b.id})"
    onmouseenter="chainTip(event, 'b', ${b.id})" onmousemove="chainTipMove(event)" onmouseleave="chainTipHide()" onfocus="chainTip(event, 'b', ${b.id})" onblur="chainTipHide()">
    ${cube3d(tone, { pulse: st === 5 })}
    <div class="blk-title">${dayClose ? '账本日终' : '区块'} #${b.seq}${b.prev_root ? '' : ' <span class="dpill genesis">创世</span>'}</div>
    <div class="blk-line">业务日 ${esc(String(b.biz_date).slice(0, 10))}</div>
    <div class="blk-line">事件 <b>${Number(b.leaf_count)}</b> 条 · ${dayClose ? '账本封存' : '业务存证'}</div>
    <div class="blk-line">根 <code class="dk">${root8}…</code></div>
    <div class="blk-line">${BLOCK_ST[st] || ''}</div>
  </div>`
}
/* ---- 区块悬停信息卡：先用列表里已有的批次字段即时显示，事件构成按需拉取并缓存 ---- */
const TIP_ST = ['待打包', '已打包·待锚定', '已锚定', '锚定失败', '', '已提交·待确认']
const tipCache = {}
function tipEl() {
  let el = document.getElementById('chainTip')
  if (!el) { el = document.createElement('div'); el.id = 'chainTip'; el.className = 'chain-tip'; el.setAttribute('role', 'tooltip'); el.hidden = true; document.body.appendChild(el) }
  return el
}
const tipRow = (k, v) => v == null || v === '' ? '' : `<div class="tip-row"><span>${k}</span><b>${v}</b></div>`
const tipTime = (t) => t ? esc(String(t).slice(0, 19).replace('T', ' ')) : ''
function blockTipHtml(b) {
  const st = Number(b.status), day = Number(b.is_day_close) === 1
  const mix = tipCache[b.id]
  return `<div class="tip-head"><span class="tip-kind ${day ? 'gold' : ''}">${day ? '账本日终' : '业务区块'}</span><b>#${b.seq}</b>
      <span class="dpill ${st === 2 ? 'ok' : st === 3 ? 'err' : st === 0 ? 'warn' : 'info'}">${TIP_ST[st] || '—'}</span>${window.__demoChain ? '<span class="dpill warn">演示</span>' : ''}</div>
    ${tipRow('业务日', esc(String(b.biz_date || '').slice(0, 10)))}
    ${tipRow('事件数', Number(b.leaf_count) + ' 条')}
    <div class="tip-hash"><span>Merkle 根</span><code>${esc(b.merkle_root || '')}</code></div>
    <div class="tip-hash"><span>前根 prev_root</span><code>${b.prev_root ? esc(b.prev_root) : '— 创世区块'}</code></div>
    ${tipRow('算法', b.merkle_kind ? esc(b.merkle_kind) + (b.merkle_version ? ' · v' + Number(b.merkle_version) : '') : (b.merkle_version ? 'v' + Number(b.merkle_version) : ''))}
    ${tipRow('链适配器', b.chain_provider ? esc(b.chain_provider) : '')}
    ${tipRow('交易', b.chain_tx_ref ? `<code>${esc(String(b.chain_tx_ref).slice(0, 22))}${String(b.chain_tx_ref).length > 22 ? '…' : ''}</code>` : '')}
    ${tipRow('链上区块 / 确认数', b.chain_block ? esc(b.chain_block) + (b.confirmations != null ? ' / ' + Number(b.confirmations) : '') : '')}
    ${tipRow('提交时间', tipTime(b.submitted_at))}
    ${tipRow('锚定时间', tipTime(b.anchored_at))}
    ${Number(b.attempt) ? tipRow('重试次数', Number(b.attempt)) : ''}
    ${b.last_err ? `<div class="tip-err">最近错误：${esc(String(b.last_err).slice(0, 120))}</div>` : ''}
    <div class="tip-mix">${mix === undefined ? '<span class="muted">事件构成加载中…</span>' : mix === null ? '' : Object.entries(mix).map(([k, n]) => `<span>${esc(BIZ_CN[k] || k)} <b>${n}</b></span>`).join('')}</div>
    <div class="tip-foot">点击查看批内事件与证明路径</div>`
}
function flowTipHtml(i) {
  const s = ((window.__flowData || {}).steps || [])[i]
  const e = s && s.ev
  if (!e) return ''
  const st = Number(e.status)
  return `<div class="tip-head"><span class="tip-kind">${esc(s.no || '')}</span><b>${esc(s.label || '')}</b><span class="dpill ${st === 2 ? 'ok' : st === 0 ? 'warn' : 'info'}">${TIP_ST[st] || '—'}</span></div>
    ${tipRow('业务类型', esc(BIZ_CN[e.biz_type] || e.biz_type || ''))}
    ${tipRow('业务单号', e.biz_ref ? `<code>${esc(e.biz_ref)}</code>` : '')}
    ${tipRow('版本', e.version_no != null ? 'v' + Number(e.version_no) : '')}
    ${tipRow('产生时间', tipTime(e.created_at))}
    ${tipRow('所在批次', e.seq != null ? '#' + e.seq : '尚未打包')}
    ${e.payload_hash ? `<div class="tip-hash"><span>载荷哈希</span><code>${esc(e.payload_hash)}</code></div>` : ''}
    ${e.merkle_root ? `<div class="tip-hash"><span>批次根</span><code>${esc(e.merkle_root)}</code></div>` : ''}
    ${tipRow('链上交易', e.chain_tx_ref ? `<code>${esc(String(e.chain_tx_ref).slice(0, 22))}</code>` : '')}
    <div class="tip-foot">点击查看本步证明</div>`
}
function chainTip(ev, kind, id) {
  const el = tipEl()
  const render = () => { el.innerHTML = kind === 'b' ? blockTipHtml((window.__chainMap || {})[id] || {}) : flowTipHtml(id) }
  render()
  if (!el.innerHTML.trim()) return
  el.hidden = false; el.dataset.key = kind + id
  chainTipMove(ev)
  if (kind === 'b' && tipCache[id] === undefined) {
    if (window.__demoChain) { tipCache[id] = null; return render() }
    api('GET', '/admin/attest/batch/' + id).then((r) => {
      tipCache[id] = (r.events || []).reduce((m, x) => { m[x.biz_type] = (m[x.biz_type] || 0) + 1; return m }, {})
      if (el.dataset.key === kind + id && !el.hidden) { render(); chainTipMove(ev) }
    }).catch(() => { tipCache[id] = null })
  }
}
function chainTipMove(ev) {
  const el = document.getElementById('chainTip'); if (!el || el.hidden) return
  const r = ev.clientX != null && ev.type !== 'focus' ? { x: ev.clientX, y: ev.clientY } : (() => { const b = ev.currentTarget.getBoundingClientRect(); return { x: b.right, y: b.top } })()
  const w = el.offsetWidth, h = el.offsetHeight
  let x = r.x + 18, y = r.y + 14
  if (x + w > innerWidth - 8) x = r.x - w - 18
  if (y + h > innerHeight - 8) y = Math.max(8, innerHeight - h - 8)
  el.style.left = Math.max(8, x) + 'px'; el.style.top = y + 'px'
}
function chainTipHide() { const el = document.getElementById('chainTip'); if (el) { el.hidden = true; el.dataset.key = '' } }
function blockLinkHTML(prevBranch, curBranch) {
  const y = (p) => p ? 133 : 59
  const y1 = y(prevBranch), y2 = y(curBranch)
  // <s> 是沿连线流动的数据包，表示"前一块的根被写进后一块的 prev_root"
  if (y1 === y2) return `<div class="chain-link"><i style="top:${y1 - 1}px"></i><s style="top:${y1 - 2}px"></s><s class="p2" style="top:${y1 - 2}px"></s><u style="top:${y1 - 11}px">»</u></div>`
  const down = y1 < y2
  const top = Math.min(y1, y2) - 1
  const edge = down ? 'border-top:2px dashed var(--cl);border-top-right-radius:12px' : 'border-bottom:2px dashed var(--cl);border-bottom-right-radius:12px'
  return `<div class="chain-link elbow"><i style="top:${top}px;height:${Math.abs(y2 - y1)}px;${edge};border-right:2px dashed var(--cl)"></i>
    <b style="top:${y2 - 1}px"></b><s class="tail" style="top:${y2 - 2}px"></s><u style="top:${y2 - 11}px">▸</u></div>`
}
async function web3dash() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  if (window.__chainTimer) { clearInterval(window.__chainTimer); window.__chainTimer = null }
  const [d, c] = await Promise.all([api('GET', '/admin/web3/overview'), api('GET', '/admin/attest/center')])
  const demo = !!window.__demoChain
  const batches = demo ? mockChain() : (c.batches || []).slice().sort((a, b) => a.seq - b.seq)
  const pendingN = demo ? batches.filter((b) => Number(b.status) === 0).reduce((s, b) => s + Number(b.leaf_count), 0) : Number(d.pendingEvents)
  const anchorN = demo ? batches.filter((b) => Number(b.status) === 2).reduce((s, b) => s + Number(b.leaf_count), 0) : d.anchoredEvents
  const totalN = demo ? batches.reduce((s, b) => s + Number(b.leaf_count), 0) : d.events
  const lastSeq = batches.length ? batches[batches.length - 1].seq : 0
  window.__chainMap = Object.fromEntries(batches.map((b) => [b.id, b]))
  const nodes = []
  batches.forEach((b, i) => {
    if (i) nodes.push(blockLinkHTML(Number(batches[i - 1].is_day_close) === 1, Number(b.is_day_close) === 1))
    nodes.push(blockNodeHTML(b))
  })
  if (Number(pendingN) > 0) {
    nodes.push(blockLinkHTML(batches.length ? Number(batches[batches.length - 1].is_day_close) === 1 : false, false))
    nodes.push(`<div class="chain-node ghost">${cube3d('gray', { ghost: true, label: '待打包<br><b>' + pendingN + '</b> 条' })}
      <div class="blk-title" style="opacity:.75">下一区块</div>
      <div class="blk-line" style="opacity:.7">小时级打包 · #${lastSeq + 1}</div></div>`)
  }
  const auto = window.__chainAuto === undefined ? (window.__chainAuto = true) : window.__chainAuto
  $('#app').innerHTML = `
  <div class="chain-panel" id="chainViz">
    <div class="chain-glow"></div>
    <div class="chain-head">
      <span class="chain-name">⛓ 向往自由链 · 链路视图</span><span class="chain-live"><i></i>LIVE</span>
      ${demo ? '<span class="chip demo">演示数据</span>' : ''}
      <span class="chip">适配器 ${esc((d.chain && d.chain.label) || '—')}</span>
      <span class="chip">区块高度 <b>#${lastSeq}</b></span>
      <span class="chip">链上事件 <b>${anchorN}/${totalN}</b></span>
      <span class="chip">待打包 <b>${pendingN}</b></span>
      <span style="flex:1"></span>
      <label class="chain-auto"><input type="checkbox" id="chainAuto" ${auto ? 'checked' : ''} onchange="window.__chainAuto=this.checked;chainTimerSetup()"> 30s 自动刷新</label>
      <button class="chain-btn ${demo ? 'demo-on' : ''}" onclick="toggleDemoChain()">${demo ? '退出演示' : '演示 · 多节点形态'}</button>
      <button class="chain-btn" onclick="web3dash()">刷新 ↻</button>
    </div>
    ${demo ? '<div class="chain-demo-note">演示模式：以下为模拟数据，仅预览多节点链路形态，不代表真实链上状态</div>' : ''}
    <div class="chain-track">${nodes.join('') || '<div class="blk-line" style="padding:30px">尚无区块：到「存证中心」点「① 打包」即可出根</div>'}</div>
    <div class="chain-divider"></div>
    <div class="flow-head">
      <span class="chain-name" style="font-size:13px">🧭 单流程视角 · 一单六锚</span>
      <input id="flowNo" class="flow-input" placeholder="输入订单号（如 WL202610311650904810）" onkeydown="if(event.key==='Enter')loadFlow()">
      <button class="chain-btn" onclick="loadFlow()">追踪此单 ↗</button>
      <button class="chain-btn" onclick="loadFlowDemo()">演示完整流程</button>
      <span id="flowMeta" style="flex:1;font-size:12px;color:#9db1e2"></span>
    </div>
    <div id="flowTrack"></div>
    <div class="chain-legend">
      <span><i class="lg blue"></i>业务存证块</span><span><i class="lg gold"></i>账本日终封存块（分支）</span>
      <span><i class="lg green"></i>已锚定</span><span><i class="lg dash"></i>待打包队列</span>
      <span class="muted" style="margin-left:auto;color:#7f92bd">prev_root 指向上批根 · 点击区块查看批内事件</span>
    </div>
  </div>
  <div id="blockDetail"></div>
  <div class="card">
    <div class="card-head"><h2>链上总览 · 双层口径</h2><span class="muted">${esc(d.chainMode)} · 小程序内=旅豆积分，对外=链上权益凭证</span></div>
    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
      <div class="kpi go" ${dxKey} title="去存证中心" onclick="go('attest')"><i class="go-arrow">↗</i><div class="ico" style="background:var(--brand-soft)">⛓</div><div><div class="l">锚定批次</div><div class="v" style="font-size:18px">${d.anchoredBatches}/${d.batches}</div><div class="s">Merkle 小时级打包</div></div></div>
      <div class="kpi go" ${dxKey} title="去存证中心" onclick="go('attest')"><i class="go-arrow">↗</i><div class="ico" style="background:#e8effd">🔗</div><div><div class="l">链上事件</div><div class="v" style="font-size:18px">${d.anchoredEvents}/${d.events}</div><div class="s">待打包 ${d.pendingEvents}</div></div></div>
      <div class="kpi go" ${dxKey} title="去徽章管理" onclick="go('badges')"><i class="go-arrow">↗</i><div class="ico" style="background:#fdf3e0">🏅</div><div><div class="l">勋章发放</div><div class="v" style="font-size:18px">${d.badgeGrants}</div><div class="s">发放即入存证队列</div></div></div>
      <div class="kpi go" ${dxKey} title="去积分发行台账" onclick="go('pointassets')"><i class="go-arrow">↗</i><div class="ico" style="background:#e3f6ec">🫘</div><div><div class="l">累计发放</div><div class="v" style="font-size:18px">${d.beanGranted}</div><div class="s">已消耗 ${d.beanConsumed}</div></div></div>
    </div>
    <div class="row" style="margin-top:10px">${(d.trustPath || []).map((t, i) => `<span class="pill ${i ? 'off' : 'ok'}">${esc(t)}</span>`).join('<span class="muted">→</span>')}<span class="muted" style="margin-left:auto">上链的只有哈希指纹+时间戳，业务数据全在 MySQL（数据库是事实来源，链是审计锚点）</span></div>
  </div>
  <div class="card">
    <div class="card-head"><h3>链上事件动态</h3><button class="btn ghost sm" onclick="go('attest')">进入存证中心 ›</button></div>
    <table><thead><tr><th>类型</th><th>业务单号</th><th>状态</th><th>时间</th></tr></thead><tbody>
    ${(d.recentEvents || []).map((e) => `<tr><td>${bizTag(esc(e.biz_type))}</td><td class="num">${esc(e.biz_ref)}</td>
      <td>${e.status === 2 ? '<span class="pill ok">已锚定</span>' : (e.status === 1 ? '<span class="pill s20">已打包·待锚定</span>' : '<span class="pill warn">待打包</span>')}</td>
      <td class="td-sub">${esc(String(e.created_at).slice(5, 19))}</td></tr>`).join('') || '<tr><td colspan="4" class="td-sub">暂无事件</td></tr>'}
    </tbody></table>
  </div>`
  if (window.__flowShown && window.__flowData) renderFlow(window.__flowData)
  chainTimerSetup()
}
function chainTimerSetup() {
  if (window.__chainTimer) { clearInterval(window.__chainTimer); window.__chainTimer = null }
  if (!window.__chainAuto) return
  window.__chainTimer = setInterval(() => {
    if (!document.getElementById('chainViz')) { clearInterval(window.__chainTimer); window.__chainTimer = null; return }
    web3dash()
  }, 30000)
}
async function openBlock(id) {
  document.querySelectorAll('.chain-node.active').forEach((n) => n.classList.remove('active'))
  const el = document.getElementById('bnode-' + id)
  if (el) el.classList.add('active')
  const box = document.getElementById('blockDetail')
  box.innerHTML = `<div class="card">${skel(3)}</div>`
  const demo = !!window.__demoChain && id >= 900
  let b, evs = []
  if (demo) {
    b = mockChain().find((x) => x.id === id)
    if (!b) { box.innerHTML = ''; return }
    evs = mockBlockEvents(b)
  } else {
    const r = await api('GET', '/admin/attest/batch/' + id)
    b = r.batch; evs = r.events || []
  }
  const BST = ['<span class="pill warn">待打包</span>', '<span class="pill s20">已打包·待锚定</span>', '<span class="pill ok">已锚定</span>', '<span class="pill s70">锚定重试</span>', '<span class="pill s70">人工处理</span>']
  box.innerHTML = `
  <div class="card">
    <div class="card-head"><h3>区块 #${b.seq} · 批内事件（${Number(b.leaf_count)}${demo ? '，演示取前 10' : ''}）</h3>
      <span class="muted">${Number(b.is_day_close) ? '旅豆账本日终封存批 · ' : ''}打包于 ${esc(String(b.biz_date).slice(0, 10))}${demo ? ' · 演示数据' : ''}</span></div>
    <div class="row" style="gap:18px;flex-wrap:wrap;font-size:12.5px">
      <span>Merkle 根 <code>${esc(b.merkle_root)}</code></span>
      <span>前根 <code>${b.prev_root ? esc(b.prev_root) : '—（链起点）'}</code></span>
      ${b.chain_tx_ref ? `<span>链上编号 <code>${esc(b.chain_tx_ref)}</code></span>` : ''}
      ${b.anchored_at ? `<span>锚定时间 ${esc(String(b.anchored_at).slice(0, 19))}</span>` : ''}
      <span>尝试 ${Number(b.attempt) || 0} 次</span>
      ${!demo && Number(b.is_day_close) ? `<a class="btn ghost sm" target="_blank" rel="noopener" href="/open/report/bean-day/${esc(String(b.biz_date).slice(0, 10))}">封存证明 PDF</a>
        <a class="btn ghost sm" target="_blank" rel="noopener" href="/verify?date=${esc(String(b.biz_date).slice(0, 10))}">公开复核</a>` : ''}
    </div>
    <table style="margin-top:10px"><thead><tr><th>叶序</th><th>类型</th><th>业务单号</th><th>版本</th><th>payload 指纹</th><th>状态</th><th>时间</th><th></th></tr></thead><tbody>
    ${evs.map((e) => `<tr><td class="num">${Number(e.leaf_index)}</td><td>${bizTag(esc(e.biz_type))}</td>
      <td class="num">${esc(e.biz_ref)}</td><td class="num">v${Number(e.version_no ?? 1)}</td>
      <td class="td-sub"><code>${esc(String(e.payload_hash).slice(0, 16))}…</code></td>
      <td>${BST[e.status] || ''}</td><td class="td-sub">${esc(String(e.created_at).slice(5, 19))}</td>
      <td>${!demo && e.biz_type === 'order' ? `<a class="btn ghost sm" target="_blank" rel="noopener" href="/verify?no=${encodeURIComponent(e.biz_ref)}">公开复核</a>`
        : (demo ? '' : `<button class="btn ghost sm" onclick="verifyEventInline('${esc(e.biz_type)}','${esc(e.biz_ref)}',${e.id})">验证</button>`)}</td></tr>`).join('') || '<tr><td colspan="8" class="td-sub">空批次</td></tr>'}
    </tbody></table>
  </div>`
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}
async function verifyEventInline(bizType, bizRef, id) {
  const r = await api('GET', '/admin/attest/verify?bizType=' + encodeURIComponent(bizType) + '&bizRef=' + encodeURIComponent(bizRef))
  const ok = r.found && r.proofValid !== false
  toast(r.found ? (ok ? '验证通过 · ' + (r.note || '') : '验证失败：证明路径对不上根') : '未找到该单号', !ok)
}
// ---- 单流程视角：一单六锚（一笔订单的 6 步链上锚点） ----
const FLOW_ST = ['<span class="dpill warn">待打包</span>', '<span class="dpill info">已打包·待锚定</span>', '<span class="dpill ok">已锚定</span>']
function flowStepHTML(s, i) {
  const e = s.ev
  if (!e) return `<div class="chain-node ghost" style="width:150px">
    ${cube3d('gray', { ghost: true, sm: true, label: '待产生' })}
    <div class="blk-title">${s.no} ${esc(s.label)}</div><div class="blk-line">${esc(s.hint)}</div></div>`
  const st = Number(e.status)
  const tone = st === 2 ? 'green' : (st === 0 ? 'gray' : 'blue')
  return `<div class="chain-node" style="width:150px" id="fnode-${i}" tabindex="0" onclick="openFlowStep(${i})"
    onmouseenter="chainTip(event, 'f', ${i})" onmousemove="chainTipMove(event)" onmouseleave="chainTipHide()" onfocus="chainTip(event, 'f', ${i})" onblur="chainTipHide()">
    ${cube3d(tone, { sm: true })}
    <div class="blk-title">${s.no} ${esc(s.label)}</div>
    <div class="blk-line">${esc(String(e.created_at).slice(5, 16))}</div>
    <div class="blk-line">批 #${e.seq != null ? e.seq : '—'} · ${FLOW_ST[st] || ''}</div>
  </div>`
}
function renderFlow(d) {
  const o = d.order || {}
  const yuan = (n) => '¥' + (Number(n) / 100).toFixed(2).replace(/\.00$/, '')
  const doneN = (d.steps || []).filter((s) => s.ev).length
  window.__flowData = d; window.__flowShown = true
  const meta = document.getElementById('flowMeta')
  if (meta) meta.innerHTML = `${d.demo ? '<span class="chip demo">演示数据</span> ' : ''}${esc(o.orderNo || '')} · ${esc(o.productName || '—')} · ${yuan(o.amountPay || 0)}${o.beanDeducted ? '（豆抵' + o.beanDeducted + '）' : ''} · ${esc(o.statusText || '')} · <b style="color:#eaf1ff">${doneN}/6 锚点</b>`
  const parts = []
  ;(d.steps || []).forEach((s, i) => {
    if (i) parts.push('<div class="chain-link flow-link"><i style="top:59px"></i><s style="top:58px"></s><u style="top:49px">»</u></div>')
    parts.push(flowStepHTML(s, i))
  })
  ;(d.refunds || []).forEach((e, j) => {
    parts.push('<div class="chain-link elbow"><i style="top:59px;height:74px;border-top:2px dashed rgba(252,211,77,.5);border-right:2px dashed rgba(252,211,77,.5);border-top-right-radius:12px"></i><b style="top:132px;border-top-color:rgba(252,211,77,.5)"></b><u style="top:122px;color:#fcd34d">▸</u></div>')
    parts.push(`<div class="chain-node branch" id="fnode-r${j}" onclick="openFlowStep('r${j}')">
      ${cube3d('gold', { sm: true })}
      <div class="blk-title">退款冲正</div>
      <div class="blk-line">${esc(e.biz_ref)} · ${yuan(e.amount || 0)}</div>
      <div class="blk-line">${FLOW_ST[Number(e.status)] || ''}</div></div>`)
  })
  const track = document.getElementById('flowTrack')
  if (track) track.innerHTML = `<div class="chain-track flow">${parts.join('')}</div>`
}
async function loadFlow() {
  const no = (document.getElementById('flowNo')?.value || '').trim()
  if (!no) return toast('请输入订单号', true)
  try {
    renderFlow(await api('GET', '/admin/attest/flow/' + encodeURIComponent(no)))
  } catch (e) { toast(e.message, true) }
}
function loadFlowDemo() {
  const mk = (no, label, hint, seq, t, st) => ({ no, label, hint, ev: { biz_type: label, biz_ref: no, version_no: 1, status: st, payload_hash: 'f0' + String(seq).padStart(2, '0') + 'a1b2c3d4e5f60718', created_at: t, seq, merkle_root: '17d5a93e04fb8c629f4c1a2b7de50863' } })
  renderFlow({
    demo: true,
    order: { orderNo: 'WL20261101DEMO01', status: 50, statusText: '已完成', productName: '朱家角水乡沉浸一日（演示）', qty: 2, amountPay: 39800, beanDeducted: 200, createdAt: '2026-10-31 10:02:11', paidAt: '2026-10-31 10:03:05', completedAt: '2026-10-31 15:40:22' },
    steps: [
      mk('bt-DEMO1001', '旅豆抵扣', '下单锁豆', 12, '2026-10-31 10:02:30', 1),
      mk('WL20261101DEMO01', '支付成功', '订单事实入链', 12, '2026-10-31 10:03:05', 2),
      mk('pass-901', '出票', '权益凭证 ×2', 13, '2026-10-31 10:03:40', 2),
      mk('pass-901-1', '核销', '到店扫码', 13, '2026-10-31 11:25:02', 1),
      mk('bt-DEMO1002', '返豆', '消费奖励', 14, '2026-10-31 15:40:22', 1),
      mk('settle-31', '结算', '五口径分账', 20, '2026-11-03 01:00:10', 0),
    ],
    refunds: [],
  })
}
function openFlowStep(i) {
  const d = window.__flowData
  if (!d) return
  document.querySelectorAll('.chain-node.active').forEach((n) => n.classList.remove('active'))
  const el = document.getElementById('fnode-' + i)
  if (el) el.classList.add('active')
  const isRefund = String(i).startsWith('r')
  const s = isRefund ? null : (d.steps || [])[i]
  const e = isRefund ? (d.refunds || [])[Number(String(i).slice(1))] : s.ev
  if (!e) return
  const box = document.getElementById('blockDetail')
  const o = d.order || {}
  const BST = ['<span class="pill warn">待打包</span>', '<span class="pill s20">已打包·待锚定</span>', '<span class="pill ok">已锚定</span>']
  box.innerHTML = `
  <div class="card">
    <div class="card-head"><h3>${isRefund ? '退款冲正' : (s.no + ' ' + esc(s.label))} · 链上锚点${d.demo ? '（演示数据）' : ''}</h3>
      <span class="muted">${esc(o.orderNo || '')} · ${esc(o.statusText || '')}</span></div>
    <div class="row" style="gap:18px;flex-wrap:wrap;font-size:12.5px">
      <span>类型 <code>${esc(e.biz_type)}</code></span>
      <span>业务单号 <code>${esc(e.biz_ref)}</code></span>
      <span>版本 v${Number(e.version_no ?? 1)}</span>
      <span>${BST[Number(e.status)] || ''}</span>
      <span>所在批次 ${e.seq != null ? '#' + e.seq : '待打包'}</span>
      <span>Merkle 根 <code>${e.merkle_root ? esc(String(e.merkle_root).slice(0, 24)) + '…' : '—'}</code></span>
      <span>payload 指纹 <code>${esc(String(e.payload_hash).slice(0, 16))}…</code></span>
      <span>时间 ${esc(String(e.created_at).slice(0, 19))}</span>
    </div>
    <div class="row" style="margin-top:10px">
      ${!d.demo && e.biz_type === 'order' ? `<a class="btn ghost sm" target="_blank" rel="noopener" href="/verify?no=${encodeURIComponent(e.biz_ref)}">公开复核页 ↗</a>
        <a class="btn ghost sm" target="_blank" rel="noopener" href="/open/report/order/${encodeURIComponent(e.biz_ref)}">存证报告 PDF ↗</a>` : ''}
      <span class="muted">六步与业务同事务写入 · 小时级打包 · 上链只有哈希指纹+时间戳</span>
    </div>
  </div>`
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
}

async function pointassets() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  const d = await api('GET', '/admin/web3/point-assets')
  const BIZ = { 1: '消费返豆', 2: '任务奖励', 3: '内容奖励', 4: '抵扣', 5: '退款冲正', 6: '过期回收', 7: '风控调整' }
  const capPct = d.globalCap ? Math.min(100, Math.round(Number(d.globalCap.granted || 0) / Math.max(Number(d.globalCap.cap_total || d.globalCap.total || 1), 1) * 100)) : 0
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>积分发行台账</h2><span class="muted">旅豆 = 向往自由链积分资产（D6 外层口径）</span></div>
    <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr)">
      <div class="kpi"><div class="ico" style="background:#fdf3e0">👥</div><div><div class="l">持有人数</div><div class="v" style="font-size:18px">${d.holders}</div><div class="s">一户一账（bean_account）</div></div></div>
      <div class="kpi"><div class="ico" style="background:#e8effd">📦</div><div><div class="l">发行批次</div><div class="v" style="font-size:18px">${(d.budgets || []).length}</div><div class="s">按批次预算发行</div></div></div>
      <div class="kpi"><div class="ico" style="background:var(--brand-soft)">🛡</div><div><div class="l">年度总量哨兵</div><div class="v" style="font-size:18px">${d.globalCap ? (d.globalCap.cap_total || d.globalCap.total || '—') : '—'}</div><div class="s">严禁超发 · 双分录平衡</div></div></div>
    </div>
  </div>
  <div class="card">
    <div class="card-head"><h3>发行批次</h3></div>
    <table><thead><tr><th>批次</th><th>名称</th><th>额度</th><th>已发放</th><th>回流</th><th>状态</th></tr></thead><tbody>
    ${(d.budgets || []).map((b) => `<tr><td>#${b.id}</td><td>${esc(b.name || '—')}</td><td class="num">${Number(b.total)}</td>
      <td class="num">${Number(b.granted)}</td><td class="num">${Number(b.returned)}</td>
      <td>${b.status === 1 ? '<span class="pill ok">启用</span>' : '<span class="pill s70">停用</span>'}</td></tr>`).join('') || '<tr><td colspan="6" class="td-sub">暂无批次</td></tr>'}
    </tbody></table>
  </div>
  <div class="card">
    <div class="card-head"><h3>按科目流水汇总（发行/销毁）</h3></div>
    <table><thead><tr><th>科目</th><th>发行（贷）</th><th>消耗/回收（借）</th></tr></thead><tbody>
    ${(d.byBiz || []).map((x) => `<tr><td>${BIZ[x.biz_type] || ('类型' + x.biz_type)}</td><td class="num">${Number(x.issued)}</td><td class="num">${Number(x.burned)}</td></tr>`).join('')}
    </tbody></table>
  </div>`
}
const BADGE_CATS = [['level', '会员等级'], ['member', '会员荣誉'], ['city', '城市徽章'], ['country', '国家徽章'], ['trusted', '链上勋章'], ['journey', '旅程'], ['explore', '足迹'], ['creator', '创作'], ['special', '特别']]
const isMBadge = (b) => String(b.rule_type || '').startsWith('m_') || ['mlevel', 'mhonor'].includes(b.pf && b.pf.category) // 商户徽章
const BADGE_RAR = { common: '普通', rare: '稀有', epic: '史诗', legend: '传说' }
const BADGE_ICONS = ['compass', 'mountain', 'water', 'boat', 'ticket', 'pen', 'camera', 'star', 'flag', 'heart', 'pin', 'crown', 'footprint', 'lantern', 'globe', 'book', 'bridge', 'moongate', 'bamboo', 'pagoda', 'skyline', 'plane', 'seal', 'node', 'shieldcheck', 'store', 'trend', 'thumb', 'calendar', 'scan']
function badgeSwitch(c) { window.__badgeCat = c; badges() }
async function badges() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  const [d, lvs, mlvs] = await Promise.all([api('GET', '/admin/web3/badges'), api('GET', '/admin/member/levels').catch(() => []), api('GET', '/admin/merchant/levels').catch(() => [])])
  const cur = window.__badgeCat || 'all'
  const pfOf = (b) => (typeof b.profile === 'string' ? JSON.parse(b.profile || '{}') : b.profile) || {}
  const defs = (d.defs || []).map((b) => ({ ...b, pf: pfOf(b) }))
  const catOf = (b) => (b.pf.category === 'growth' ? 'level' : b.pf.category || 'special')
  const userDefs = defs.filter((b) => !isMBadge(b)), merchDefs = defs.filter(isMBadge)
  const cnt = (c) => userDefs.filter((b) => catOf(b) === c).length
  const shown = cur === 'all' ? defs : cur === 'merchant' ? merchDefs : userDefs.filter((b) => catOf(b) === cur)
  const tabs = [['all', '全部', defs.length], ...BADGE_CATS.map(([k, n]) => [k, n, cnt(k)]), ['merchant', '商户徽章', merchDefs.length]]
  const ruleName = { manual: '人工授予', order_count: '完成订单', city_count: '打卡城市数', review: '评价', note_count: '发布笔记', level: '会员等级', city_visit: '城市到访', country_visit: '国家到访', sealed_count: '封存订单', member_days: '注册天数' }
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>徽章管理</h2><span class="muted">全部徽章的定义、图形与发放 · 发放即写入存证队列（badge 事件）</span></div>
    <div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:8px">${tabs.map(([k, n, c]) => `<button class="btn ${cur === k ? 'primary' : 'ghost'} sm" onclick="badgeSwitch('${k}')">${n} ${c}</button>`).join('')}</div>
    <div class="row"><button class="btn primary sm" onclick="createBadge()">＋ 新建徽章</button><span class="muted">外观（类别 / 稀有度 / 图标 / 系列）与获得规则（类型 / 阈值 / 城市 / 国家 / 发行上限）；没上传徽章图时按「类别 + 稀有度 + 图标」自动生成</span></div>
    <table style="margin-top:10px"><thead><tr><th>ID</th><th>图形</th><th>名称</th><th>类别 · 系列</th><th>获得规则</th><th>已发放</th><th>操作</th></tr></thead><tbody>
    ${shown.map((b) => { const pf = b.pf; const cat = pf.category === 'growth' ? 'level' : pf.category || 'special'; return `<tr><td>#${b.id}${isMBadge(b) ? '<div class="td-sub">商户</div>' : ''}</td>
      <td><img src="${pf.icon_img ? esc(pf.icon_img) : '/badge-art/' + b.id + '.svg'}" width="52" height="52" alt=""></td>
      <td>${esc(b.name)}<div class="td-sub">${esc(BADGE_RAR[pf.rarity] || '普通')} · ${esc(b.icon_key)}</div></td>
      <td class="td-sub">${esc((BADGE_CATS.find((c) => c[0] === cat) || [0, { mlevel: '商户等级', mhonor: '经营荣誉' }[cat] || '特别'])[1])}${pf.series ? ' · ' + esc(pf.series) + (pf.tier ? ' 第' + Number(pf.tier) + '阶' : '') : ''}${pf.city_code ? ' · ' + esc(pf.city_code) : ''}${pf.country_code ? ' · ' + esc(pf.country_code) : ''}</td>
      <td class="td-sub">${esc(b.rule_desc || '—')}<div>${esc(ruleName[b.rule_type] || b.rule_type)}${pf.threshold ? ' ≥ ' + Number(pf.threshold) : ''}</div></td>
      <td class="num">${Number(b.granted)}<div class="td-sub">已锚定 ${Number(b.anchored || 0)}</div></td>
      <td><button class="btn ghost sm" onclick="entityEditor('badge', ${b.id}, { onSaved: () => badges() })">编辑</button> <button class="btn ghost sm" onclick="grantBadge(${b.id}, ${isMBadge(b) ? 1 : 0})">${isMBadge(b) ? '发放给商户' : '发放给用户'}</button>${b.rule_type && b.rule_type !== 'manual' ? ` <button class="btn ghost sm" onclick="backfillBadge(${b.id})">按规则补发</button>` : ''}</td></tr>` }).join('') || '<tr><td colspan="7" class="td-sub">这一类还没有徽章</td></tr>'}
    </tbody></table>
  </div>
  <div class="card">
    <div class="card-head"><h3>会员等级徽章</h3><span class="muted">等级名、门槛、返豆加成在「参数中心 → 会员等级体系」修改（双人复核），徽章图形随等级自动变化</span></div>
    <div class="row" style="gap:18px;flex-wrap:wrap">${(lvs || []).map((l) => `<div style="text-align:center;width:120px"><img src="/badge-art/level/${l.lv}.svg" width="96" height="96" alt=""><div><b>Lv${l.lv} ${esc(l.name)}</b></div><div class="td-sub">成长值 ${Math.floor(l.min / 100).toLocaleString()} 起</div><div class="td-sub">返豆 +${l.rebateBonusBp / 100} 个百分点</div></div>`).join('')}</div>
  </div>
  <div class="card">
    <div class="card-head"><h3>商户等级徽章</h3><span class="muted">等级名、订单 / 评价 / 评分 / 退款率门槛、权益说明在「参数中心 → 商户经营等级体系」修改（双人复核）；徽章图形随等级自动变化（门楼招牌，铜 / 翡翠 / 金 / 钻蓝）</span></div>
    <div class="row" style="gap:18px;flex-wrap:wrap">${(mlvs || []).map((l) => `<div style="text-align:center;width:150px"><img src="/badge-art/mlevel/${l.lv}.svg" width="112" height="112" alt=""><div><b>Lv${l.lv} ${esc(l.name)}</b></div><div class="td-sub">订单 ≥${l.minOrders} · 评价 ≥${l.minReviews}</div><div class="td-sub">${l.minRating ? '评分 ≥' + l.minRating / 10 : '不限评分'} · 退款率 ≤${l.maxRefundPct}%</div></div>`).join('')}</div>
  </div>
  <div class="card">
    <div class="card-head"><h3>设计预览 · 各类徽章 × 稀有度</h3><span class="muted">每一类有自己的造型与材质；链上勋章为深色玻璃质感，带虹彩边框与唯一指纹条</span></div>
    ${[['city', 'bridge', '城市徽章 · 朱红印章'], ['country', 'flag', '国家徽章 · 护照出入境章'], ['trusted', 'seal', '链上勋章 · 玻璃质感'], ['member', 'heart', '会员荣誉 · 月桂缎带'], ['mhonor', 'store', '商户荣誉 · 花结奖章'], ['journey', 'ticket', '旅程 · 盾牌'], ['explore', 'compass', '足迹 · 六边形'], ['creator', 'pen', '创作 · 花边圆章']].map(([c, ic, n]) => `<div class="row" style="gap:12px;align-items:center;margin-bottom:6px"><span class="muted" style="width:150px">${n}</span>${['common', 'rare', 'epic', 'legend'].map((r) => `<img src="/badge-art/preview.svg?category=${c}&rarity=${r}&icon_key=${ic}&country_code=CN&seed=${c}${r}" width="72" height="72" alt="" title="${BADGE_RAR[r]}">`).join('')}</div>`).join('')}
    <div class="card-head" style="margin-top:12px"><h3>图标库</h3><span class="muted">图标键写在图标下方，新建徽章时填入</span></div>
    <div class="row" style="gap:12px;flex-wrap:wrap">${BADGE_ICONS.map((k) => `<div style="text-align:center;width:68px"><img src="/badge-art/preview.svg?icon_key=${k}&rarity=rare&category=explore" width="56" height="56" alt="${k}"><div class="td-sub">${k}</div></div>`).join('')}</div>
  </div>
  <div class="card">
    <div class="card-head"><h3>最近发放</h3></div>
    <table><thead><tr><th>用户</th><th>徽章</th><th>时间</th></tr></thead><tbody>
    ${(d.recent || []).map((r) => `<tr><td>${esc(r.nickname || ('用户' + r.user_id))}</td><td>${esc(r.name)}</td><td class="td-sub">${esc(String(r.granted_at).slice(0, 19))}</td></tr>`).join('') || '<tr><td colspan="3" class="td-sub">暂无发放记录</td></tr>'}
    </tbody></table>
  </div>`
}
async function createBadge() { return entityEditor('badge', null, { onSaved: () => badges() }) }
async function backfillBadge(id) {
  if (!confirm('按当前规则与阈值，对所有已达标但尚未获得的用户补发此勋章？')) return
  try { const r = await api('POST', '/admin/web3/badges/' + id + '/backfill', {}); toast(`达标 ${r.eligible} 人，本次发放 ${r.granted} 枚${r.capped ? '（已达发行上限，部分未发）' : ''}`); badges() }
  catch (e) { toast(e.message, true) }
}
async function grantBadge(id, isMerchant) {
  const userId = prompt(isMerchant ? '发放给商户 ID：' : '发放给用户 ID：')
  if (!userId) return
  const reason = prompt('授予原因（可选）：') || ''
  try {
    const r = await api('POST', '/admin/web3/badges/' + id + '/grant', isMerchant ? { merchantId: Number(userId), reason } : { userId: Number(userId), reason })
    toast('已发放「' + r.badge + '」并入存证队列'); badges()
  } catch (e) { toast(e.message, true) }
}
async function wallets() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  const kw = (document.getElementById('wkw') && document.getElementById('wkw').value.trim()) || ''
  const d = await api('GET', '/admin/web3/wallets' + (kw ? '?kw=' + encodeURIComponent(kw) : ''))
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>权益账户</h2>
      <div class="row" style="margin:0"><input id="wkw" placeholder="昵称 / 用户ID" style="width:180px" value="${esc(kw)}">
      <button class="btn ghost sm" onclick="wallets()">查询</button></div></div>
    <table><thead><tr><th>用户</th><th>积分余额</th><th>等级</th><th>成长值</th><th>勋章</th><th>存证事件</th><th></th></tr></thead><tbody>
    ${d.map((w) => `<tr><td>${esc(w.nickname || '用户' + w.user_id)}</td><td class="num"><b>${Number(w.balance)}</b></td>
      <td><span class="pill off">Lv${w.member_level}</span></td><td class="num">${Number(w.growth_value)}</td>
      <td class="num">${Number(w.badges)}</td><td class="num">${Number(w.attest_n)}</td>
      <td><button class="btn ghost sm" onclick="walletDetail(${w.user_id})">账户明细 ›</button></td></tr>`).join('') || '<tr><td colspan="7" class="td-sub">暂无账户</td></tr>'}
    </tbody></table>
  </div>
  <div id="wdetail"></div>`
}
async function walletDetail(uid) {
  const d = await api('GET', '/admin/web3/wallets/' + uid)
  $('#wdetail').innerHTML = `
  <div class="card">
    <div class="card-head"><h3>${esc(d.profile.nickname || '用户' + uid)} · 权益账户明细</h3><span class="muted">余额 ${Number(d.balance)} · Lv${d.profile.member_level} · 成长值 ${Number(d.profile.growth_value)}</span></div>
    <div class="row" style="gap:8px">${(d.badges || []).map((b) => `<span class="pill ok">🏅 ${esc(b.name)}</span>`).join('') || '<span class="muted">暂无勋章</span>'}</div>
    <table style="margin-top:10px"><thead><tr><th>流水</th><th>方向</th><th>科目</th><th>数量</th><th>关联单号</th><th>时间</th></tr></thead><tbody>
    ${(d.ledger || []).slice(0, 12).map((l) => `<tr><td class="td-sub">${esc(String(l.tx_no).slice(0, 20))}…</td>
      <td>${l.direction === 1 ? '<span class="pill ok">+ 发行</span>' : '<span class="pill s20">- 消耗</span>'}</td>
      <td>${l.biz_type}</td><td class="num">${Number(l.amount)}</td><td class="td-sub">${esc(l.biz_ref || '—')}</td>
      <td class="td-sub">${esc(String(l.created_at).slice(5, 19))}</td></tr>`).join('') || '<tr><td colspan="6" class="td-sub">暂无流水</td></tr>'}
    </tbody></table>
    <div class="card-head" style="margin-top:12px"><h3>存证流水</h3></div>
    <table><thead><tr><th>订单号</th><th>载荷哈希</th><th>状态</th><th>时间</th></tr></thead><tbody>
    ${(d.attestations || []).map((a) => `<tr><td class="num">${esc(a.orderNo)}</td><td><code>${esc(String(a.hash).slice(0, 20))}…</code></td>
      <td>${a.anchored ? '<span class="pill ok">已锚定</span>' : '<span class="pill warn">待打包</span>'}</td><td class="td-sub">${esc(String(a.at).slice(5, 19))}</td></tr>`).join('') || '<tr><td colspan="4" class="td-sub">暂无存证流水</td></tr>'}
    </tbody></table>
    <div class="muted" style="margin-top:8px">${esc(d.statement)}</div>
  </div>`
}
