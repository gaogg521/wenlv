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
      ${(d.queue || []).map((qq) => `<div class="kpi att-kpi"><div class="ico" style="background:var(--brand-soft)">⛓</div>
        <div style="flex:1;min-width:0"><div class="l">${BIZ_CN[qq.biz_type] || esc(qq.biz_type)}</div><div class="v" style="font-size:18px">${Number(qq.total)} <small style="font-size:12px;font-weight:400;color:var(--sub)">条事件</small></div>
        <div class="att-bar" title="已锚定占累计"><i style="width:${Number(qq.total) ? Math.round(Number(qq.anchored) / Number(qq.total) * 100) : 0}%"></i></div>
        <div class="s att-st"><span class="${Number(qq.pending) ? 'warn' : ''}">待打包 ${Number(qq.pending)}</span><span>已打包 ${Number(qq.packed || 0)}</span><span class="ok">已锚定 ${Number(qq.anchored)}</span></div></div></div>`).join('') || '<div class="kpi"><div class="s">暂无事件</div></div>'}
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
      ${d.batches.map((b) => `<tr class="click-row" ${dxKey} title="点开看这一批的事件，并逐条验证" onclick="openBlock(${Number(b.id)})"><td class="num">#${b.seq}${Number(b.is_day_close) ? ' <span class="pill off">账本日终</span>' : ''}</td>
        <td>${esc(String(b.biz_date).slice(0, 10))}</td>
        <td>${hashCopy(b.merkle_root, String(b.merkle_root).slice(0, 20) + '…')}</td>
        <td class="td-sub">${b.prev_root ? hashCopy(b.prev_root, String(b.prev_root).slice(0, 12) + '…') : '链起点'}</td>
        <td class="num">${Number(b.leaf_count)}</td>
        <td class="td-sub">${Number(b.attempt) || 0}${b.last_err ? '<br><span class="pill s70">' + esc(String(b.last_err).slice(0, 24)) + '</span>' : ''}</td>
        <td class="td-sub">${b.chain_tx_ref ? hashCopy(b.chain_tx_ref, String(b.chain_tx_ref).slice(0, 16) + '…') : '—'}</td>
        <td>${STMAP[b.status] || ''}</td></tr>`).join('')}</tbody></table>` : emptyBox('尚无批次：点上方「① 打包」即可出根')}
  </div>
  <div id="blockDetail"></div>
  <div class="card">
    <div class="card-head"><h3>旅豆账本日终封存</h3><span class="muted">借贷恒等（Σ借=Σ贷）才允许封存 —— 「严禁超发」的唯一外部证明</span></div>
    ${(d.dayRoots || []).length ? `<table><thead><tr><th>业务日</th><th>叶数</th><th>贷方分录合计</th><th>借方分录合计</th><th>恒等</th><th>Merkle 根</th><th>对外</th></tr></thead><tbody>
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
    ${(d.recent || []).map((e) => `<tr><td>${bizTag(esc(e.biz_type))}</td><td class="num">${evRefLink(e)}</td>
      <td class="num">v${Number(e.version_no ?? 1)}</td>
      <td>${STMAP[e.status]}</td><td class="td-sub">${e.seq ? batchLink(e.batch_id, '#' + e.seq) : '—'}</td>
      <td class="td-sub">${e.merkle_root ? hashCopy(e.merkle_root, String(e.merkle_root).slice(0, 16) + '…') : '—'}</td>
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
  const idn = await api('GET', '/admin/web3/identities?size=12&page=1')
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>数字身份 · 可携出旅行凭证</h2><span class="muted">${esc(d.policy)}</span></div>
    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
      <div class="kpi"><div class="ico" style="background:var(--brand-soft)">🪪</div><div><div class="l">已签发</div><div class="v" style="font-size:18px">${d.total}</div><div class="s">已领取 ${d.holders} 位 · 可签发 ${d.eligible ?? '—'} 位用户</div></div></div>
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
    <div class="card-head"><h3>身份档案 · 数字身份 ↔ 旅豆账户</h3><span class="muted">一人一个数字身份（DID），与其旅豆账户、徽章、行程按用户 id 一一关联；点数字可看明细</span></div>
    <div class="row" style="margin-bottom:10px"><input id="idq" placeholder="昵称 / 用户 id / DID" style="width:260px" onkeydown="if(event.key==='Enter')vcIdentityList(1)">
      <button class="btn primary sm" onclick="vcIdentityList(1)">查询</button></div>
    <div id="idList">${idListHtml(idn)}</div>
  </div>

  <div class="card">
    <div class="card-head"><h3>凭证长什么样</h3><span class="muted">用户拿到的是一张只含旅行事实的身份卡。下方是示例（非真实用户）；在「最近签发」里点「卡片」可看真实凭证</span></div>
    <div id="vcCardBox">${vcCardSvg(VC_SAMPLE, { sample: true, uid: 0 })}</div>
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
        <td><button class="btn ghost sm" onclick="showVcCard(${v.id})">卡片</button> <button class="btn ghost sm" onclick="vcIdentity(${v.user_id})">档案</button> ${v.revoked_at ? '' : `<button class="btn ghost sm" onclick="revokeVc(${v.id})">吊销</button>`}</td></tr>`).join('')}
    </tbody></table>` : emptyBox('尚未签发过凭证：上方选一个用户签发即可')}
  </div>`
  window.__vcLast = ''
  window.__vcRecent = d.recent || []
}

const VC_SAMPLE = { level: '探索者', levelNo: 3, growthBand: '1000–2999', memberSince: '2026-03', scope: 'travel', trips: 12, cities: 5, badges: ['初访古镇', '山海行者', '夜游达人'] }

/** 数字身份卡（SVG）：只画凭证里的旅行事实（等级 / 入会 / 行程 / 城市 / 徽章），不含姓名手机号身份证订单号金额。
 *  meta.uid 给了就可点：等级 / 行程 / 城市 / 徽章 都能点开看明细（uid=0 是示例卡，点了只提示） */
function vcCardSvg(claims, meta = {}) {
  let c = claims
  if (typeof c === 'string') { try { c = JSON.parse(c) } catch { c = {} } }
  c = c || {}
  const travel = c.scope === 'travel'
  const status = meta.status || (meta.sample ? '示例' : '')
  const hit = (k, x, y, w, h, inner) => {
    if (meta.uid == null) return inner
    const u = Number(meta.uid) || 0
    return `<g class="vc-hit" role="button" tabindex="0" aria-label="查看${k}明细" onclick="vcStatOpen(${u},'${k}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();vcStatOpen(${u},'${k}')}"><rect class="hitbg" x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="transparent"/>${inner}</g>`
  }
  let x = 28, y = 214, chips = ''
  const names = (c.badges || []).slice(0, 8)
  for (const b of names) {
    const w = String(b).length * 13 + 22
    if (x + w > 492) { x = 28; y += 30 }
    chips += `<rect x="${x}" y="${y - 16}" width="${w}" height="23" rx="11.5" fill="rgba(245,210,122,.16)" stroke="rgba(245,210,122,.55)"/><text x="${x + w / 2}" y="${y}" text-anchor="middle" font-size="12" fill="#f5d27a">${esc(b)}</text>`
    x += w + 8
  }
  const badgeBottom = y + 10
  const stat = (k, lx, label, val) => hit(k, lx - 8, 122, 118, 62, `<text x="${lx}" y="150" font-size="26" font-weight="700" fill="#fff">${esc(val)}</text><text x="${lx}" y="172" font-size="12" fill="rgba(255,255,255,.62)">${esc(label)} ›</text>`)
  const h = Math.max(300, y + 62)
  return `<svg viewBox="0 0 520 ${h}" style="width:100%;max-width:520px;height:auto;border-radius:14px;box-shadow:0 8px 24px rgba(15,42,74,.25)" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="数字身份卡">
    <defs><linearGradient id="vcg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f2a4a"/><stop offset="1" stop-color="#0e6b5c"/></linearGradient></defs>
    <rect width="520" height="${h}" rx="14" fill="url(#vcg)"/>
    <text x="28" y="40" font-size="13" fill="rgba(255,255,255,.7)" letter-spacing="2">向往的自由 · 旅行身份凭证</text>
    ${hit('level', 20, 52, 300, 70, `<text x="28" y="88" font-size="34" font-weight="700" fill="#fff">${esc(c.level || '—')}</text>
      <text x="28" y="112" font-size="12" fill="rgba(255,255,255,.62)">成长区间 ${esc(c.growthBand || '—')} · 入会 ${esc(c.memberSince || '—')} ›</text>`)}
    ${hit('level', 396, 14, 108, 100, `<circle cx="452" cy="64" r="46" fill="none" stroke="rgba(245,210,122,.35)" stroke-width="2"/><circle cx="452" cy="64" r="34" fill="none" stroke="rgba(245,210,122,.2)" stroke-width="1"/>
      <text x="452" y="70" text-anchor="middle" font-size="18" font-weight="700" fill="#f5d27a">Lv.${esc(c.levelNo ?? '-')}</text>`)}
    ${travel ? stat('trips', 28, '完成行程', c.trips ?? 0) + stat('cities', 150, '到访城市', c.cities ?? 0) + stat('badges', 272, '荣誉徽章', (c.badges || []).length) : '<text x="28" y="150" font-size="13" fill="rgba(255,255,255,.62)">基础凭证：仅含等级与入会时间</text>'}
    ${names.length ? hit('badges', 20, 190, 480, badgeBottom - 190, chips) : ''}
    <line x1="28" y1="${h - 46}" x2="492" y2="${h - 46}" stroke="rgba(255,255,255,.18)"/>
    <text x="28" y="${h - 26}" font-size="11" fill="rgba(255,255,255,.6)">${meta.did ? 'DID ' + esc(String(meta.did).slice(0, 26)) + '…' : '最小披露：不含姓名 / 手机号 / 身份证 / 订单号 / 金额'}${meta.exp ? ' · 有效期至 ' + esc(String(meta.exp).slice(0, 10)) : ''}</text>
    ${status ? `<text x="492" y="${h - 26}" text-anchor="end" font-size="12" font-weight="700" fill="#7ce0b5">${esc(status)}</text>` : ''}
  </svg>`
}

/** 点卡片上的数字：真实用户 → 打开身份档案并定位到对应一节；示例卡 → 只提示 */
function vcStatOpen(uid, k) {
  if (!uid) return toast('这是示例卡片：真实用户的卡片上，等级 / 行程 / 城市 / 徽章都能点开看明细', false)
  vcIdentity(uid, k)
}

function showVcCard(id) {
  const v = (window.__vcRecent || []).find((x) => Number(x.id) === Number(id))
  const box = document.getElementById('vcCardBox')
  if (!v || !box) return
  const status = v.revoked_at ? '已吊销' : (new Date(v.expires_at) > new Date() ? '有效' : '已过期')
  box.innerHTML = `<div class="muted" style="margin-bottom:8px">凭证 #${esc(v.id)} · ${esc(v.nickname || '用户' + v.user_id)} · 点卡片上的数字看明细</div>${vcCardSvg(v.claims, { did: v.did, exp: v.expires_at, status, uid: v.user_id })}`
  box.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/* ---- 身份档案列表：数字身份(DID) ↔ 旅豆账户 ↔ 徽章 / 行程 / 凭证，同一行 ---- */
const fmtN = (n) => Number(n || 0).toLocaleString()
function idListHtml(r) {
  const pages = Math.max(1, Math.ceil(r.total / r.size))
  const lvTag = (x) => `<span class="pill off">Lv.${x.levelNo} ${esc(x.levelName)}</span>`
  return `<div class="muted" style="margin-bottom:8px">用户 <b>${r.summary.users}</b> · 旅豆账户 <b>${r.summary.beanAccounts}</b>（尚未产生旅豆的用户没有账户） · 持有效凭证 <b>${r.summary.vcHolders}</b> 位</div>
  ${r.rows.length ? `<table><thead><tr><th>用户</th><th>数字身份 DID</th><th>等级</th><th>旅豆账户（余额 / 累计）</th><th>徽章</th><th>行程</th><th>凭证</th><th>操作</th></tr></thead><tbody>
    ${r.rows.map((x) => `<tr>
      <td class="td-main">${esc(x.nickname)}<div class="td-sub">#${x.userId}${x.status === 1 ? '' : ' · 非正常'}</div></td>
      <td class="td-sub">${hashCopy(x.did, String(x.did).slice(0, 20) + '…')}</td>
      <td>${lvTag(x)}</td>
      <td>${x.beanBalance == null ? '<span class="muted">未开户</span>' : `<button class="ref-link" type="button" title="看旅豆流水" onclick="vcIdentity(${x.userId},'bean')"><b>${fmtN(x.beanBalance)}</b> / ${fmtN(x.beanLifetime)} 豆</button>`}</td>
      <td><button class="ref-link" type="button" onclick="vcIdentity(${x.userId},'badges')">${x.badges}</button></td>
      <td><button class="ref-link" type="button" onclick="vcIdentity(${x.userId},'trips')">${x.trips}</button></td>
      <td>${x.vcActive ? `<span class="pill ok">有效 ${x.vcActive}</span>` : '<span class="pill off">未签发</span>'}</td>
      <td><button class="btn ghost sm" onclick="vcIdentity(${x.userId})">档案</button> <button class="btn ghost sm" onclick="vcIssueFor(${x.userId})">签发</button></td></tr>`).join('')}
  </tbody></table>
  <div class="row" style="margin-top:10px;justify-content:flex-end;gap:8px"><span class="muted">第 ${r.page} / ${pages} 页 · 共 ${r.total} 人</span>
    <button class="btn ghost sm" ${r.page <= 1 ? 'disabled' : ''} onclick="vcIdentityList(${r.page - 1})">上一页</button>
    <button class="btn ghost sm" ${r.page >= pages ? 'disabled' : ''} onclick="vcIdentityList(${r.page + 1})">下一页</button></div>` : emptyBox('没有匹配的用户')}`
}
async function vcIdentityList(page) {
  const kw = (document.getElementById('idq') || {}).value || ''
  const box = document.getElementById('idList'); if (!box) return
  try {
    const r = await api('GET', '/admin/web3/identities?size=12&page=' + (page || 1) + '&q=' + encodeURIComponent(kw.trim()))
    window.__idPage = r.page
    box.innerHTML = idListHtml(r)
  } catch (e) { toast(e.message, true) }
}
async function vcIssueFor(uid) {
  const el = document.getElementById('vcUid'); if (el) el.value = uid
  const box = document.getElementById('vcOut')
  if (el && box) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  await issueVc()
}

/** 身份档案抽屉：卡片（数字可点）+ 等级 / 行程 / 城市 / 徽章 / 旅豆账户与流水 / 凭证记录 */
async function vcIdentity(uid, sec) {
  drawer('身份档案', skel(4))
  let d
  try { d = await api('GET', '/admin/web3/identity/' + uid) } catch (e) { closeModal(); return toast(e.message, true) }
  const cityName = (code) => (typeof CITY_CN !== 'undefined' && CITY_CN[code]) || ('城市 ' + code)
  const T = (x) => esc(String(x || '').slice(0, 16).replace('T', ' '))
  const lastVc = d.vcs[0]
  const st = !lastVc ? '' : lastVc.revoked_at ? '已吊销' : (new Date(lastVc.expires_at) > new Date() ? '有效' : '已过期')
  const BEAN_BIZ = { 1: '消费返豆', 2: '任务奖励', 3: '内容奖励', 4: '下单抵扣', 5: '退款冲正', 6: '过期', 7: '风控回收', 8: '期初余额导入' }
  const L = d.level
  const section = (k, title, count, body) => `<section class="vc-sec" id="vcsec-${k}"><h4>${title}${count == null ? '' : ` <b>${count}</b>`}</h4>${body}</section>`
  const none = (t) => `<div class="muted" style="padding:6px 0">${t}</div>`
  drawer(esc(d.nickname) + ' · 身份档案', `
    <div class="muted" style="margin-bottom:8px">用户 #${d.userId} · DID <code>${esc(String(d.did).slice(0, 24))}…</code> <button class="copy-chip" type="button" onclick="copyText(${w3Arg(d.did)})">复制</button></div>
    ${vcCardSvg(d.claims, { uid: d.userId, did: d.did, exp: lastVc && lastVc.expires_at, status: st || '未签发' })}
    <div class="muted" style="margin:6px 0 12px">点卡片上的等级 / 行程 / 城市 / 徽章，直接跳到对应明细。下面是后台可见的完整档案；凭证本身只含最小披露字段。</div>
    <div class="vc-secs">
      ${section('level', '等级与成长', null, `<div class="vc-kv"><span>当前等级</span><b>Lv.${L.no} ${esc(L.name)}</b><span>成长值</span><b>${fmtN(L.growth)}</b>
        <span>等级区间</span><b>${fmtN(L.from)}${L.to == null ? ' 以上' : ' – ' + fmtN(L.to)}</b><span>下一级</span><b>${L.nextName ? esc(L.nextName) + '（还差 ' + fmtN(Math.max(0, L.to - L.growth)) + '）' : '已是最高级'}</b>
        <span>入会时间</span><b>${T(d.memberSince)}</b></div>`)}
      ${section('trips', '完成行程', d.claims.trips, d.trips.length ? `<table><thead><tr><th>订单号</th><th>线路</th><th>城市</th><th>完成</th></tr></thead><tbody>${d.trips.map((t) => `<tr><td class="td-sub">${hashCopy(t.order_no, t.order_no)}</td><td class="td-main">${esc(t.title)}</td><td class="td-sub">${esc(cityName(t.city_code))}</td><td class="td-sub">${T(t.at)}</td></tr>`).join('')}</tbody></table>` : none('还没有已核销 / 已完成的行程'))}
      ${section('cities', '到访城市', d.claims.cities, d.cities.length ? `<div class="vc-chips">${d.cities.map((c) => `<span class="pill ok">${esc(cityName(c.city_code))} × ${c.n}</span>`).join('')}</div>` : none('还没有到访城市'))}
      ${section('badges', '荣誉徽章', d.badges.length, d.badges.length ? `<table><thead><tr><th>徽章</th><th>获得条件</th><th>获得时间</th><th>来源</th></tr></thead><tbody>${d.badges.map((b) => `<tr><td class="td-main">${esc(b.name)}</td><td class="td-sub">${esc(b.rule_desc || '—')}</td><td class="td-sub">${T(b.granted_at)}</td><td class="td-sub mono">${esc(b.ref || '—')}</td></tr>`).join('')}</tbody></table>` : none('还没有徽章'))}
      ${section('bean', '旅豆账户', null, d.bean ? `<div class="vc-kv"><span>当前余额</span><b>${fmtN(d.bean.balance)} 豆</b><span>累计获得</span><b>${fmtN(d.bean.lifetime)} 豆</b></div>
        ${d.bean.ledger.length ? `<table style="margin-top:8px"><thead><tr><th>时间</th><th>类型</th><th>变动</th><th>余额</th><th>引用</th></tr></thead><tbody>${d.bean.ledger.map((l) => `<tr><td class="td-sub">${T(l.created_at)}</td><td>${esc(BEAN_BIZ[l.biz_type] || '其他')}</td><td class="num" style="color:${Number(l.direction) === 1 ? '#17824d' : '#b42318'}">${Number(l.direction) === 1 ? '+' : '−'}${fmtN(l.amount)}</td><td class="num">${fmtN(l.after_bal)}</td><td class="td-sub mono">${esc(l.biz_ref || '—')}</td></tr>`).join('')}</tbody></table>` : ''}
        <div style="margin-top:8px"><button class="btn ghost sm" onclick="closeModal();go('pointassets')">去旅豆发行台账</button></div>` : none('该用户还没有旅豆账户（还没产生过旅豆）'))}
      ${section('vcs', '凭证记录', d.vcs.length, `${d.vcs.length ? `<table><thead><tr><th>#</th><th>范围</th><th>签发</th><th>到期</th><th>状态</th></tr></thead><tbody>${d.vcs.map((v) => `<tr><td class="num">${v.id}</td><td><span class="pill off">${esc(v.scope)}</span></td><td class="td-sub">${T(v.issued_at)}</td><td class="td-sub">${T(v.expires_at)}</td><td>${v.revoked_at ? '<span class="pill s70">已吊销</span>' : (new Date(v.expires_at) > new Date() ? '<span class="pill ok">有效</span>' : '<span class="pill off">已过期</span>')}</td></tr>`).join('')}</tbody></table>` : none('还没有签发过凭证')}
        <div style="margin-top:8px"><button class="btn primary sm" onclick="closeModal();vcIssueFor(${d.userId})">签发一张新凭证</button></div>`)}
    </div>`)
  if (sec) setTimeout(() => { const el = document.getElementById('vcsec-' + sec); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'start' }); el.classList.add('vc-sec-hit') } }, 80)
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
        <div style="margin-top:10px">${vcCardSvg(r.claims, { did: r.did, exp: r.expiresAt, status: '有效', uid: userId })}</div>
        <textarea readonly style="width:100%;height:88px;margin-top:10px;font-family:monospace;font-size:11px">${esc(r.jwt)}</textarea>
        <div class="row" style="margin-top:8px"><button class="btn ghost sm" onclick="copyVc()">复制凭证</button>
          <button class="btn primary sm" onclick="openVerifyVc()">去验签</button></div>
      </div>
`
    toast('已签发')
    if (document.getElementById('idList')) vcIdentityList(window.__idPage || 1)   // 档案列表里的凭证状态同步刷新
  } catch (e) { toast(e.message, true) }
}

function copyVc() {
  const t = window.__vcLast || ''
  if (!t) return toast('还没有凭证', true)
  navigator.clipboard?.writeText(t).then(() => toast('已复制')).catch(() => toast('复制失败，请手动选择', true))
}

/** 复制任意文本（哈希太长，靠手选容易漏字符；证据类数字必须能整串带走） */
function copyText(t) {
  const s = String(t || '')
  if (!s) return toast('没有可复制的内容', true)
  navigator.clipboard?.writeText(s).then(() => toast('已复制 ' + (s.length > 16 ? s.slice(0, 10) + '…' : s))).catch(() => toast('复制失败，请手动选择', true))
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
    <div class="muted" style="margin-top:10px">切换链：改环境变量 <code>CHAIN_PROVIDER=chaingen|tbaas|antchain|antchainopen|antchaincontract|evm|noop</code> 后重启，业务与页面零改动。当前缺：${(cur.missing || []).length ? '<b>' + esc(cur.missing.join('、')) + '</b>' : '无'}。</div>
  </div>

  <div class="card">
    <div class="card-head"><h3>多链能力矩阵</h3><span class="muted">不同链能做不同的事：联盟链只存证，公链才发资产</span></div>
    <table><thead><tr><th>链</th><th>存证锚定</th><th>按根反查</th><th>资产发行</th><th>DID</th><th>状态</th><th>说明</th></tr></thead><tbody>
    ${(d.providers || []).map((p) => `<tr>
      <td class="td-main"><button class="ref-link" type="button" title="去链接入中心配置这条链" onclick="go('chainhub')">${esc(p.label)}</button>${p.current ? ' <span class="pill ok">当前</span>' : ''}</td>
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
      <td class="td-main"><button class="ref-link" type="button" title="去链接入中心补凭据 / 做连通性探测" onclick="go('chainhub')">${esc(p.label)}</button>${p.active ? ' <span class="pill ok">当前</span>' : ''}</td>
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
        <td class="td-sub mono">${r.tx_ref ? hashCopy(r.tx_ref, String(r.tx_ref).slice(0, 14) + '…') : '—'}</td>
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
  const TYPES = ['order', 'pass_issue', 'bean_grant', 'pass_verify', 'refund', 'settlement', 'bean_deduct']
  const mk = (seq, kind, status, date, leaves) => ({ id: 900 + seq, seq, biz_date: date,
    merkle_root: root(seq - 1), prev_root: seq === 1 ? null : root(seq - 2), leaf_count: leaves,
    is_day_close: kind === 'day' ? 1 : 0, status, attempt: 0,
    // 演示区块的业务构成：与 mockBlockEvents 同一套取法（按叶序轮转业务类型）
    mix: kind === 'day' ? { bean_ledger: leaves } : Array.from({ length: leaves }, (_, i) => TYPES[(seq + i) % TYPES.length]).reduce((m, t) => { m[t] = (m[t] || 0) + 1; return m }, {}),
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
  // 退出演示时，演示单（落在模拟链区块上）也一起收掉：真链上没有这些区块
  if (!window.__demoChain && window.__flowData && window.__flowData.demo) { window.__flowData = null; window.__flowShown = false; window.__openFlowStep = undefined }
  web3dash()
}
/** 区块上的业务环节标签：把批内事件按业务类型归类，最多画 3 个，其余折成 +N（完整构成在悬停卡 / 批内事件表） */
const BLK_SHORT = { order: '订单', pass_issue: '出票', pass_verify: '核销', bean_grant: '返豆', bean_deduct: '抵扣',
  refund: '退款', settlement: '结算', badge: '勋章', vc_issue: '身份凭证', vc_revoke: '凭证吊销', asset_issue: '资产' }
const FLOW_ORDER = ['bean_deduct', 'order', 'pass_issue', 'pass_verify', 'bean_grant', 'settlement', 'refund']
function blockMixHTML(b, max = 3) {
  if (Number(b.is_day_close) === 1) return '<div class="blk-mix"><span class="mx day">旅豆账本封存</span></div>'
  // 业务主线（抵扣→订单→出票→核销→返豆→结算→退款）优先、按流程顺序；勋章/准入/审核这类旁路事件数量再多也排在后面
  const rank = (k) => { const i = FLOW_ORDER.indexOf(k); return i < 0 ? 99 : i }
  const ents = Object.entries(b.mix || {}).sort((a, c) => rank(a[0]) - rank(c[0]) || c[1] - a[1])
  if (!ents.length) return '<div class="blk-mix"></div>'
  const shown = ents.slice(0, max)
  const rest = ents.slice(max).reduce((s, [, n]) => s + n, 0)
  return `<div class="blk-mix">${shown.map(([k, n]) => `<span class="mx" title="${esc(BIZ_CN[k] || k)}">${esc(BLK_SHORT[k] || BIZ_CN[k] || k)} <b>${Number(n)}</b></span>`).join('')}${rest ? `<span class="mx more" title="其他业务类型 ${rest} 条">+${rest}</span>` : ''}</div>`
}
function blockNodeHTML(b) {
  const dayClose = Number(b.is_day_close) === 1
  const st = Number(b.status)
  const root8 = String(b.merkle_root).slice(0, 8)
  const tone = st === 0 ? 'gray' : st === 3 ? 'red' : (dayClose ? 'gold' : (st === 2 ? 'green' : 'blue'))
  const cls = 'chain-node' + (dayClose ? ' branch' : '') + (st === 2 ? ' anchored' : '')
  // role=button + 键盘可达：只靠鼠标的人能点，只用键盘的人也得能开（无障碍不是装饰）
  return `<div class="${cls}" id="bnode-${b.id}" role="button" tabindex="0"
    aria-label="区块 ${Number(b.seq)}${dayClose ? ' 账本日终' : ''}，业务日 ${esc(String(b.biz_date).slice(0, 10))}，${Number(b.leaf_count)} 条事件，点击查看批内事件"
    onclick="openBlock(${b.id})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openBlock(${b.id})}"
    onmouseenter="chainTip(event, 'b', ${b.id})" onmousemove="chainTipMove(event)" onmouseleave="chainTipHide()" onfocus="chainTip(event, 'b', ${b.id})" onblur="chainTipHide()">
    ${cube3d(tone, { pulse: st === 5 })}
    <div class="blk-title">${dayClose ? '账本日终' : '区块'} #${b.seq}${b.prev_root ? '' : ' <span class="dpill genesis">创世</span>'}</div>
    <div class="blk-line">业务日 ${esc(String(b.biz_date).slice(0, 10))}</div>
    <div class="blk-line">事件 <b>${Number(b.leaf_count)}</b> 条 · ${dayClose ? '账本封存' : '业务存证'}</div>
    ${blockMixHTML(b, window.__chainDense ? 2 : 3)}
    <div class="blk-line">根 <code class="dk">${root8}…</code></div>
    <div class="blk-line">${BLOCK_ST[st] || ''} <span class="node-open">查看批内事件 ›</span></div>
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
  const mix = b.mix || tipCache[b.id]   // 接口已随批次带回业务构成；没有（旧接口）才按需拉取
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
  if (kind === 'b' && tipCache[id] === undefined && !((window.__chainMap || {})[id] || {}).mix) {
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
/**
 * 上链流水线：把"一个批次"从业务事件到链上确认的 5 段真实路径铺开。
 * 段位与状态严格按库里的 status 走（0 待打包 / 1 已打包待锚定 / 5 已提交待确认 / 2 已锚定 / 3·4 异常），
 * 不按"看起来差不多"画 —— 缺哪段就显示缺哪段。
 */
const PIPE_STEP = (done, label, sub, bad) => `<span class="pipe-step ${bad ? 'bad' : done ? 'done' : 'todo'}">
  <i>${bad ? '!' : done ? '✓' : '·'}</i><b>${label}</b>${sub ? `<em>${sub}</em>` : ''}</span>`
function pipelineHtml(batches, queue, demo) {
  const pending = (queue || []).reduce((s, r) => s + Number(r.pending || 0), 0)
  const rows = (batches || []).slice(0, 8).map((b) => {
    const st = Number(b.status)
    const hasRoot = st >= 1
    const hasTx = !!b.chain_tx_ref
    const hasBlock = !!b.chain_block
    const ok = st === 2
    const bad = st === 3 || st === 4
    const prevTxt = b.prev_root ? `prev → ${String(b.prev_root).slice(0, 8)}…` : '创世（无前根）'
    return `<div class="pipe-row${ok ? ' ok' : ''}">
      <div class="pipe-id"><b>#${Number(b.seq)}</b><span>${esc(String(b.biz_date || '').slice(0, 10))}</span></div>
      <div class="pipe-steps">
        ${PIPE_STEP(true, `${Number(b.leaf_count)} 条事件入队`, '业务事实已在库')}
        ${PIPE_STEP(hasRoot, '本地打包出根', hasRoot ? esc(String(b.merkle_root).slice(0, 10)) + '…' : '未打包')}
        ${PIPE_STEP(hasTx, '提交交易', hasTx ? esc(String(b.chain_tx_ref).slice(0, 10)) + '…' : '未提交')}
        ${PIPE_STEP(hasBlock, '链上出块', hasBlock ? '块 ' + esc(b.chain_block) : '等待出块')}
        ${PIPE_STEP(ok, ok ? '确认锚定' : '待确认', ok ? (b.anchored_at ? esc(String(b.anchored_at).slice(5, 19)) : '已确认') : (bad ? '异常·已转人工' : '未完成'), bad)}
      </div>
      <div class="pipe-meta">${esc(prevTxt)}${demo ? ' · 演示' : ''}</div>
    </div>`
  }).join('')
  return `<div class="pipe">
    <div class="pipe-head">
      <span class="chain-name" style="font-size:13px">🧾 上链流水线 · 真实流转路径</span>
      <span class="muted">事件产生 → 本地 Merkle 打包 → 提交上链 → 出块 → 确认锚定；prev_root 把每批串成链</span>
      <span class="chip" style="margin-left:auto">在途 ${pending} 条待打包</span>
    </div>
    ${rows || '<div class="blk-line" style="padding:16px">还没有批次：到「存证中心」点「① 打包」就会走出第一步</div>'}
  </div>`
}

/**
 * 链路视图的 S 型（蛇形）排布：一行放不下就折行，奇数行从右往左，行尾用 U 形虚线转弯接到下一行行首，
 * 所以不管多少个区块都能一眼看全（不再靠横向滚动）。区块很多（>18）自动进入紧凑模式（节点变窄）。
 * 行容量按面板宽度算：容量 n 满足 n*节点宽 + (n-1)*最小连线宽 ≤ 可用宽度（两侧各留 46px 给转弯）。
 */
function chainTrackWidth() {
  const app = document.getElementById('app')
  return Math.max(560, ((app && app.clientWidth) || 1200) - 36)
}
function chainTrackHTML(descs, W) {
  if (!descs.length) return '<div class="chain-track"><div class="blk-line" style="padding:30px">尚无区块：到「存证中心」点「① 打包」即可出根</div></div>'
  const dense = descs.length > 18
  const nw = dense ? 140 : 188, minLink = dense ? 40 : 52
  const per = Math.max(2, Math.floor((W - 92 + minLink) / (nw + minLink)))
  const rows = []
  for (let i = 0; i < descs.length; i += per) rows.push(descs.slice(i, i + per))
  const html = rows.map((row, r) => {
    const inner = []
    row.forEach((d, i) => { if (i) inner.push(blockLinkHTML(row[i - 1].branch, d.branch)); inner.push(d.html) })
    const rev = r % 2 === 1, last = r === rows.length - 1
    const turn = last ? '' : (rev ? ' turn-l' : ' turn-r') + (rows[r + 1][0].branch ? ' turn-branch' : '')
    return `<div class="chain-row${rev ? ' rev' : ''}${last ? ' last' : ''}${turn}">${inner.join('')}</div>`
  }).join('')
  return `<div class="chain-track snake${dense ? ' dense' : ''}" style="--nw:${nw}px;--lk:${minLink}px" data-rows="${rows.length}" data-per="${per}">${html}</div>`
}
/** 窗口尺寸变了：只重排链路（不重新请求接口） */
function chainRelayout() {
  const el = document.querySelector('#chainViz .chain-track'); if (!el || !window.__chainDescs) return
  const next = chainTrackHTML(window.__chainDescs, chainTrackWidth())
  const tmp = document.createElement('div'); tmp.innerHTML = next
  const n = tmp.firstElementChild
  if (n && n.dataset.per !== el.dataset.per) { el.replaceWith(n); flowMarkChain() }   // 重排后重新标出"本单经过的区块"
}
if (typeof window.addEventListener === 'function' && !window.__chainResizeBound) {
  window.__chainResizeBound = true
  let t = null
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(chainRelayout, 180) })
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
  window.__chainDense = batches.length > 18
  const descs = []   // 链路节点描述：branch=账本日终（下沉一档的分支块），连线与换行由 chainTrackHTML 统一生成
  batches.forEach((b) => descs.push({ html: blockNodeHTML(b), branch: Number(b.is_day_close) === 1 }))
  if (Number(pendingN) > 0) {
    descs.push({ branch: false, html: `<div class="chain-node ghost" role="presentation" aria-disabled="true"
      title="待打包队列：还没出根，所以点不开。到「存证中心」点「① 打包」出根后，这里才会变成可点的区块">${cube3d('gray', { ghost: true, label: '待打包<br><b>' + pendingN + '</b> 条' })}
      <div class="blk-title" style="opacity:.75">下一区块</div>
      <div class="blk-line" style="opacity:.7">小时级打包 · #${lastSeq + 1}</div>
      <div class="blk-line"><span class="node-lock">待打包 · 暂不可点</span></div></div>` })
  }
  window.__chainDescs = descs
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
    ${chainTrackHTML(descs, chainTrackWidth())}
    ${pipelineHtml(batches, (c && c.queue) || [], demo)}
    <div class="chain-divider"></div>
    <div class="flow-head">
      <span class="chain-name" style="font-size:13px">🔎 存证检索</span>
      <input id="attestQ" class="flow-input" style="min-width:330px"
        placeholder="订单号 / 批次 #12 / 交易哈希 / Merkle 根 / 凭证号 / 手机号 / 用户ID / DID"
        onkeydown="if(event.key==='Enter')attestSearch()">
      <button class="chain-btn" onclick="attestSearch()">检索 ↗</button>
      <button class="chain-btn" onclick="loadFlowSample()">看一条真实单的六步</button>
      <span id="flowMeta" style="flex:1;font-size:12px;color:#9db1e2"></span>
    </div>
    <div id="attestSearchHint" class="chain-legend" style="border:0;padding:2px 0 8px">
      可查：订单号 · 批次 <code>#12</code> · 交易哈希（64 位）· Merkle 根 / 前根 · 载荷哈希 · 凭证 <code>pass-1</code> · 旅豆流水 <code>bt-…</code> · 结算单 <code>settle-…</code> · 手机号 · 用户ID <code>user:12</code> · DID
      <span class="muted" style="color:#7f92bd">｜合约地址查不到：当前走链上内置存证（DEPOSIT），链上标识就是交易哈希与根，没有合约地址</span>
    </div>
    <div id="attestResult"></div>
    <div class="flow-head" style="margin-top:6px">
      <span class="chain-name" style="font-size:13px">🧭 单流程视角 · 一单六锚</span>
      <input id="flowNo" class="flow-input" placeholder="订单号（如 WL202610311650904810）" onkeydown="if(event.key==='Enter')loadFlow()">
      <button class="chain-btn" onclick="loadFlow()">追踪此单 ↗</button>
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
    ${(d.recentEvents || []).map((e) => `<tr><td>${bizTag(esc(e.biz_type))}</td><td class="num">${evRefLink(e)}</td>
      <td>${e.status === 2 ? '<span class="pill ok">已锚定</span>' : (e.status === 1 ? '<span class="pill s20">已打包·待锚定</span>' : '<span class="pill warn">待打包</span>')}</td>
      <td class="td-sub">${esc(String(e.created_at).slice(5, 19))}</td></tr>`).join('') || '<tr><td colspan="4" class="td-sub">暂无事件</td></tr>'}
    </tbody></table>
  </div>`
  if (window.__flowShown && window.__flowData) renderFlow(window.__flowData)
  // 刷新后把用户正看着的区块/步骤原样恢复：自动刷新不该把人的操作抹掉
  if (window.__attestQ) attestSearch({ silent: true })
  if (window.__openBlockId != null) openBlock(window.__openBlockId, { silent: true })
  else if (window.__openFlowStep != null) openFlowStep(window.__openFlowStep, { silent: true })
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
async function openBlock(id, opt = {}) {
  // 记住展开的是哪一块：链路视图每 30 秒自动刷新会整体重画 #app，不记住的话
  // 用户点开的事件表在下一次刷新时被抹掉 —— 体感就是"点了没反应 / 点完就消失"
  window.__openBlockId = id
  window.__openFlowStep = undefined
  document.querySelectorAll('.chain-node.active').forEach((n) => n.classList.remove('active'))
  const el = document.getElementById('bnode-' + id)
  if (el) el.classList.add('active')
  const box = document.getElementById('blockDetail')
  if (!box) return
  if (!opt.silent) box.innerHTML = `<div class="card">${skel(3)}</div>`
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
  <div class="card block-detail-card">
    <div class="card-head"><h3>区块 #${b.seq} · 批内事件（${Number(b.leaf_count)}${demo ? '，演示取前 10' : ''}）</h3>
      <span class="muted">${Number(b.is_day_close) ? '旅豆账本日终封存批 · ' : ''}打包于 ${esc(String(b.biz_date).slice(0, 10))}${demo ? ' · 演示数据' : ''}<button class="btn ghost sm" style="margin-left:8px" onclick="closeBlock()">收起</button></span></div>
    <div class="row" style="gap:18px;flex-wrap:wrap;font-size:12.5px">
      <span>Merkle 根 <code>${esc(b.merkle_root)}</code><button class="copy-chip" title="复制完整根" onclick="copyText('${esc(b.merkle_root)}')">复制</button></span>
      <span>前根 ${b.prev_root ? `<code>${esc(b.prev_root)}</code><button class="copy-chip" title="复制前根" onclick="copyText('${esc(b.prev_root)}')">复制</button>` : '<code>—（链起点）</code>'}</span>
      ${b.chain_tx_ref ? `<span>链上编号 <code>${esc(b.chain_tx_ref)}</code><button class="copy-chip" title="复制交易哈希" onclick="copyText('${esc(b.chain_tx_ref)}')">复制</button></span>` : ''}
      ${b.chain_block ? `<span>链上块高 <code>${esc(b.chain_block)}</code></span>` : ''}
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
        : (demo ? '' : `<button class="btn ghost sm" onclick="verifyEventInline(${w3Arg(e.biz_type)},${w3Arg(e.biz_ref)},${Number(e.id)},this)">验证</button>`)}</td></tr>`).join('') || '<tr><td colspan="8" class="td-sub">空批次</td></tr>'}
    </tbody></table>
  </div>`
  // block:'start' 才保证用户真的“看见”结果；nearest 在很多情况下等于不滚动
  if (!opt.silent) box.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
function closeBlock() {
  window.__openBlockId = undefined
  document.querySelectorAll('.chain-node.active').forEach((n) => n.classList.remove('active'))
  const box = document.getElementById('blockDetail')
  if (box) box.innerHTML = ''
}
// ---- 可点击的链上字段：业务单号 / 批次号 / 哈希（链路总览、存证中心、链与资产共用）----
// 放进 onclick="…" 的字符串实参：JSON 转义 + HTML 转义，业务单号里有引号也不会拆坏属性
const w3Arg = (s) => esc(JSON.stringify(String(s ?? '')))
/** 业务单号：已入批 → 打开所属区块并高亮这条再验证；待打包 → 就地验证（告诉你它还没入链，而不是沉默） */
const evRefLink = (e) => `<button class="ref-link" type="button" title="${Number(e.batch_id) ? '打开所属批次并验证' : '验证这条记录'}" onclick="openEvent(${w3Arg(e.biz_type)},${w3Arg(e.biz_ref)},${Number(e.batch_id) || 0},this)">${esc(e.biz_ref)}</button>`
const batchLink = (id, label) => (Number(id) ? `<button class="ref-link" type="button" title="打开这一批的事件" onclick="openBlock(${Number(id)})">${esc(label)}</button>` : esc(label))
/** 哈希：显示缩略，点「复制」拿完整值（放在可点行里时不让点击冒泡去触发整行） */
const hashCopy = (full, shown) => `<code>${esc(shown)}</code><button class="copy-chip" type="button" title="复制完整值" onclick="event.stopPropagation();copyText(${w3Arg(full)})">复制</button>`
async function openEvent(bizType, bizRef, batchId, btn) {
  let anchor = btn
  if (batchId && document.getElementById('blockDetail')) {
    await openBlock(batchId)
    const hit = [...document.querySelectorAll('#blockDetail tbody tr')].find((r) => r.children[2] && r.children[2].textContent.trim() === String(bizRef))
    if (hit) {
      hit.classList.add('ev-hit')
      hit.scrollIntoView({ behavior: 'smooth', block: 'start' })
      anchor = hit.querySelector('button, a') || btn
    }
  }
  await verifyEventInline(bizType, bizRef, 0, anchor)
}
async function verifyEventInline(bizType, bizRef, id, anchor) {
  const r = await api('GET', '/admin/attest/verify?bizType=' + encodeURIComponent(bizType) + '&bizRef=' + encodeURIComponent(bizRef))
  // 三态：证明/指纹对不上 = 失败；还没有证明路径（待打包、已入队）= 尚未入链，不能说"通过"；其余才是通过
  const bad = r.found && (r.proofValid === false || r.canonicalValid === false)
  const pending = r.found && !bad && r.proofValid == null
  const kind = !r.found ? 'warn' : bad ? 's70' : pending ? 'warn' : 'ok'
  const text = !r.found ? '未找到该单号' : bad ? '验证失败：证明路径或指纹对不上根' : pending ? '尚未入链 · ' + (r.note || '待打包') : '验证通过 · ' + (r.note || '')
  toast(text, kind === 's70')
  // toast 一闪而过：结果同时留在被点的位置旁边，人没看到 toast 也不等于没验证
  if (anchor && anchor.parentNode) {
    anchor.parentNode.querySelectorAll('.verify-chip').forEach((n) => n.remove())
    anchor.insertAdjacentHTML('afterend', `<span class="pill ${kind} verify-chip" style="margin-left:6px;white-space:normal">${esc(text)}</span>`)
  }
}
// ---- 单流程视角：一单六锚（一笔订单的 6 步链上锚点） ----
const FLOW_ST = ['<span class="dpill warn">待打包</span>', '<span class="dpill info">已打包·待锚定</span>', '<span class="dpill ok">已锚定</span>']
function flowStepHTML(s, i) {
  const e = s.ev
  if (!e) return `<div class="chain-node ghost" style="width:150px" aria-disabled="true"
    title="这一步还没入存证队列，所以点不开；业务发生后会自动出现在这里">
    ${cube3d('gray', { ghost: true, sm: true, label: '待产生' })}
    <div class="blk-title">${s.no} ${esc(s.label)}</div><div class="blk-line">${esc(s.hint)}</div>
    <div class="blk-line"><span class="node-lock">待产生 · 暂不可点</span></div></div>`
  const st = Number(e.status)
  const tone = st === 2 ? 'green' : (st === 0 ? 'gray' : 'blue')
  return `<div class="chain-node" style="width:150px" id="fnode-${i}" role="button" tabindex="0"
    aria-label="第 ${i + 1} 步 ${esc(s.label || '')}，点击查看本步证明"
    onclick="openFlowStep(${i})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openFlowStep(${i})}"
    onmouseenter="chainTip(event, 'f', ${i})" onmousemove="chainTipMove(event)" onmouseleave="chainTipHide()" onfocus="chainTip(event, 'f', ${i})" onblur="chainTipHide()">
    ${cube3d(tone, { sm: true })}
    <div class="blk-title">${s.no} ${esc(s.label)}</div>
    <div class="blk-line">${esc(String(e.created_at).slice(5, 16))}</div>
    <div class="blk-line">${batchChip(e)} · ${FLOW_ST[st] || ''}</div>
  </div>`
}
/** 「批 #12」：点它回到上方链路视图里这个区块（单流程里的每一步，都落在链路视图的某个区块里） */
const batchChip = (e) => (e.seq != null && Number(e.batch_id) ? `<button class="ref-link blk-ref" type="button" title="定位到链路视图里的区块 #${Number(e.seq)}" onclick="event.stopPropagation();focusBlock(${Number(e.batch_id)})">批 #${Number(e.seq)}</button>` : `批 #${e.seq != null ? e.seq : '—'}`)
const STEP_TAG = { r: '退' }
/** 把"这一单"标到链路视图上：经过的区块打上 ①②… 步骤角标并高亮；单流程与链路视图是同一批区块的两种看法 */
function flowMarkChain() {
  document.querySelectorAll('#chainViz .chain-track:not(.flow) .chain-node').forEach((n) => { n.classList.remove('trace-hit'); const t = n.querySelector('.trace-tags'); if (t) t.remove() })
  const d = window.__flowData; if (!d) return []
  const hits = new Map()   // batch_id → { seq, tags[] }
  const put = (e, tag) => { if (!e || !Number(e.batch_id)) return; const h = hits.get(Number(e.batch_id)) || { seq: e.seq, tags: [] }; h.tags.push(tag); hits.set(Number(e.batch_id), h) }
  ;(d.steps || []).forEach((s) => put(s.ev, s.no))
  ;(d.refunds || []).forEach((e) => put(e, STEP_TAG.r))
  hits.forEach((h, id) => {
    const n = document.getElementById('bnode-' + id); if (!n) return
    n.classList.add('trace-hit')
    n.insertAdjacentHTML('afterbegin', `<div class="trace-tags" title="本单的 ${esc(h.tags.join(' '))} 在这个区块里">${h.tags.map((t) => `<i>${esc(t)}</i>`).join('')}</div>`)
  })
  return [...hits.entries()].map(([id, h]) => ({ id, seq: h.seq, tags: h.tags, onChain: !!document.getElementById('bnode-' + id) }))
}
function focusBlock(id) {
  const n = document.getElementById('bnode-' + id)
  if (!n) { openBlock(id); return }   // 不在最近 20 个区块里（链路视图只画最近的）→ 直接打开它的批内事件
  n.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' })
  n.classList.remove('flash'); void n.offsetWidth; n.classList.add('flash')
  setTimeout(() => n.classList.remove('flash'), 2200)
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
  const marks = flowMarkChain()
  if (track) track.innerHTML = `<div class="chain-track flow">${parts.join('')}</div>
    ${marks.length ? `<div class="flow-blocks">这一单落在链路视图的 <b>${marks.length}</b> 个区块里：${marks.map((m) => `<button class="ref-link" type="button" onclick="focusBlock(${m.id})">区块 #${Number(m.seq)} <em>${esc(m.tags.join(' '))}</em></button>`).join('')}<span class="muted">点一下定位到上方对应区块</span></div>` : ''}`
}
// ---- 存证检索：一个入口吃多种标识（订单号/批次/交易哈希/根/凭证/手机号/用户ID/DID）----
const ST_CN = { 0: '待打包', 1: '已打包·待锚定', 2: '已锚定', 3: '锚定重试', 4: '人工处理', 5: '已提交·待确认' }
const stPill = (n) => {
  const st = Number(n)
  const cls = st === 2 ? 'ok' : st === 0 ? 'warn' : (st === 3 || st === 4) ? 'err' : 's20'
  return `<span class="pill ${cls}">${ST_CN[st] || '—'}</span>`
}
function attestResultHtml(r) {
  const empty = !r.order && !r.user && !r.pass && !(r.batches || []).length && !(r.events || []).length
  const cap = r.capability || {}
  if (empty) {
    return `<div class="card" style="background:#fff8ec">
      <div class="card-head"><h3>没查到「${esc(r.q)}」</h3><span class="muted">换一种标识试试</span></div>
      <div class="muted" style="line-height:1.9">可查：${(cap.canSearch || []).map((x) => `<code>${esc(x)}</code>`).join(' · ')}</div>
      <div class="muted" style="margin-top:6px">提示：单号要完整；批次写 <code>#12</code> 或 <code>batch:12</code>；哈希是 64 位，可从区块详情里「复制」。</div>
      ${cap.noContract ? `<div class="muted" style="margin-top:6px;color:#98712a">${esc(cap.noContract)}</div>` : ''}
    </div>`
  }
  const obj = []
  if (r.order) {
    const o = r.order
    obj.push(`<span class="pill ok">订单</span> <b>${esc(o.orderNo)}</b>
      <span class="muted">${esc(o.productName || '')} · ¥${(Number(o.amountPay) / 100).toFixed(2)} · 状态 ${esc(String(o.status))}</span>
      <button class="btn ghost sm" onclick="document.getElementById('flowNo').value='${esc(o.orderNo)}';loadFlow()">看这单的六步 ›</button>`)
  }
  if (r.user) {
    const u = r.user
    obj.push(`<span class="pill s20">用户</span> <b>#${u.id} ${esc(u.nickname || '')}</b>
      <span class="muted">等级 L${Number(u.memberLevel)}</span>
      ${u.did ? `<span class="muted">DID <code>${esc(u.did)}</code><button class="copy-chip" onclick="copyText('${esc(u.did)}')">复制</button></span>` : '<span class="muted">未签发 DID</span>'}`)
  }
  if (r.pass) {
    obj.push(`<span class="pill s20">权益凭证</span> <b>pass-${Number(r.pass.id)}</b>
      <span class="muted">状态 ${Number(r.pass.status) === 2 ? '已核销' : '有效'} · 订单 #${Number(r.pass.orderId)}</span>`)
  }
  const batches = (r.batches || []).map((b) => `<div class="sr-batch">
      <span class="sr-seq">#${Number(b.seq)}</span>
      <span>${Number(b.is_day_close) ? '账本日终' : '业务批次'} · 业务日 ${esc(String(b.biz_date || '').slice(0, 10))} · ${Number(b.leaf_count || 0)} 条</span>
      ${stPill(b.status)}
      <code class="sr-root">根 ${esc(String(b.merkle_root || '').slice(0, 12))}…</code>
      ${b.chain_tx_ref ? `<code class="sr-tx">链上 ${esc(String(b.chain_tx_ref).slice(0, 16))}…</code><button class="copy-chip" onclick="copyText('${esc(b.chain_tx_ref)}')">复制哈希</button>` : '<span class="muted">未上链</span>'}
      ${b.chain_block ? `<span class="muted">块高 ${esc(b.chain_block)}</span>` : ''}
      <button class="btn ghost sm" onclick="openBlock(${Number(b.id)})">打开批内事件 ›</button>
    </div>`).join('')
  const evs = (r.events || []).map((e) => `<tr>
      <td>${bizTag(esc(e.biz_type))}</td>
      <td class="num">${esc(e.biz_ref)}</td>
      <td class="num">v${Number(e.version_no ?? 1)}</td>
      <td>${stPill(e.status)}</td>
      <td>${e.seq != null ? `<button class="btn ghost sm" onclick="openBlock(${Number(e.batch_id)})">#${Number(e.seq)}</button>` : '<span class="muted">未打包</span>'}</td>
      <td class="td-sub"><code>${esc(String(e.payload_hash || '').slice(0, 16))}…</code></td>
      <td class="td-sub">${esc(String(e.created_at).slice(5, 19))}</td>
      <td>${e.biz_type === 'order' ? `<a class="btn ghost sm" target="_blank" rel="noopener" href="/verify?no=${encodeURIComponent(e.biz_ref)}">公开复核</a>`
        : e.batch_id ? `<button class="btn ghost sm" onclick="verifyEventInline(${w3Arg(e.biz_type)},${w3Arg(e.biz_ref)},${Number(e.id)},this)">验证</button>` : ''}</td>
    </tr>`).join('')
  return `<div class="card">
    <div class="card-head"><h3>检索「${esc(r.q)}」</h3>
      <span class="muted">按${(r.matched || []).map((x) => `<code>${esc(x)}</code>`).join(' / ')}命中 · 链 ${esc((r.chain && r.chain.label) || '—')}</span></div>
    ${obj.length ? `<div class="sr-obj">${obj.join('')}</div>` : ''}
    ${batches ? `<div class="sr-sec">命中的批次（${(r.batches || []).length}）</div>${batches}` : ''}
    ${evs ? `<div class="sr-sec">命中的存证事件（${(r.events || []).length}）</div>
      <table><thead><tr><th>类型</th><th>业务单号</th><th>版本</th><th>状态</th><th>批次</th><th>载荷指纹</th><th>时间</th><th></th></tr></thead><tbody>${evs}</tbody></table>` : ''}
    ${cap.noContract ? `<div class="muted" style="margin-top:8px;color:#98712a">${esc(cap.noContract)}</div>` : ''}
  </div>`
}
async function attestSearch(opt = {}) {
  const el = document.getElementById('attestQ')
  const v = opt.silent ? (window.__attestQ || '') : (el && el.value || '').trim()
  if (!v) return toast('请输入要查的内容：订单号 / 批次 #12 / 交易哈希 / Merkle 根 / 凭证号 / 手机号 / 用户ID / DID', true)
  window.__attestQ = v
  const box = document.getElementById('attestResult')
  if (!box) return
  if (!opt.silent) box.innerHTML = `<div class="card">${skel(2)}</div>`
  try {
    box.innerHTML = attestResultHtml(await api('GET', '/admin/attest/search?q=' + encodeURIComponent(v)))
  } catch (e) {
    box.innerHTML = `<div class="card" style="background:#fff8ec"><b>检索失败</b><div class="muted">${esc(e.message)}</div></div>`
  }
}

async function loadFlow() {
  const no = (document.getElementById('flowNo')?.value || '').trim()
  if (!no) return toast('请输入订单号', true)
  try {
    renderFlow(await api('GET', '/admin/attest/flow/' + encodeURIComponent(no)))
  } catch (e) {
    // 后端口径是"订单不存在"，运营看不出是单号错了还是系统坏了 → 补上下文
    toast(/订单不存在|1004/.test(e.message) ? `没找到订单 ${no}：核对单号，或点「演示完整流程」看形态` : e.message, true)
  }
}
/** 看一条真实单的六步：取最近一笔有订单存证的真实订单；一笔都没有才退回演示数据（并明说） */
async function loadFlowSample() {
  try {
    const c = await api('GET', '/admin/attest/center')
    const o = (c.recent || []).find((e) => e.biz_type === 'order')
    if (o) { const el = document.getElementById('flowNo'); if (el) el.value = o.biz_ref; return loadFlow() }
  } catch (e) { /* 取不到就走演示 */ }
  toast('还没有真实订单的存证，先用演示数据看形态')
  loadFlowDemo()
}
/** 演示完整流程：演示单的每一步都落在「演示 · 多节点形态」那条模拟链的区块里（批次号、状态、日期一一对应），两个视图看到的是同一批区块 */
async function loadFlowDemo() {
  const chainBlk = Object.fromEntries(mockChain().map((b) => [b.seq, b]))
  const mk = (no, ref, label, hint, seq, t, st) => ({ no, label, hint, ev: { biz_type: label, biz_ref: ref, version_no: 1, status: st, batch_id: chainBlk[seq].id, payload_hash: 'f0' + String(seq).padStart(2, '0') + 'a1b2c3d4e5f60718', created_at: t, seq, merkle_root: chainBlk[seq].merkle_root } })
  window.__flowData = {
    demo: true,
    order: { orderNo: 'WL20261101DEMO01', status: 50, statusText: '已完成', productName: '朱家角水乡沉浸一日（演示）', qty: 2, amountPay: 39800, beanDeducted: 200, createdAt: '2026-10-28 10:02:11', paidAt: '2026-10-28 10:03:05', completedAt: '2026-10-30 15:40:22' },
    steps: [
      mk('①', 'bt-DEMO1001', '旅豆抵扣', '下单锁豆', 3, '2026-10-28 10:02:30', Number(chainBlk[3].status)),
      mk('②', 'WL20261101DEMO01', '支付成功', '订单事实入链', 3, '2026-10-28 10:03:05', Number(chainBlk[3].status)),
      mk('③', 'pass-901', '出票', '权益凭证 ×2', 4, '2026-10-29 10:03:40', Number(chainBlk[4].status)),
      mk('④', 'pass-901-1', '核销', '到店扫码', 4, '2026-10-29 11:25:02', Number(chainBlk[4].status)),
      mk('⑤', 'bt-DEMO1002', '返豆', '消费奖励', 6, '2026-10-30 15:40:22', Number(chainBlk[6].status)),
      mk('⑥', 'settle-31', '结算', '五口径分账', 7, '2026-10-31 01:00:10', Number(chainBlk[7].status)),
    ],
    refunds: [],
  }
  window.__flowShown = true
  if (!window.__demoChain) { window.__demoChain = true; await web3dash() } else renderFlow(window.__flowData)
}
function openFlowStep(i, opt = {}) {
  const d = window.__flowData
  if (!d) return
  window.__openFlowStep = i
  window.__openBlockId = undefined
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
      <span>Merkle 根 <code>${e.merkle_root ? esc(String(e.merkle_root).slice(0, 24)) + '…' : '—'}</code>${e.merkle_root ? `<button class="copy-chip" title="复制完整根" onclick="copyText('${esc(e.merkle_root)}')">复制</button>` : ''}</span>
      <span>payload 指纹 <code>${esc(String(e.payload_hash).slice(0, 16))}…</code></span>
      <span>时间 ${esc(String(e.created_at).slice(0, 19))}</span>
    </div>
    <div class="row" style="margin-top:10px">
      ${!d.demo && e.biz_type === 'order' ? `<a class="btn ghost sm" target="_blank" rel="noopener" href="/verify?no=${encodeURIComponent(e.biz_ref)}">公开复核页 ↗</a>
        <a class="btn ghost sm" target="_blank" rel="noopener" href="/open/report/order/${encodeURIComponent(e.biz_ref)}">存证报告 PDF ↗</a>` : ''}
      <span class="muted">六步与业务同事务写入 · 小时级打包 · 上链只有哈希指纹+时间戳</span>
    </div>
  </div>`
  if (!opt.silent) box.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
      <div class="kpi go" title="去数字身份：按用户看身份档案、旅豆账户与徽章" onclick="go('vc')"><i class="go-arrow">↗</i><div class="ico" style="background:#fdf3e0">👥</div><div><div class="l">旅豆账户数</div><div class="v" style="font-size:18px">${d.holders}</div><div class="s">一户一账（bean_account）· 点开到「数字身份」看每个账户对应的身份档案</div></div></div>
      <div class="kpi"><div class="ico" style="background:#e8effd">📦</div><div><div class="l">发行批次</div><div class="v" style="font-size:18px">${(d.budgets || []).length}</div><div class="s">按批次预算发行</div></div></div>
      <div class="kpi"><div class="ico" style="background:var(--brand-soft)">🛡</div><div><div class="l">年度总量哨兵</div><div class="v" style="font-size:18px">${d.globalCap ? (d.globalCap.cap_total || d.globalCap.total || '—') : '—'}</div><div class="s">严禁超发 · 双分录平衡</div></div></div>
    </div>
  </div>
  <div class="card">
    <div class="card-head"><h3>发行批次</h3></div>
    <table><thead><tr><th>批次</th><th>名称</th><th>额度</th><th>已发放</th><th>回流</th><th>状态</th></tr></thead><tbody>
    ${(d.budgets || []).map((b) => `<tr class="click-row" ${dxKey} title="去预算管理查看这个批次" onclick="go('budgets')"><td>#${b.id}</td><td>${esc(b.name || '—')}</td><td class="num">${Number(b.total)}</td>
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
