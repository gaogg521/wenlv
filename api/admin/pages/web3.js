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
  const queue = (d.queue || []).slice().sort((x, y) => Number(y.total) - Number(x.total))
  const sum = (k) => queue.reduce((s, x) => s + Number(x[k] || 0), 0)
  const tot = sum('total'), pend = sum('pending'), pack = sum('packed'), anch = sum('anchored')
  const pct = (n, all) => (all ? Math.round(n / all * 100) : 0)
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h3>存证概况</h3><span class="muted">${esc(d.chainMode)}</span></div>
    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:14px">
      <div class="kpi"><div class="ico" style="background:var(--brand-soft)">📚</div><div><div class="l">存证事件</div><div class="v" style="font-size:18px">${tot}</div><div class="s">已锚定 ${pct(anch, tot)}%</div></div></div>
      <div class="kpi"><div class="ico" style="background:#fdf3e0">📥</div><div><div class="l">待打包</div><div class="v" style="font-size:18px${pend ? ';color:#b7791f' : ''}">${pend}</div><div class="s">小时级打包</div></div></div>
      <div class="kpi"><div class="ico" style="background:#e8effd">📦</div><div><div class="l">已打包·待锚定</div><div class="v" style="font-size:18px">${pack}</div><div class="s">根已生成</div></div></div>
      <div class="kpi"><div class="ico" style="background:#e3f6ec">✅</div><div><div class="l">已锚定</div><div class="v" style="font-size:18px">${anch}</div><div class="s">链上已确认</div></div></div>
    </div>
    <div class="att-ops"><span class="att-ops-l">手动运行</span>
      ${adminCan('system.jobRun') ? `<button class="btn ghost sm" onclick="runJob('attest-pack','attest')">① 打包（出 Merkle 根）</button>
      <button class="btn ghost sm" onclick="runJob('attest-anchor','attest')">② 补锚（按 seq 升序）</button>
      <button class="btn ghost sm" onclick="runJob('bean-day-close','attest')">③ 封存昨日旅豆账本</button>
      <button class="btn ghost sm" onclick="runJob('attest-reconcile','attest')">④ 六条不变式对账</button>` : '<span class="muted">打包 / 补锚 / 封存 / 对账由超级管理员或运维执行（本页保持只读视图）</span>'}
      <span class="muted">${real ? '已接入' + esc((d.chain && d.chain.label) || '当前链') + '：补锚将真实上链' : 'NOOP：①后停留在「已打包·待锚定」，②不会产生假交易号'}</span>
    </div>
    <div class="att-ops"><span class="att-ops-l">单号验证</span><input id="vref" placeholder="输入订单号验证（如 WL20261024…）" style="width:320px">
      <button class="btn primary sm" onclick="verifyAttest()">验证</button>
      <span class="muted">公开验证口（无登录只读）：/open/verify/order/{单号} · /open/verify/bean-day/{日期}</span></div>
    <div id="vout"></div>
  </div>
  <div class="card">
    <div class="card-head"><h3>各业务环节的存证进度</h3><span class="muted">颜色与链路视图的区块一致</span></div>
    ${queue.length ? `<table class="att-table"><thead><tr><th>业务环节</th><th>累计</th><th style="width:34%">已锚定占比</th><th>待打包</th><th>已打包</th><th>已锚定</th></tr></thead><tbody>
      ${queue.map((x) => { const t = Number(x.total), a = Number(x.anchored), p = Number(x.pending); return `<tr>
        <td class="td-main"><i class="biz-dot" style="background:${bizColor(x.biz_type)}"></i>${esc(BIZ_CN[x.biz_type] || x.biz_type)}</td>
        <td class="num">${t}</td>
        <td><div class="att-bar" title="已锚定 ${a} / ${t}"><i style="width:${pct(a, t)}%;background:${bizColor(x.biz_type)}"></i></div><span class="td-sub">${pct(a, t)}%</span></td>
        <td class="num${p ? ' att-warn' : ''}">${p}</td><td class="num">${Number(x.packed || 0)}</td><td class="num">${a}</td></tr>` }).join('')}
    </tbody></table>` : emptyBox('还没有存证事件')}
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
  window.__cardScale = d.cardScale || null   // 卡种按「第几级 / 共几级」算，先于渲染就位
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>数字身份 · 可携出旅行凭证</h2><span class="muted">${esc(d.policy)}</span></div>
    <div class="vc-hero">
    <div id="vcCardBox">${vcHeroCard(d.recent || [])}</div>
    <div class="vc-hero-side">
    <div class="kpi-grid" style="grid-template-columns:repeat(2,1fr);margin-bottom:10px">
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
    </div></div>
  </div>

  <div class="card">
    <div class="card-head"><h3>卡面图鉴</h3><span class="muted">角色决定系列，等级决定卡种：最高一级是黑金卡，等级名和人数都取自当前配置</span></div>
    <div id="vcGallery">${vcGalleryHtml('traveler')}</div>
  </div>

  <div class="card">
    <div class="card-head"><h3>身份档案 · 数字身份 ↔ 旅豆账户</h3><span class="muted">一人一个数字身份（DID），与其旅豆账户、徽章、行程按用户 id 一一关联；点数字可看明细</span></div>
    <div class="row" style="margin-bottom:10px"><input id="idq" placeholder="昵称 / 用户 id / DID" style="width:260px" onkeydown="if(event.key==='Enter')vcIdentityList(1)">
      <button class="btn primary sm" onclick="vcIdentityList(1)">查询</button>
      <select id="idSize" aria-label="每页人数" onchange="vcIdentityList(1)"><option value="12">每页 12 人</option><option value="30">每页 30 人</option><option value="100">每页 100 人</option></select>
      <span style="flex:1"></span>
      <select id="vcBatchScope" aria-label="批量签发的凭证范围"><option value="travel">旅行身份</option><option value="basic">基础身份</option><option value="creator">创作者</option><option value="promoter">推广服务商</option><option value="merchant">商户</option></select>
      <button class="btn ghost sm" onclick="vcBatchOpen()">批量签发</button></div>
    <div id="idList">${idListHtml(idn)}</div>
  </div>

  <div class="card">
    <div class="card-head"><h3>最近签发</h3><span class="muted">吊销后验签立即失败</span></div>
    ${(d.recent || []).length ? `<table><thead><tr><th>#</th><th>用户</th><th>DID</th><th>范围</th><th>签发</th><th>到期</th><th>状态</th><th>操作</th></tr></thead><tbody>
      ${d.recent.map((v) => `<tr><td class="num">${v.id}</td>
        <td class="td-main">${esc(v.nickname || '用户' + v.user_id)}</td>
        <td class="td-sub mono">${esc(String(v.did).slice(0, 18))}…</td>
        <td><span class="pill off">${esc(SCOPE_CN[v.scope] || v.scope)}</span></td>
        <td class="td-sub">${esc(String(v.issued_at).slice(5, 19))}</td>
        <td class="td-sub">${esc(String(v.expires_at).slice(5, 19))}</td>
        <td>${v.revoked_at ? '<span class="pill s70">已吊销</span>' : (new Date(v.expires_at) > new Date() ? '<span class="pill ok">有效</span>' : '<span class="pill off">已过期</span>')}</td>
        <td><button class="btn ghost sm" onclick="showVcCard(${v.id})">卡片</button> <button class="btn ghost sm" onclick="vcIdentity(${v.user_id})">档案</button> ${v.revoked_at ? '' : `<button class="btn ghost sm" onclick="revokeVc(${v.id})">吊销</button>`}</td></tr>`).join('')}
    </tbody></table>` : emptyBox('尚未签发过凭证：上方选一个用户签发即可')}
  </div>

  <div class="card">
    <div class="card-head"><h3>代用户签发（演示 / 客服）</h3><span class="muted">签完可直接复制凭证去验签台验证</span></div>
    <div class="row">
      <input id="vcUid" type="number" placeholder="用户 id" style="width:120px">
      <select id="vcScope"><option value="travel">旅行身份（含行程/城市/徽章）</option><option value="basic">基础身份（仅等级/入会）</option><option value="creator">创作者</option><option value="promoter">推广服务商</option><option value="merchant">商户</option></select>
      <button class="btn primary sm" onclick="issueVc()">签发</button>
      <button class="btn ghost sm" onclick="openVerifyVc()">用当前凭证打开验签台</button>
    </div>
    <div id="vcOut"></div>
  </div>`
  window.__vcLast = ''
  window.__vcRecent = d.recent || []
}

const VC_SAMPLE = { level: '探索者', levelNo: 3, growthBand: '1000–2999', memberSince: '2026-03', scope: 'travel', trips: 12, cities: 5, badges: ['初访古镇', '山海行者', '夜游达人'] }

/** 页面顶部的卡片：优先最近一张有效的真实凭证（数字可点）；一张都没有才放示例 */
function vcHeroCard(recent) {
  const v = recent.find((x) => !x.revoked_at && new Date(x.expires_at) > new Date())
  if (!v) return `<div class="muted" style="margin-bottom:8px">示例卡片（非真实用户）：还没有有效凭证，在下方身份档案里点「签发」</div>${vcCardSvg(VC_SAMPLE, { sample: true, uid: 0 })}`
  return `<div class="muted" style="margin-bottom:8px">最近签发 · ${esc(v.nickname || '用户' + v.user_id)} · 点卡片上的数字看明细</div>${vcCardSvg(v.claims, { did: v.did, exp: v.expires_at, status: '有效', uid: v.user_id })}`
}

/* ---- 卡面体系：角色决定系列（图案 / 徽记 / 边条色），等级决定卡种（材质），和银行卡的普卡到黑金卡一个思路 ---- */
const CARD_ROLES = {
  traveler: { name: '行者系列', en: 'TRAVELER', label: '旅行者', unit: '人', color: '#2dd4bf', base: ['#0f2a4a', '#0e6b5c'] },
  creator: { name: '创作者系列', en: 'CREATOR', label: '创作者', unit: '人', color: '#e879f9', base: ['#2e1a52', '#86307a'] },
  promoter: { name: '推广服务系列', en: 'PROMOTER', label: '推广服务商', unit: '位', color: '#60a5fa', base: ['#12305f', '#2a6fb5'] },
  merchant: { name: '商户系列', en: 'MERCHANT', label: '商户', unit: '家', color: '#fb923c', base: ['#54210e', '#c2501f'] },
}
const CARD_TIERS = {
  classic: { name: '普卡', en: 'CLASSIC', ink: '#ffffff', sub: 'rgba(255,255,255,.7)', accent: '#d6e6f5', line: 'rgba(255,255,255,.16)', ok: '#7ce0b5', chip: ['#e6ebef', '#98a3ad'] },
  gold: { name: '金卡', en: 'GOLD', bg: ['#a9772a', '#e3bd6a', '#f6e3a4', '#b98a35'], ink: '#2b1b05', sub: 'rgba(43,27,5,.74)', accent: '#4a2e07', line: 'rgba(74,46,7,.24)', ok: '#14532d', chip: ['#fff4cc', '#a97c25'] },
  platinum: { name: '白金卡', en: 'PLATINUM', bg: ['#8e9aa7', '#dbe2e8', '#f8fafb', '#aab5bf'], ink: '#16212c', sub: 'rgba(22,33,44,.7)', accent: '#2c3f50', line: 'rgba(44,63,80,.2)', ok: '#14532d', chip: ['#ffffff', '#8f9ba6'] },
  diamond: { name: '钻石卡', en: 'DIAMOND', bg: ['#0d1645', '#22378c', '#3f6fd1', '#17255f'], ink: '#ffffff', sub: 'rgba(214,232,255,.78)', accent: '#bfeaff', line: 'rgba(191,234,255,.2)', ok: '#7ce0b5', chip: ['#e8f7ff', '#7fb2d9'] },
  black: { name: '黑金卡', en: 'BLACK', bg: ['#050506', '#1b1814', '#2b261e', '#09090a'], ink: '#f6e7bb', sub: 'rgba(246,231,187,.66)', accent: '#dcb862', line: 'rgba(220,184,98,.26)', ok: '#9fe3bf', chip: ['#f4dc90', '#94742a'] },
}
const CARD_TIER_ORDER = ['classic', 'gold', 'platinum', 'diamond', 'black']
/** 等级 → 卡种：最高一级固定是黑金卡，其余从普卡往上排；等级数在参数中心改了，卡种自动跟着变 */
function cardTierOf(rank, total) {
  const n = Math.max(1, Number(total) || 4), r = Math.min(Math.max(1, Number(rank) || 1), n)
  if (n > 1 && r === n) return 'black'
  return CARD_TIER_ORDER[Math.min(r - 1, 3)]
}
function cardTotal(role) {
  const s = (window.__cardScale || {})[role]
  return s && s.levels ? s.levels.length : (role === 'traveler' || role === 'merchant' ? 4 : 3)
}
const CARD_EMBLEM = {
  traveler: '<circle r="13" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M0-10 3.2 0 0 10-3.2 0z" fill="currentColor"/><path d="M-10 0h3M7 0h3" stroke="currentColor" stroke-width="1.4"/>',
  creator: '<path d="M0 13-8-3-3-12h6l5 9zM0 13V1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cy="-1" r="2" fill="currentColor"/>',
  promoter: '<circle r="3.4" fill="currentColor"/><path d="M-7-7a10 10 0 0 0 0 14M7-7a10 10 0 0 1 0 14M-11.5-11.5a16 16 0 0 0 0 23M11.5-11.5a16 16 0 0 1 0 23" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
  merchant: '<path d="M-12-4-9-11H9l3 7c0 2.6-4 2.6-4 0 0 2.6-4 2.6-4 0 0 2.6-4 2.6-4 0 0 2.6-4 2.6-4 0 0 2.6-4 2.6-4 0zM-10-1v12h20V-1M-3 11V4h6v7" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
}
/** 系列底纹：一眼能分出角色；线条颜色跟着卡种走 */
function cardPattern(role, t, id) {
  const l = t.line
  if (role === 'creator') return `<g fill="none" stroke="${l}" stroke-width="1.4"><path d="M-10 262C90 196 170 306 280 244S460 190 540 252"/><path d="M-10 222C90 156 170 266 280 204S460 150 540 212"/><path d="M-10 182C90 116 170 226 280 164S460 110 540 172"/><path d="M-10 142C90 76 170 186 280 124S460 70 540 132"/></g>`
  if (role === 'promoter') return `<g fill="none" stroke="${l}" stroke-width="1.2">${[70, 120, 170, 220, 270, 320].map((r) => `<circle cx="520" cy="20" r="${r}"/>`).join('')}</g><g fill="${l}"><circle cx="400" cy="150" r="3.5"/><circle cx="330" cy="70" r="3"/><circle cx="470" cy="230" r="3"/><circle cx="300" cy="200" r="2.5"/></g>`
  if (role === 'merchant') return `<defs><pattern id="${id}m" width="26" height="26" patternUnits="userSpaceOnUse"><path d="M26 0H0V26" fill="none" stroke="${l}" stroke-width="1"/></pattern></defs><rect x="250" width="270" height="328" fill="url(#${id}m)"/>`
  return `<g fill="none" stroke="${l}" stroke-width="1.2">${[70, 110, 150, 190, 230, 270].map((r) => `<circle cx="440" cy="310" r="${r}"/>`).join('')}<path d="M24 292C140 214 244 318 408 150" stroke-dasharray="3 6" stroke-width="1.6"/></g><circle cx="408" cy="150" r="3.5" fill="${l}"/>`
}
/** 卡种质感：普卡素面；金卡拉丝反光；白金细条纹；钻石切面；黑金描金框 */
function cardFinish(tier, t, id) {
  if (tier === 'gold') return '<polygon points="60,0 230,0 90,328 -80,328" fill="#fff" opacity=".2"/><polygon points="270,0 310,0 170,328 130,328" fill="#fff" opacity=".14"/>'
  if (tier === 'platinum') return `<defs><pattern id="${id}p" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V5" stroke="#fff" stroke-width="1" opacity=".4"/></pattern></defs><rect width="520" height="328" fill="url(#${id}p)"/><polygon points="120,0 260,0 120,328 -20,328" fill="#fff" opacity=".28"/>`
  if (tier === 'diamond') return '<g fill="#fff"><polygon points="300,0 420,0 360,120" opacity=".1"/><polygon points="420,0 520,0 520,110 360,120" opacity=".06"/><polygon points="240,120 360,120 300,0" opacity=".05"/><polygon points="360,120 520,110 520,250 430,328 300,250" opacity=".08"/><polygon points="240,120 360,120 300,250" opacity=".12"/><polygon points="0,328 170,328 240,120 90,160" opacity=".04"/></g>'
  if (tier === 'black') return `<defs><pattern id="${id}b" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><path d="M0 0V7" stroke="${t.accent}" stroke-width=".6" opacity=".14"/></pattern></defs><rect width="520" height="328" fill="url(#${id}b)"/><rect x="12" y="12" width="496" height="304" rx="12" fill="none" stroke="${t.accent}" stroke-width="1" opacity=".6"/>`
  return ''
}
let __vcCardSeq = 0   // 同页多张卡时渐变 id 不能重名，否则后面的卡会用上第一张的颜色
/** 画一张卡。o：role / tier / levelName / levelNo / sub / stats[{k,label,val}] / chips / note / did / exp / foot / status / uid / sample */
function cardFace(o) {
  const role = CARD_ROLES[o.role] ? o.role : 'traveler'
  const R = CARD_ROLES[role], tier = CARD_TIERS[o.tier] ? o.tier : 'classic', t = CARD_TIERS[tier]
  const id = 'vc' + (++__vcCardSeq)
  const stops = (t.bg || R.base)
  const hit = (k, x, y, w, h, inner) => {
    if (o.uid == null || !k) return inner
    const u = Number(o.uid) || 0
    return `<g class="vc-hit" role="button" tabindex="0" aria-label="查看${k}明细" onclick="vcStatOpen(${u},'${k}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();vcStatOpen(${u},'${k}')}"><rect class="hitbg" x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="transparent"/>${inner}</g>`
  }
  const statX = [28, 150, 272]
  const stats = (o.stats || []).slice(0, 3).map((s, i) => hit(s.k, statX[i] - 8, 174, 116, 50, `<text x="${statX[i]}" y="200" font-size="24" font-weight="700" fill="${t.ink}">${esc(s.val)}</text><text x="${statX[i]}" y="217" font-size="11" fill="${t.sub}">${esc(s.label)}${o.uid != null && s.k ? ' ›' : ''}</text>`)).join('')
  let x = 28, chips = ''
  const names = (o.chips || []).map(String)
  let shown = 0
  for (const b of names) {
    const w = b.length * 12 + 20
    if (x + w > 420) break
    chips += `<rect x="${x}" y="233" width="${w}" height="21" rx="10.5" fill="none" stroke="${t.accent}" stroke-opacity=".6"/><text x="${x + w / 2}" y="248" text-anchor="middle" font-size="11" fill="${t.accent}">${esc(b)}</text>`
    x += w + 6; shown++
  }
  if (shown < names.length) chips += `<text x="${x + 2}" y="248" font-size="11" fill="${t.sub}">+${names.length - shown}</text>`
  const dead = o.status === '已吊销' || o.status === '已过期'
  const footText = o.foot || (o.did ? 'DID ' + String(o.did).slice(0, 26) + '…' : '最小披露：不含姓名 / 手机号 / 身份证 / 订单号 / 金额')
  return `<svg class="vc-card" data-role="${role}" data-tier="${tier}" viewBox="0 0 520 328" style="width:100%;max-width:520px;height:auto;border-radius:18px;box-shadow:0 10px 26px rgba(15,23,42,.28)" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(t.name)} · ${esc(R.label)} · ${esc(o.levelName || '')}">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">${stops.map((c, i) => `<stop offset="${stops.length > 1 ? i / (stops.length - 1) : 0}" stop-color="${c}"/>`).join('')}</linearGradient>
      <linearGradient id="${id}c" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${t.chip[0]}"/><stop offset="1" stop-color="${t.chip[1]}"/></linearGradient>
      <clipPath id="${id}k"><rect width="520" height="328" rx="18"/></clipPath></defs>
    <g clip-path="url(#${id}k)"${dead ? ' style="filter:grayscale(.92)"' : ''}>
      <rect width="520" height="328" fill="url(#${id})"/>
      ${cardPattern(role, t, id)}${cardFinish(tier, t, id)}
      <rect width="7" height="328" fill="${R.color}"/>
      <text x="28" y="35" font-size="13" font-weight="700" fill="${t.ink}" letter-spacing="1">向往的自由 · ${esc(R.name)}</text>
      <text x="28" y="50" font-size="9" fill="${t.sub}" letter-spacing="2">${R.en} IDENTITY</text>
      <text x="492" y="36" text-anchor="end" font-size="16" font-weight="700" fill="${t.accent}" letter-spacing="2">${esc(t.name)}</text>
      <text x="492" y="50" text-anchor="end" font-size="9" fill="${t.sub}" letter-spacing="2">${t.en}</text>
      <g><rect x="28" y="64" width="44" height="33" rx="6" fill="url(#${id}c)"/><path d="M28 75h14M28 86h14M58 75h14M58 86h14M42 64v33M58 64v33" stroke="rgba(0,0,0,.28)" stroke-width="1" fill="none"/></g>
      ${hit('level', 20, 104, 310, 62, `<text x="28" y="136" font-size="30" font-weight="700" fill="${t.ink}">${esc(o.levelName || '—')}</text>
        <text x="28" y="157" font-size="12" fill="${t.sub}">${esc(o.sub || '')}${o.uid != null && o.sub ? ' ›' : ''}</text>`)}
      ${hit('level', 406, 66, 92, 92, `<circle cx="452" cy="112" r="38" fill="none" stroke="${t.accent}" stroke-opacity=".55" stroke-width="1.5"/><circle cx="452" cy="112" r="30" fill="none" stroke="${t.accent}" stroke-opacity=".25"/>
        <g transform="translate(452 100) scale(.82)" style="color:${t.accent}">${CARD_EMBLEM[role]}</g><text x="452" y="133" text-anchor="middle" font-size="13" font-weight="700" fill="${t.accent}">Lv.${esc(o.levelNo ?? '-')}</text>`)}
      ${stats || (o.note ? `<text x="28" y="200" font-size="13" fill="${t.sub}">${esc(o.note)}</text>` : '')}
      ${names.length ? hit(o.chipKey || '', 20, 228, 480, 30, chips) : ''}
      <line x1="28" y1="270" x2="492" y2="270" stroke="${t.line}"/>
      <text x="28" y="295" font-size="11" fill="${t.sub}" letter-spacing=".5">${esc(footText)}${o.exp ? ' · 有效期至 ' + esc(String(o.exp).slice(0, 10)) : ''}</text>
      ${o.status && !dead ? `<text x="492" y="295" text-anchor="end" font-size="12" font-weight="700" fill="${o.status === '有效' ? t.ok : t.sub}">${esc(o.status)}</text>` : ''}
    </g>
    ${dead ? `<g transform="rotate(-12 260 160)"><rect x="170" y="128" width="180" height="58" rx="8" fill="rgba(180,35,24,.12)" stroke="#d92d20" stroke-width="3"/><text x="260" y="168" text-anchor="middle" font-size="30" font-weight="700" fill="#d92d20" letter-spacing="6">${esc(o.status)}</text></g>` : ''}
  </svg>`
}

/** 旅行身份凭证（行者系列）：只画凭证里的旅行事实（等级 / 入会 / 行程 / 城市 / 徽章），不含姓名手机号身份证订单号金额。
 *  meta.uid 给了就可点：等级 / 行程 / 城市 / 徽章 都能点开看明细（uid=0 是示例卡，点了只提示） */
function vcCardSvg(claims, meta = {}) {
  let c = claims
  if (typeof c === 'string') { try { c = JSON.parse(c) } catch { c = {} } }
  c = c || {}
  if (CARD_ROLES[c.role]) {   // 角色凭证：按该角色的系列和等级出卡，只画凭证里有的事实
    const stats = c.role === 'creator' ? [{ label: '已发布内容', val: c.works ?? 0 }, { label: '已完成约稿', val: c.tasks ?? 0 }] : []
    const sub = c.role === 'merchant' ? [c.merchantName, c.position].filter(Boolean).join(' · ') : c.role === 'promoter' ? '一级推广 · 无层级' : '内容创作身份'
    return cardFace({ role: c.role, tier: cardTierOf(c.levelNo, cardTotal(c.role)), levelName: c.level, levelNo: c.levelNo, sub, stats,
      note: stats.length ? '' : '身份凭证：不含金额与联系方式', did: meta.did, exp: meta.exp, status: meta.status || '', uid: meta.uid })
  }
  const travel = c.scope === 'travel'
  return cardFace({
    role: 'traveler', tier: meta.tier || cardTierOf(c.levelNo, cardTotal('traveler')),
    levelName: c.level || '—', levelNo: c.levelNo, sub: `成长区间 ${c.growthBand || '—'} · 入会 ${c.memberSince || '—'}`,
    stats: travel ? [{ k: 'trips', label: '完成行程', val: c.trips ?? 0 }, { k: 'cities', label: '到访城市', val: c.cities ?? 0 }, { k: 'badges', label: '荣誉徽章', val: (c.badges || []).length }] : [],
    note: travel ? '' : '基础凭证：仅含等级与入会时间', chips: c.badges || [], chipKey: 'badges',
    did: meta.did, exp: meta.exp, status: meta.status || (meta.sample ? '示例' : ''), uid: meta.uid,
  })
}
/** 档案里的角色身份卡（创作者 / 推广服务商 / 商户）：统计是后台口径，比凭证披露得多；opt.vc 是这个角色的有效凭证 */
function roleCardSvg(card, opt = {}) {
  const v = opt.vc
  return cardFace({ role: card.role, tier: cardTierOf(card.rank, card.total), levelName: card.levelName, levelNo: card.rank, sub: card.sub,
    stats: card.stats || [], did: v ? opt.did : '', exp: v ? v.expires_at : '', status: v ? '有效' : '', foot: v ? '' : '未签发角色凭证' })
}
const SCOPE_CN = { travel: '旅行身份', basic: '基础身份', creator: '创作者', promoter: '推广服务商', merchant: '商户' }

/* ---- 卡面图鉴：每个角色系列的全部卡种；用不上的卡种标「预留」 ---- */
const CARD_DEMO = {
  traveler: { stats: [{ label: '完成行程', val: 12 }, { label: '到访城市', val: 5 }, { label: '荣誉徽章', val: 3 }], chips: ['初访古镇', '山海行者'], sub: '成长区间 · 入会时间' },
  creator: { stats: [{ label: '发布内容', val: 36 }, { label: '完成约稿', val: 8 }, { label: '真实评价', val: 21 }], sub: '内容创作身份' },
  promoter: { stats: [{ label: '有效 GMV', val: '¥12.8万' }, { label: '服务分', val: '4.9' }, { label: '佣金比例', val: '8%' }], sub: '一级推广 · 无层级' },
  merchant: { stats: [{ label: '有效订单', val: 268 }, { label: '综合评分', val: '4.8' }, { label: '商户徽章', val: 6 }], sub: '朱家角示例门店 · 老板' },
}
function vcGalleryHtml(role) {
  const scale = window.__cardScale || {}
  const levels = (scale[role] && scale[role].levels) || []
  const total = levels.length || cardTotal(role)
  const used = new Map()
  for (let r = 1; r <= total; r++) used.set(cardTierOf(r, total), levels[r - 1] || { lv: r, name: 'Lv.' + r, n: 0 })
  const R = CARD_ROLES[role], D = CARD_DEMO[role]
  const tiles = CARD_TIER_ORDER.map((tier) => {
    const lv = used.get(tier)
    return `<div class="vc-tile ${lv ? '' : 'reserved'}">${cardFace({ role, tier, levelName: lv ? lv.name : CARD_TIERS[tier].name, levelNo: lv ? lv.lv : '-', sub: D.sub, stats: D.stats, chips: D.chips || [], foot: '卡面示例', status: lv ? '' : '预留' })}
      <div class="vc-tile-t"><span class="tier-chip t-${tier}">${CARD_TIERS[tier].name}</span>${lv ? `<span>Lv.${Number(lv.lv)} ${esc(lv.name)}</span><b>${Number(lv.n) || 0} ${R.unit}</b>` : '<span class="muted">预留：等级加到 5 级后启用</span>'}</div></div>`
  }).join('')
  return `<div class="trust-tabs" style="margin-bottom:12px">${Object.entries(CARD_ROLES).map(([k, v]) => `<button class="trust-tab ${k === role ? 'on' : ''}" type="button" onclick="vcGallery('${k}')">${esc(v.label)}</button>`).join('')}</div>
    <div class="vc-tiles">${tiles}</div>`
}
function vcGallery(role) { const el = document.getElementById('vcGallery'); if (el) el.innerHTML = vcGalleryHtml(role) }

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
  const lvTag = (x) => { const tier = cardTierOf(x.levelNo, cardTotal('traveler')); return `<span class="tier-chip t-${tier}">${CARD_TIERS[tier].name}</span> <span class="td-sub">Lv.${x.levelNo} ${esc(x.levelName)}</span>` }
  const roleTags = (x) => (x.roles || []).map((k) => `<span class="role-tag" style="--c:${CARD_ROLES[k].color}">${esc(CARD_ROLES[k].label)}</span>`).join('')
  // 有头像用头像，没有就用昵称首字 + 按 id 取色；只接受 http(s) 或站内路径
  const ava = (x) => (/^(https?:\/\/|\/)/.test(String(x.avatar || ''))
    ? `<img class="id-ava" src="${esc(x.avatar)}" alt="" loading="lazy">`
    : `<span class="id-ava" style="background:hsl(${(Number(x.userId) * 47) % 360},45%,46%)">${esc(String(x.nickname || '?').slice(0, 1))}</span>`)
  return `<div class="muted" style="margin-bottom:8px">用户 <b>${r.summary.users}</b> · 旅豆账户 <b>${r.summary.beanAccounts}</b>（尚未产生旅豆的用户没有账户） · 持有效凭证 <b>${r.summary.vcHolders}</b> 位</div>
  ${r.rows.length ? `<table><thead><tr><th>用户</th><th>数字身份 DID</th><th>等级</th><th>旅豆账户（余额 / 累计）</th><th>徽章</th><th>行程</th><th>凭证</th><th>操作</th></tr></thead><tbody>
    ${r.rows.map((x) => `<tr>
      <td class="td-main"><div class="id-user">${ava(x)}<div>${esc(x.nickname)}<div class="td-sub">#${x.userId}${x.status === 1 ? '' : ' · 非正常'}${roleTags(x)}</div></div></div></td>
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
    const size = (document.getElementById('idSize') || {}).value || 12
    const r = await api('GET', '/admin/web3/identities?size=' + size + '&page=' + (page || 1) + '&q=' + encodeURIComponent(kw.trim()))
    window.__idPage = r.page
    box.innerHTML = idListHtml(r)
  } catch (e) { toast(e.message, true) }
}
/** 批量签发：先告诉你会签给多少人，确认后执行；每人一张，已有有效凭证的人跳过 */
async function vcBatchOpen() {
  const scope = (document.getElementById('vcBatchScope') || {}).value || 'travel'
  try {
    const p = await api('GET', '/admin/web3/vc/batch?scope=' + scope)
    if (!p.pending) return toast('没有需要签发的人：符合条件的都已有有效凭证', false)
    const n = Math.min(p.pending, p.max)
    modal('批量签发 · ' + esc(SCOPE_CN[scope]), `<p>将给 <b>${n}</b> 人各签发一张「${esc(SCOPE_CN[scope])}」凭证${p.pending > p.max ? `（共 ${p.pending} 人符合，单次最多 ${p.max} 人，可再次执行）` : ''}。</p>
      <p class="muted" style="margin-top:8px">已有有效凭证的人会跳过。每张都会写入审计和存证队列，下次打包合并成一个根上链；签发后可以逐张吊销。</p>`,
      `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="vcBatchRun('${scope}')">确认签发</button>`)
  } catch (e) { toast(e.message, true) }
}
async function vcBatchRun(scope) {
  closeModal()
  toast('正在批量签发…', false)
  try {
    const r = await api('POST', '/admin/web3/vc/batch', { scope })
    toast(`已签发 ${r.issued} 张${r.failed.length ? '，失败 ' + r.failed.length + ' 张：' + r.failed[0].reason : ''}${r.remaining ? '，还剩 ' + r.remaining + ' 人' : ''}`, r.failed.length > 0)
    vcPage()
  } catch (e) { toast(e.message, true) }
}
async function vcIssueFor(uid, scope) {
  const el = document.getElementById('vcUid'); if (el) el.value = uid
  const sc = document.getElementById('vcScope'); if (sc && scope) sc.value = scope
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
    <div class="vc-wallet">${vcCardSvg(d.claims, { uid: d.userId, did: d.did, exp: lastVc && lastVc.expires_at, status: st || '未签发' })}${(d.roleCards || []).map((rc) => { const v = d.vcs.find((x) => x.scope === rc.role && !x.revoked_at && new Date(x.expires_at) > new Date()); return `<div>${roleCardSvg(rc, { vc: v, did: d.did })}<div class="vc-card-act">${v ? `<span class="pill ok">角色凭证有效</span><span class="muted">至 ${esc(String(v.expires_at).slice(0, 10))}</span>` : `<button class="btn primary sm" type="button" onclick="closeModal();vcIssueFor(${d.userId},'${rc.role}')">签发${esc(CARD_ROLES[rc.role].label)}凭证</button>`}</div></div>` }).join('')}</div>
    <div class="muted" style="margin:6px 0 12px">点旅行身份卡上的等级 / 行程 / 城市 / 徽章，直接跳到对应明细。${(d.roleCards || []).length ? '角色卡上的统计是后台口径；签发出去的角色凭证只含身份与等级，不含金额。' : ''}下面是后台可见的完整档案；凭证本身只含最小披露字段。</div>
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
      ${section('vcs', '凭证记录', d.vcs.length, `${d.vcs.length ? `<table><thead><tr><th>#</th><th>范围</th><th>签发</th><th>到期</th><th>状态</th></tr></thead><tbody>${d.vcs.map((v) => `<tr><td class="num">${v.id}</td><td><span class="pill off">${esc(SCOPE_CN[v.scope] || v.scope)}</span></td><td class="td-sub">${T(v.issued_at)}</td><td class="td-sub">${T(v.expires_at)}</td><td>${v.revoked_at ? '<span class="pill s70">已吊销</span>' : (new Date(v.expires_at) > new Date() ? '<span class="pill ok">有效</span>' : '<span class="pill off">已过期</span>')}</td></tr>`).join('')}</tbody></table>` : none('还没有签发过凭证')}
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
  const canIssue = !!cap.assets
  const assetChains = (d.providers || []).filter((p) => p.capabilities.assets && p.provider !== 'mock' && p.id !== 'mock')
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h3>当前链：${esc(cur.label || cur.provider)} ${cur.mode === 'real' ? '<span class="pill ok">已接入</span>' : '<span class="pill warn">未接入（NOOP）</span>'}</h3><span class="muted">${cap.assets ? '这条链可以发行资产' : '这条链只做存证，不能发行资产'}</span></div>
    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr)">
      <div class="kpi"><div class="ico" style="background:var(--brand-soft)">⛓</div><div><div class="l">已发行</div><div class="v" style="font-size:18px">${d.issued}</div><div class="s">累计 ${d.total}</div></div></div>
      <div class="kpi"><div class="ico" style="background:#fdf3e0">⏳</div><div><div class="l">待发行</div><div class="v" style="font-size:18px">${d.pending}</div><div class="s">凭据到位后补发</div></div></div>
      <div class="kpi"><div class="ico" style="background:#fdecea">⚠️</div><div><div class="l">失败</div><div class="v" style="font-size:18px">${d.failed}</div><div class="s">可重试</div></div></div>
      <div class="kpi"><div class="ico" style="background:#e8effd">🧩</div><div><div class="l">当前链能力</div><div class="v" style="font-size:15px">${cap.assets ? '可发行' : '仅存证'}</div><div class="s">${cap.assets ? '可发行徽章/NFT' : '当前链只做存证'}</div></div></div>
    </div>
    <div class="muted" style="margin-top:10px">切换当前链、补凭据请到 <button class="ref-link" type="button" onclick="go('chainhub')">链接入中心</button>。${(cur.missing || []).length ? '当前缺：<b>' + esc(cur.missing.join('、')) + '</b>。' : ''}</div>
  </div>

  <div class="card">
    <div class="card-head"><h3>发行一件资产</h3><span class="muted">微信渠道被硬禁（D10）</span></div>
    ${canIssue ? '' : `<div class="asset-block"><b>${esc(cur.label || '当前链')}只做存证，现在不能发行资产。</b>
      要发行需要先接入支持资产的链${assetChains.length ? '：' + assetChains.map((p) => esc(p.label) + (p.mode === 'real' ? '（已配置）' : '（缺凭据）')).join('、') : ''}。
      <button class="btn ghost sm" type="button" onclick="go('chainhub')">去链接入中心</button></div>`}
    <div class="row${canIssue ? '' : ' row-off'}">
      <select id="akKind">${(d.kinds || []).map((k) => `<option value="${k.id}">${esc(k.label)}</option>`).join('')}</select>
      <select id="akChannel">${(d.channels || []).map((c) => `<option value="${c.id}" ${c.allowed ? '' : 'disabled'}>${esc(c.label)}${c.allowed ? '' : '（禁止）'}</option>`).join('')}</select>
      <input id="akUid" type="number" placeholder="用户 id" style="width:110px">
      <input id="akToken" placeholder="tokenId（可空）" style="width:140px">
      <input id="akName" placeholder="名称，如「瑜伽修行者」" style="width:200px">
      <button class="btn primary sm" onclick="issueAsset()" ${canIssue ? '' : 'disabled title="当前链不支持发行资产"'}>发行</button>
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
        <td>${r.status == 1 ? '—' : `<button class="btn ghost sm" onclick="retryAsset(${r.id})" ${canIssue ? '' : 'disabled title="当前链不支持发行资产"'}>重试</button>`}</td></tr>`).join('')}
    </tbody></table>` : emptyBox(canIssue ? '还没有发行记录：上方选类型与用户发行一件试试' : '还没有发行记录：当前链不能发行，接入支持资产的链后才会有')}
  </div>

  <div class="card">
    <div class="card-head"><h3>多链能力矩阵</h3><span class="muted">不同链能做不同的事：联盟链只存证，公链才发资产</span></div>
    <table><thead><tr><th>链</th><th>存证锚定</th><th>按根反查</th><th>资产发行</th><th>DID</th><th>状态</th></tr></thead><tbody>
    ${(d.providers || []).map((p) => `<tr>
      <td class="td-main" title="${esc(p.docs || '')}"><button class="ref-link" type="button" title="去链接入中心配置这条链" onclick="go('chainhub')">${esc(p.label)}</button>${p.current ? ' <span class="pill ok">当前</span>' : ''}</td>
      <td>${mark(p.capabilities.anchor)}</td><td>${mark(p.capabilities.queryByRoot)}</td>
      <td>${mark(p.capabilities.assets)}</td><td>${mark(p.capabilities.did)}</td>
      <td>${p.mode === 'real' ? '<span class="pill ok">已配置</span>' : '<span class="pill off">缺凭据</span>'}</td></tr>`).join('')}
    </tbody></table>
  </div>

  ${(c.preflight || []).length ? `
  <details class="card pipe-fold">
    <summary><h3>预埋体检</h3><span class="muted">离线自检 · 不需要凭据 · ${(c.summary || {}).ready}/${(c.summary || {}).total} 家通过</span></summary>
    <table><thead><tr><th>链</th><th>离线自检</th><th>凭据</th><th>必问对方</th></tr></thead><tbody>
    ${(c.preflight || []).filter((p) => p.id !== 'noop' && p.id !== 'mock').map((p) => `<tr>
      <td class="td-main"><button class="ref-link" type="button" title="去链接入中心补凭据 / 做连通性探测" onclick="go('chainhub')">${esc(p.label)}</button>${p.active ? ' <span class="pill ok">当前</span>' : ''}</td>
      <td>${p.selfOk ? '<span class="pill ok">通过</span>' : '<span class="pill warn">失败</span>'}</td>
      <td class="td-sub">${p.missing.length ? '缺 <b>' + esc(p.missing.join('、')) + '</b>' : '<span class="pill ok">齐备</span>'}</td>
      <td class="td-sub"><details><summary>${p.ask.length} 条</summary><ul style="margin:6px 0 0 16px;padding:0">${p.ask.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></details></td>
    </tr>`).join('')}
    </tbody></table>
    <div class="muted" style="margin-top:10px">填空模板：<code>api/config/chains/</code>（链数根 / 腾讯TBaaS / 蚂蚁链鲸探 / EVM公链），每份含「找谁要、接口约定、必问 4 问」。命令行同源：<code>node scripts/chain-preflight.mjs</code></div>
  </details>` : ''}`
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
/* 业务环节配色（全后台唯一定义）：区块、标签、图例、存证中心都从这里取。 */
const BIZ_COLOR = {
  bean_deduct: '#34d399', order: '#fbbf24', pass_issue: '#60a5fa', pass_verify: '#c084fc', bean_grant: '#2dd4bf',
  settlement: '#fb923c', refund: '#fb7185', badge: '#f472b6', vc_issue: '#67e8f9', vc_revoke: '#67e8f9', did_issue: '#67e8f9', kyc: '#67e8f9', consent: '#67e8f9',
  commission: '#fdba74', co_profit: '#fdba74', withdraw: '#fdba74', asset_issue: '#a5b4fc',
}
const BIZ_COLOR_OTHER = '#94a3b8', DAY_CLOSE_COLOR = '#e2e8f0'
const bizColor = (t) => BIZ_COLOR[t] || BIZ_COLOR_OTHER
const CHAIN_LEGEND = [['bean_deduct', '旅豆抵扣'], ['order', '订单支付'], ['pass_issue', '出票'], ['pass_verify', '核销'], ['bean_grant', '返豆'], ['settlement', '结算'], ['refund', '退款冲正'], ['badge', '勋章'], ['vc_issue', '身份 / 实名'], ['commission', '佣金 / 提现'], ['', '其他']]
/** 十六进制颜色 → 立方体用的四个 CSS 变量 */
function toneVars(hex) {
  const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255
  return `--edge:${hex};--fill:rgba(${r},${g},${b},.12);--core:rgba(${r},${g},${b},.58);--glow:rgba(${r},${g},${b},.5)`
}
/** 3D 区块：tone = gray | red（状态色）；opt.color = 业务主色；opt.faces = 各面颜色（一批含多种业务时六个面轮流上色）；opt.dim = 还没锚定；sm = 小号；pulse = 等待链上确认中 */
function cube3d(tone, opt = {}) {
  const cls = ['cube-zone', tone && tone !== 'blue' ? 't-' + tone : '', opt.sm ? 'sm' : '', opt.pulse ? 'pulse' : '', opt.ghost ? 'ghost' : '', opt.dim ? 'dim' : ''].filter(Boolean).join(' ')
  const zoneStyle = opt.color ? ` style="${toneVars(opt.color)}"` : ''
  const faces = opt.faces && opt.faces.length > 1 ? opt.faces : null
  // 特效层全部是 .cube3d 的兄弟节点：不参与 preserve-3d，加光晕/滤镜不会把立方体压平
  // 特效集中在区块本身：面网格 + 棱线流光 + 呼吸内核 + 悬停展开；外围只保留底座涟漪、一圈轨道和瞄准角标
  const fx = opt.ghost ? '' : '<span class="fx-ripple"></span><span class="fx-ripple r2"></span>'
    + '<span class="fx-orbit"><i></i></span>' + '<span class="fx-hud"></span>'
  return `<div class="${cls}"${zoneStyle}${opt.label ? '' : ' aria-hidden="true"'}>${fx}<div class="cube3d">`
    + Array.from({ length: 6 }, (_, i) => (faces ? `<div class="fc" style="${toneVars(faces[i % faces.length])}"></div>` : '<div class="fc"></div>')).join('') + '<div class="core">' + '<i></i>'.repeat(6) + '</div></div>'
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
    mix: kind === 'day' ? {} : Array.from({ length: leaves }, (_, i) => TYPES[(seq + i) % TYPES.length]).reduce((m, t) => { m[t] = (m[t] || 0) + 1; return m }, {}),
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
/** 批内业务按「主线优先」排：抵扣→订单→出票→核销→返豆→结算→退款；勋章 / 准入 / 审核这类旁路事件数量再多也排在后面 */
function blockMixSorted(b) {
  const rank = (k) => { const i = FLOW_ORDER.indexOf(k); return i < 0 ? 99 : i }
  return Object.entries(b.mix || {}).sort((a, c) => rank(a[0]) - rank(c[0]) || c[1] - a[1])
}
function blockMixHTML(b, max = 2, tier = 'md') {
  if (Number(b.is_day_close) === 1) return `<div class="blk-mix"><span class="mx day">${tier === 'sm' ? '封存' : '旅豆账本封存'}</span></div>`
  const ents = blockMixSorted(b)
  if (!ents.length) return '<div class="blk-mix"></div>'
  const shown = ents.slice(0, max)
  const rest = ents.slice(max).reduce((s, [, n]) => s + n, 0)
  return `<div class="blk-mix">${shown.map(([k, n]) => `<span class="mx" style="--c:${bizColor(k)}" title="${esc(BIZ_CN[k] || k)}">${esc(BLK_SHORT[k] || BIZ_CN[k] || k)} <b>${Number(n)}</b></span>`).join('')}${rest ? `<span class="mx more" title="其他业务类型 ${rest} 条">+${rest}</span>` : ''}</div>`
}
function blockNodeHTML(b, opt = {}) {
  const tier = opt.tier || 'md'
  const dayClose = Number(b.is_day_close) === 1
  const st = Number(b.status)
  const root8 = String(b.merkle_root).slice(0, 8)
  // 颜色 = 业务环节；只有两种情况压过业务色：还没打包（灰）、需要人处理（红）。已打包未锚定用半透明区分
  const alert = st === 3 || st === 4
  const tone = st === 0 ? 'gray' : alert ? 'red' : ''
  const colors = dayClose ? [DAY_CLOSE_COLOR] : [...new Set(blockMixSorted(b).map(([k]) => bizColor(k)))]
  const paint = tone ? {} : { color: colors[0] || BIZ_COLOR_OTHER, faces: colors, dim: st !== 2 }
  const cls = 'chain-node' + (dayClose ? ' branch' : '') + (st === 2 ? ' anchored' : '')
  // role=button + 键盘可达：只靠鼠标的人能点，只用键盘的人也得能开（无障碍不是装饰）
  return `<div class="${cls}" id="bnode-${b.id}" role="button" tabindex="0"
    aria-label="区块 ${Number(b.seq)}${dayClose ? ' 账本日终' : ''}，业务日 ${esc(String(b.biz_date).slice(0, 10))}，${Number(b.leaf_count)} 条事件，点击查看批内事件"
    onclick="openBlock(${b.id})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openBlock(${b.id})}"
    onmouseenter="chainTip(event, 'b', ${b.id})" onmousemove="chainTipMove(event)" onmouseleave="chainTipHide()" onfocus="chainTip(event, 'b', ${b.id})" onblur="chainTipHide()">
    ${cube3d(tone, { pulse: st === 5, ...paint })}
    <div class="blk-title">${dayClose ? '账本日终' : '区块'} #${b.seq}${b.prev_root ? '' : ' <span class="dpill genesis">创世</span>'}</div>
    <div class="blk-line"><span class="d-full">业务日 ${esc(String(b.biz_date).slice(0, 10))}</span><span class="d-short">${esc(String(b.biz_date).slice(5, 10))}</span></div>
    <div class="blk-line">事件 <b>${Number(b.leaf_count)}</b> 条<span class="x"> · ${dayClose ? '账本封存' : '业务存证'}</span></div>
    ${blockMixHTML(b, tier === 'sm' ? 1 : 2, tier)}
    <div class="blk-line blk-root">根 <code class="dk">${root8}…</code></div>
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
  // 纵向位置用 CSS 变量：--cy = 立方体中心线，--sink = 日终分支块下沉量；块缩小时两者一起变小
  const y = (p) => (p ? 'calc(var(--cy) + var(--sink))' : 'var(--cy)')
  const at = (p, d) => `calc(${y(p)} - ${d}px)`
  // <s> 是沿连线流动的数据包，表示"前一块的根被写进后一块的 prev_root"
  if (!!prevBranch === !!curBranch) return `<div class="chain-link"><i style="top:${at(curBranch, 1)}"></i><s style="top:${at(curBranch, 2)}"></s><s class="p2" style="top:${at(curBranch, 2)}"></s><u style="top:${at(curBranch, 11)}">»</u></div>`
  const down = !prevBranch && !!curBranch
  const edge = down ? 'border-top:2px dashed var(--cl);border-top-right-radius:12px' : 'border-bottom:2px dashed var(--cl);border-bottom-right-radius:12px'
  return `<div class="chain-link elbow"><i style="top:calc(var(--cy) - 1px);height:var(--sink);${edge};border-right:2px dashed var(--cl)"></i>
    <b style="top:${at(curBranch, 1)}"></b><s class="tail" style="top:${at(curBranch, 2)}"></s><u style="top:${at(curBranch, 11)}">▸</u></div>`
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
  const rows = (batches || []).slice(-8).reverse().map((b) => {   // batches 按 seq 升序：要看的是最新的 8 批
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
      <span class="muted">事件产生 → 本地 Merkle 打包 → 提交上链 → 出块 → 确认锚定；prev_root 把每批串成链</span>
      <span class="chip" style="margin-left:auto">在途 ${pending} 条待打包</span>
    </div>
    ${rows || '<div class="blk-line" style="padding:16px">还没有批次：到「存证中心」点「① 打包」就会走出第一步</div>'}
  </div>`
}

/**
 * 链路视图的 S 型（蛇形）排布：一行放不下就折行，奇数行从右往左，行尾用 U 形虚线转弯接到下一行行首。
 * 页面高度有上限：**最多 3 行、每行最多 10 块**。块少时用大块（188px）；放不下 3 行就按宽度把块缩小
 * （md / sm 两档，行高也跟着降），每行最多到 10 块。一页最多 30 块，更早的翻页看（见 chainPageSlice）。
 * 窗口窄到 10 块放不下时，每行块数按宽度来，行数才会超过 3（手机宽度的兜底，不是常态）。
 */
const CHAIN_MAX_ROWS = 3, CHAIN_MAX_PER = 10, CHAIN_PAGE = 30
function chainTrackWidth() {
  const app = document.getElementById('app')
  return Math.max(560, ((app && app.clientWidth) || 1200) - 36)
}
/**
 * 排布原则：**块的尺寸固定、行数尽量少、每行尽量多（最多 10 块）**。
 * 块宽（含说明）封顶 CHAIN_NODE_W = 132px，块少也不会放大；一行放不下就依次试 2 行、3 行；
 * 每行放得下的块数按面板宽度算，窄到 96px 以下就不再挤、改加行。3 行也放不下（块多、窗口窄）才缩到最小号，
 * 每行放满 10 块；窗口窄到 10 块都放不下时，每行块数按宽度来，行数才会超过 3（手机宽度的兜底）。
 * 档位：md（≥110px，说明带环节标签 2 个）、sm（<110px，只留 1 个标签）。
 */
const CHAIN_NODE_W = 132, CHAIN_MIN_OK = 96, CHAIN_MIN_W = 70
function chainPlan(n, W) {
  const plan = (per) => {
    const c = Math.floor((W - 80 - (per - 1) * 14) / per)
    if (c < CHAIN_MIN_W) return null
    const nw = Math.min(CHAIN_NODE_W, c)
    return { per, nw, lk: 14, tier: nw >= 110 ? 'md' : 'sm' }
  }
  for (let r = 1; r <= CHAIN_MAX_ROWS; r++) {
    const per = Math.ceil(n / r)
    if (per > CHAIN_MAX_PER) continue
    const p = plan(per)
    if (p && p.nw >= CHAIN_MIN_OK) return p
  }
  let per = Math.min(CHAIN_MAX_PER, Math.max(2, Math.ceil(n / CHAIN_MAX_ROWS)))
  while (per > 1 && !plan(per)) per--
  return plan(per) || { per: 1, nw: CHAIN_MIN_W, lk: 14, tier: 'sm' }
}
function chainTrackHTML(descs, W) {
  if (!descs.length) return '<div class="chain-track"><div class="blk-line" style="padding:30px">尚无区块：到「存证中心」点「① 打包」即可出根</div></div>'
  const plan = chainPlan(descs.length, W)
  const rows = []
  for (let i = 0; i < descs.length; i += plan.per) rows.push(descs.slice(i, i + plan.per))
  const html = rows.map((row, r) => {
    const inner = []
    row.forEach((d, i) => { if (i) inner.push(blockLinkHTML(row[i - 1].branch, d.branch)); inner.push(d.html || blockNodeHTML(d.b, { tier: plan.tier })) })
    const rev = r % 2 === 1, last = r === rows.length - 1
    const turn = last ? '' : (rev ? ' turn-l' : ' turn-r') + (rows[r + 1][0].branch ? ' turn-branch' : '')
    return `<div class="chain-row${rev ? ' rev' : ''}${last ? ' last' : ''}${turn}">${inner.join('')}</div>`
  }).join('')
  return `<div class="chain-track snake tier-${plan.tier}" style="--nw:${plan.nw}px;--lk:${plan.lk}px" data-rows="${rows.length}" data-per="${plan.per}" data-nw="${plan.nw}" data-tier="${plan.tier}">${html}</div>`
}
/**
 * 翻页：一页 30 块（第一页给「下一区块」占位留 1 格，所以是 29 批）。asc = 按 seq 升序、已含最新批的列表；
 * page 0 = 最新一页，page 1 = 再往前 30 批……接口一次最多回 200 批，所以最多翻到这里。
 */
function chainSeen(page) { return page <= 0 ? CHAIN_PAGE - 1 : CHAIN_PAGE - 1 + CHAIN_PAGE * page }
function chainFetchLimit(page) { return Math.min(200, chainSeen(page)) }
function chainPageSlice(asc, page) {
  const end = Math.max(0, asc.length - (page <= 0 ? 0 : chainSeen(page - 1)))
  return asc.slice(Math.max(0, end - (page <= 0 ? CHAIN_PAGE - 1 : CHAIN_PAGE)), end)
}
function chainPagerHtml(page, batches, total) {
  const seen = chainSeen(page), hasOlder = seen < total && seen < 200, hasNewer = page > 0
  return `<div class="chain-more">本页 #${Number(batches[0].seq)}–#${Number(batches[batches.length - 1].seq)} · 共 ${total} 批
    <button class="chain-btn" type="button" ${hasOlder ? '' : 'disabled'} onclick="chainPage(1)">← 更早 ${CHAIN_PAGE} 批</button>
    <button class="chain-btn" type="button" ${hasNewer ? '' : 'disabled'} onclick="chainPage(-1)">更新 ${CHAIN_PAGE} 批 →</button>
    ${seen >= 200 && seen < total ? '<span>（一次最多翻 200 批，更早的请用检索）</span>' : ''}</div>`
}
function chainPage(delta) { window.__chainPage = Math.max(0, (window.__chainPage || 0) + delta); web3dash({ silent: true }) }
/** 窗口尺寸变了：只重排链路（不重新请求接口） */
function chainRelayout() {
  const el = document.querySelector('#chainViz .chain-track'); if (!el || !window.__chainDescs) return
  const next = chainTrackHTML(window.__chainDescs, chainTrackWidth())
  const tmp = document.createElement('div'); tmp.innerHTML = next
  const n = tmp.firstElementChild
  if (n && (n.dataset.per !== el.dataset.per || n.dataset.nw !== el.dataset.nw)) { el.replaceWith(n); flowMarkChain() }   // 重排后重新标出"本单经过的区块"
}
if (typeof window.addEventListener === 'function' && !window.__chainResizeBound) {
  window.__chainResizeBound = true
  let t = null
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(chainRelayout, 180) })
}

async function web3dash(opt = {}) {
  if (!opt.silent) $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  if (window.__chainTimer) { clearInterval(window.__chainTimer); window.__chainTimer = null }
  const demo = !!window.__demoChain
  const page = demo ? 0 : Math.max(0, Number(window.__chainPage) || 0)
  const [d, c] = await Promise.all([api('GET', '/admin/web3/overview'), api('GET', '/admin/attest/center?batchLimit=' + chainFetchLimit(page))])
  const fetched = demo ? mockChain() : (c.batches || []).slice().sort((a, b) => a.seq - b.seq)
  const batches = demo ? fetched : chainPageSlice(fetched, page)
  if (!demo && page > 0 && !batches.length) { window.__chainPage = 0; return web3dash(opt) }   // 翻到的那页已经没有批次（数据变少了）：回到最新一页
  const pendingN = demo ? batches.filter((b) => Number(b.status) === 0).reduce((s, b) => s + Number(b.leaf_count), 0) : Number(d.pendingEvents)
  const anchorN = demo ? batches.filter((b) => Number(b.status) === 2).reduce((s, b) => s + Number(b.leaf_count), 0) : d.anchoredEvents
  const totalN = demo ? batches.reduce((s, b) => s + Number(b.leaf_count), 0) : d.events
  const lastSeq = fetched.length ? fetched[fetched.length - 1].seq : 0   // 区块高度永远取最新批，不随翻页变
  window.__chainMap = Object.fromEntries(batches.map((b) => [b.id, b]))
  const descs = []   // 链路节点描述：branch=账本日终（下沉一档的分支块），连线与换行由 chainTrackHTML 统一生成
  batches.forEach((b) => descs.push({ b, branch: Number(b.is_day_close) === 1 }))   // 节点按档位在 chainTrackHTML 里渲染
  if (Number(pendingN) > 0 && page === 0) {   // 「下一区块」只在最新一页出现
    descs.push({ branch: false, html: `<div class="chain-node ghost" role="presentation" aria-disabled="true"
      title="待打包队列：还没出根，所以点不开。到「存证中心」点「① 打包」出根后，这里才会变成可点的区块">${cube3d('gray', { ghost: true, label: '待打包<br><b>' + pendingN + '</b> 条' })}
      <div class="blk-title" style="opacity:.75">下一区块</div>
      <div class="blk-line" style="opacity:.7">小时级打包 · #${lastSeq + 1}</div>
      <div class="blk-line"><span class="node-lock">待打包 · 暂不可点</span></div></div>` })
  }
  window.__chainDescs = descs
  const auto = window.__chainAuto === undefined ? (window.__chainAuto = true) : window.__chainAuto
  // 自动刷新要无感：检索框里没提交的字、已展开的检索结果 / 区块详情都原样留住，页面不因重画而跳动
  const qEl = document.getElementById('attestQ')
  const typed = qEl ? (qEl.value ?? '') : (window.__attestQ || '')
  const keepHtml = (id) => (opt.silent ? ((document.getElementById(id) || {}).innerHTML || '') : '')
  const keepResult = keepHtml('attestResult'), keepBlock = keepHtml('blockDetail')
  const chainDone = batches.filter((b) => Number(b.status) === 2).length
  const chainBad = batches.filter((b) => [3, 4].includes(Number(b.status))).length
  $('#app').innerHTML = `
  <div class="card chain-ov">
    <div class="card-head"><h2>链上总览</h2><span class="muted">${esc(d.chainMode)} · 小程序内=旅豆积分，对外=链上权益凭证</span></div>
    <div class="as-bar">
      <input id="attestQ" class="as-input" value="${esc(typed)}" placeholder="订单号 / 批次 #12 / 交易哈希 / Merkle 根 / 凭证号 / 手机号 / 用户ID / DID"
        onkeydown="if(event.key==='Enter')attestSearch()">
      <button class="btn primary" onclick="attestSearch()">检索</button>
      <button class="btn ghost" onclick="loadFlowSample()">看一条真实单的六步</button>
    </div>
    <div class="as-hint">输入订单号会同时展开这单的六步。也能查旅豆流水 <code>bt-…</code>、结算单 <code>settle-…</code>、凭证 <code>pass-1</code>、用户 <code>user:12</code></div>
    <div id="attestResult"></div>
    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr);margin:14px 0 0">
      <div class="kpi go" ${dxKey} title="去存证中心" onclick="go('attest')"><i class="go-arrow">↗</i><div class="ico" style="background:var(--brand-soft)">⛓</div><div><div class="l">锚定批次</div><div class="v" style="font-size:18px">${d.anchoredBatches}/${d.batches}</div><div class="s">Merkle 小时级打包</div></div></div>
      <div class="kpi go" ${dxKey} title="去存证中心" onclick="go('attest')"><i class="go-arrow">↗</i><div class="ico" style="background:#e8effd">🔗</div><div><div class="l">链上事件</div><div class="v" style="font-size:18px">${d.anchoredEvents}/${d.events}</div><div class="s">待打包 ${d.pendingEvents}</div></div></div>
      <div class="kpi go" ${dxKey} title="去徽章管理" onclick="go('badges')"><i class="go-arrow">↗</i><div class="ico" style="background:#fdf3e0">🏅</div><div><div class="l">勋章发放</div><div class="v" style="font-size:18px">${d.badgeGrants}</div><div class="s">发放即入存证队列</div></div></div>
      <div class="kpi go" ${dxKey} title="去旅豆发行台账" onclick="go('pointassets')"><i class="go-arrow">↗</i><div class="ico" style="background:#e3f6ec">🫘</div><div><div class="l">累计发放旅豆</div><div class="v" style="font-size:18px">${d.beanGranted}</div><div class="s">已消耗 ${d.beanConsumed}</div></div></div>
    </div>
    <div class="row" style="margin-top:10px">${(d.trustPath || []).map((t) => `<span class="pill off">${esc(t)}</span>`).join('<span class="muted">→</span>')}<span class="muted" style="margin-left:auto">上链的只有哈希指纹+时间戳，业务数据全在 MySQL（数据库是事实来源，链是审计锚点）</span></div>
  </div>
  <div class="chain-panel" id="chainViz">
    <div class="chain-glow"></div>
    <div class="chain-head">
      <span class="chain-name">⛓ 向往自由链 · 链路视图</span><span class="chain-live"><i></i>LIVE</span>
      ${demo ? '<span class="chip demo">演示数据</span>' : ''}
      <span class="chip">适配器 ${esc((d.chain && d.chain.label) || '—')}</span>
      <span class="chip">区块高度 <b>#${lastSeq}</b></span>
      <span class="chip">待打包 <b>${pendingN}</b></span>
      <span style="flex:1"></span>
      <label class="chain-auto"><input type="checkbox" id="chainAuto" ${auto ? 'checked' : ''} onchange="window.__chainAuto=this.checked;chainTimerSetup()"> 30s 自动刷新</label>
      <button class="chain-btn ${demo ? 'demo-on' : ''}" onclick="toggleDemoChain()">${demo ? '退出演示' : '演示 · 多节点形态'}</button>
      <button class="chain-btn" onclick="web3dash()">刷新 ↻</button>
    </div>
    ${demo ? '<div class="chain-demo-note">演示模式：以下为模拟数据，仅预览多节点链路形态，不代表真实链上状态</div>' : ''}
    <div id="flowSec" class="flow-sec" hidden>
      <div class="flow-head">
        <span class="chain-name" style="font-size:13px">🧭 单流程视角 · 一单六锚</span>
        <span id="flowMeta" style="flex:1;font-size:12px;color:#9db1e2"></span>
        <button class="chain-btn" onclick="flowClose()">收起</button>
      </div>
      <div id="flowTrack"></div>
      <div class="chain-divider"></div>
    </div>
    ${chainTrackHTML(descs, chainTrackWidth())}
    ${!demo && Number(d.batches) > batches.length && batches.length ? chainPagerHtml(page, batches, Number(d.batches)) : ''}
    <div class="chain-legend">
      ${CHAIN_LEGEND.map(([k, n]) => `<span><i class="lg" style="background:${bizColor(k)}66;border:1px solid ${bizColor(k)}"></i>${n}</span>`).join('')}
      <span><i class="lg" style="background:${DAY_CLOSE_COLOR}66;border:1px solid ${DAY_CLOSE_COLOR}"></i>账本日终（分支）</span>
      <span><i class="lg dash"></i>待打包</span>
      <span class="muted" style="margin-left:auto;color:#7f92bd">一批含多种业务时六个面分别上色 · 半透明 = 还没锚定 · 点击区块查看批内事件</span>
    </div>
  </div>
  <div id="blockDetail"></div>
  <details class="card pipe-fold" ${window.__pipeOpen ? 'open' : ''} ontoggle="window.__pipeOpen=this.open">
    <summary><h3>上链流水线</h3><span class="muted">共 ${batches.length} 批 · 已确认 ${chainDone} 批${chainBad ? ` · <b style="color:#b42318">${chainBad} 批异常</b>` : ''} · 点开看每批走到哪一段</span></summary>
    ${pipelineHtml(batches, (c && c.queue) || [], demo)}
  </details>
  <div class="card">
    <div class="card-head"><h3>链上事件动态</h3><button class="btn ghost sm" onclick="go('attest')">进入存证中心 ›</button></div>
    <table><thead><tr><th>类型</th><th>业务单号</th><th>状态</th><th>时间</th></tr></thead><tbody>
    ${(d.recentEvents || []).map((e) => `<tr><td>${bizTag(esc(e.biz_type))}</td><td class="num">${evRefLink(e)}</td>
      <td>${e.status === 2 ? '<span class="pill ok">已锚定</span>' : (e.status === 1 ? '<span class="pill s20">已打包·待锚定</span>' : '<span class="pill warn">待打包</span>')}</td>
      <td class="td-sub">${esc(String(e.created_at).slice(5, 19))}</td></tr>`).join('') || '<tr><td colspan="4" class="td-sub">暂无事件</td></tr>'}
    </tbody></table>
  </div>`
  if (keepResult) document.getElementById('attestResult').innerHTML = keepResult
  if (keepBlock) document.getElementById('blockDetail').innerHTML = keepBlock
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
    // 正在检索框里打字就不刷；自动刷新走静默模式，不闪骨架屏、不丢滚动位置
    if (document.activeElement && document.activeElement.id === 'attestQ') return
    web3dash({ silent: true })
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
      <span>Merkle 根 <code>${esc(b.merkle_root)}</code><button class="copy-chip" title="复制完整根" onclick="copyText('${escJs(b.merkle_root)}')">复制</button></span>
      <span>前根 ${b.prev_root ? `<code>${esc(b.prev_root)}</code><button class="copy-chip" title="复制前根" onclick="copyText('${escJs(b.prev_root)}')">复制</button>` : '<code>—（链起点）</code>'}</span>
      ${b.chain_tx_ref ? `<span>链上编号 <code>${esc(b.chain_tx_ref)}</code><button class="copy-chip" title="复制交易哈希" onclick="copyText('${escJs(b.chain_tx_ref)}')">复制</button></span>` : ''}
      ${b.chain_block ? `<span>链上块高 <code>${esc(b.chain_block)}</code></span>` : ''}
      ${b.anchored_at ? `<span>锚定时间 ${esc(String(b.anchored_at).slice(0, 19))}</span>` : ''}
      <span>尝试 ${Number(b.attempt) || 0} 次</span>
      ${!demo && Number(b.is_day_close) ? `<a class="btn ghost sm" target="_blank" rel="noopener" href="/open/report/bean-day/${esc(String(b.biz_date).slice(0, 10))}">封存证明 PDF</a>
        <a class="btn ghost sm" target="_blank" rel="noopener" href="/verify?date=${esc(String(b.biz_date).slice(0, 10))}">公开复核</a>` : ''}
    </div>
    <table style="margin-top:10px"><thead><tr><th>叶序</th><th>类型</th><th>业务单号</th><th>版本</th><th>payload 指纹</th><th>状态</th><th>时间</th><th></th></tr></thead><tbody>
    ${evs.map((e) => `<tr><td class="num">${Number(e.leaf_index)}</td><td>${bizTag(esc(e.biz_type))}</td>
      <td class="num">${esc(e.biz_ref)}</td><td class="num">v${Number(e.version_no ?? 1)}</td>
      <td class="td-sub"><code>${esc(String(e.payload_hash).slice(0, 12))}…</code></td>
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
  if (!e) return `<div class="chain-node ghost" aria-disabled="true"
    title="这一步还没入存证队列，所以点不开；业务发生后会自动出现在这里">
    ${cube3d('gray', { ghost: true, sm: true, label: '待产生' })}
    <div class="blk-title">${s.no} ${esc(s.label)}</div><div class="blk-line">${esc(s.hint)}</div>
    <div class="blk-line"><span class="node-lock">待产生 · 暂不可点</span></div></div>`
  const st = Number(e.status)
  return `<div class="chain-node" id="fnode-${i}" role="button" tabindex="0"
    aria-label="第 ${i + 1} 步 ${esc(s.label || '')}，点击查看本步证明"
    onclick="openFlowStep(${i})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();openFlowStep(${i})}"
    onmouseenter="chainTip(event, 'f', ${i})" onmousemove="chainTipMove(event)" onmouseleave="chainTipHide()" onfocus="chainTip(event, 'f', ${i})" onblur="chainTipHide()">
    ${cube3d('', { sm: true, color: bizColor(e.biz_type), dim: st !== 2 })}
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
      ${cube3d('', { sm: true, color: bizColor('refund') })}
      <div class="blk-title">退款冲正</div>
      <div class="blk-line">${esc(e.biz_ref)} · ${yuan(e.amount || 0)}</div>
      <div class="blk-line">${FLOW_ST[Number(e.status)] || ''}</div></div>`)
  })
  const track = document.getElementById('flowTrack')
  const marks = flowMarkChain()
  const sec = document.getElementById('flowSec'); if (sec) sec.hidden = false
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
      <div class="card-head"><h3>没查到「${esc(r.q)}」</h3><span class="muted">换一种标识试试 <button class="btn ghost sm" onclick="attestClear()">收起</button></span></div>
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
      <button class="btn ghost sm" onclick="loadFlow(${w3Arg(o.orderNo)},{scroll:true})">看这单的六步 ›</button>`)
  }
  if (r.user) {
    const u = r.user
    obj.push(`<span class="pill s20">用户</span> <b>#${u.id} ${esc(u.nickname || '')}</b>
      <span class="muted">等级 L${Number(u.memberLevel)}</span>
      ${u.did ? `<span class="muted">DID <code>${esc(u.did)}</code><button class="copy-chip" onclick="copyText('${escJs(u.did)}')">复制</button></span>` : '<span class="muted">未签发 DID</span>'}`)
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
      ${b.chain_tx_ref ? `<code class="sr-tx">链上 ${esc(String(b.chain_tx_ref).slice(0, 16))}…</code><button class="copy-chip" onclick="copyText('${escJs(b.chain_tx_ref)}')">复制哈希</button>` : '<span class="muted">未上链</span>'}
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
      <span class="muted">按${(r.matched || []).map((x) => `<code>${esc(x)}</code>`).join(' / ')}命中 · 链 ${esc((r.chain && r.chain.label) || '—')} <button class="btn ghost sm" onclick="attestClear()">收起</button></span></div>
    ${obj.length ? `<div class="sr-obj">${obj.join('')}</div>` : ''}
    ${batches ? `<div class="sr-sec">命中的批次（${(r.batches || []).length}）</div>${batches}` : ''}
    ${evs ? `<div class="sr-sec">命中的存证事件（${(r.events || []).length}）</div>
      <table><thead><tr><th>类型</th><th>业务单号</th><th>版本</th><th>状态</th><th>批次</th><th>载荷指纹</th><th>时间</th><th></th></tr></thead><tbody>${evs}</tbody></table>` : ''}
    ${cap.noContract ? `<div class="muted" style="margin-top:8px;color:#98712a">${esc(cap.noContract)}</div>` : ''}
  </div>`
}
function attestClear() {
  window.__attestQ = ''
  const el = document.getElementById('attestQ'); if (el) el.value = ''
  const box = document.getElementById('attestResult'); if (box) box.innerHTML = ''
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
    const r = await api('GET', '/admin/attest/search?q=' + encodeURIComponent(v))
    box.innerHTML = attestResultHtml(r)
    if (r.order && !opt.silent) loadFlow(r.order.orderNo)   // 搜到订单：不用再点一次，六步直接展开、区块直接标出来
  } catch (e) {
    box.innerHTML = `<div class="card" style="background:#fff8ec"><b>检索失败</b><div class="muted">${esc(e.message)}</div></div>`
  }
}

async function loadFlow(orderNo, opt = {}) {
  const no = String(orderNo || '').trim()
  if (!no) return toast('请输入订单号', true)
  try {
    renderFlow(await api('GET', '/admin/attest/flow/' + encodeURIComponent(no)))
    if (opt.scroll) { const sec = document.getElementById('flowSec'); if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
  } catch (e) {
    // 后端口径是"订单不存在"，运营看不出是单号错了还是系统坏了 → 补上下文
    toast(/订单不存在|1004/.test(e.message) ? `没找到订单 ${no}：核对单号是否完整` : e.message, true)
  }
}
/** 看一条真实单的六步：取最近一笔有订单存证的真实订单；一笔都没有才退回演示数据（并明说） */
async function loadFlowSample() {
  if (window.__demoChain) return loadFlowDemo()   // 正在看演示链：就看落在演示链上的那一单
  try {
    const c = await api('GET', '/admin/attest/center')
    if (c.latestOrder) return loadFlow(c.latestOrder, { scroll: true })
  } catch (e) { /* 取不到就走演示 */ }
  toast('还没有真实订单的存证，先用演示数据看形态')
  loadFlowDemo()
}
/** 演示完整流程：演示单的每一步都落在「演示 · 多节点形态」那条模拟链的区块里（批次号、状态、日期一一对应），两个视图看到的是同一批区块 */
async function loadFlowDemo() {
  const chainBlk = Object.fromEntries(mockChain().map((b) => [b.seq, b]))
  const mk = (no, ref, label, hint, seq, t, st, type) => ({ no, label, hint, ev: { biz_type: type, biz_ref: ref, version_no: 1, status: st, batch_id: chainBlk[seq].id, payload_hash: 'f0' + String(seq).padStart(2, '0') + 'a1b2c3d4e5f60718', created_at: t, seq, merkle_root: chainBlk[seq].merkle_root } })
  window.__flowData = {
    demo: true,
    order: { orderNo: 'WL20261101DEMO01', status: 50, statusText: '已完成', productName: '朱家角水乡沉浸一日（演示）', qty: 2, amountPay: 39800, beanDeducted: 200, createdAt: '2026-10-28 10:02:11', paidAt: '2026-10-28 10:03:05', completedAt: '2026-10-30 15:40:22' },
    steps: [
      mk('①', 'bt-DEMO1001', '旅豆抵扣', '下单锁豆', 3, '2026-10-28 10:02:30', Number(chainBlk[3].status), 'bean_deduct'),
      mk('②', 'WL20261101DEMO01', '支付成功', '订单事实入链', 3, '2026-10-28 10:03:05', Number(chainBlk[3].status), 'order'),
      mk('③', 'pass-901', '出票', '权益凭证 ×2', 4, '2026-10-29 10:03:40', Number(chainBlk[4].status), 'pass_issue'),
      mk('④', 'pass-901-1', '核销', '到店扫码', 4, '2026-10-29 11:25:02', Number(chainBlk[4].status), 'pass_verify'),
      mk('⑤', 'bt-DEMO1002', '返豆', '消费奖励', 6, '2026-10-30 15:40:22', Number(chainBlk[6].status), 'bean_grant'),
      mk('⑥', 'settle-31', '结算', '五口径分账', 7, '2026-10-31 01:00:10', Number(chainBlk[7].status), 'settlement'),
    ],
    refunds: [],
  }
  window.__flowShown = true
  if (!window.__demoChain) { window.__demoChain = true; await web3dash() } else renderFlow(window.__flowData)
}
/** 收起单流程：连同链路视图上的步骤角标一起清掉 */
function flowClose() {
  window.__flowData = null; window.__flowShown = false; window.__openFlowStep = undefined
  const sec = document.getElementById('flowSec'); if (sec) sec.hidden = true
  flowMarkChain()
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
      <span>Merkle 根 <code>${e.merkle_root ? esc(String(e.merkle_root).slice(0, 24)) + '…' : '—'}</code>${e.merkle_root ? `<button class="copy-chip" title="复制完整根" onclick="copyText('${escJs(e.merkle_root)}')">复制</button>` : ''}</span>
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
  const BIZ = { 1: '消费返豆', 2: '任务奖励', 3: '内容奖励', 4: '下单抵扣', 5: '退款冲正', 6: '过期回收', 7: '风控调整', 8: '期初余额导入' }
  const cap = d.globalCap || {}
  const capTotal = Number(cap.cap_total || cap.total || 0), capUsed = Number(cap.issued_sum || cap.granted || 0)
  const capPct = capTotal ? Math.min(100, capUsed / capTotal * 100) : 0
  const num = (n) => Number(n || 0).toLocaleString()
  const biz = d.byBiz || []
  const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '') + num(Math.abs(n))
  const totIn = biz.reduce((s, x) => s + Number(x.userIn || 0), 0), totOut = biz.reduce((s, x) => s + Number(x.userOut || 0), 0), totN = biz.reduce((s, x) => s + Number(x.entries || 0), 0)
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h3>发行概况</h3><span class="muted">旅豆 = 向往自由链积分资产（D6 外层口径）</span></div>
    <div class="cap-box">
      <div class="cap-t"><span>${esc(cap.year || '')} 年度发行额度（严禁超发）</span><b>${num(capUsed)} / ${num(capTotal)}</b></div>
      <div class="cap-bar"><i style="width:${capPct}%"></i></div>
      <div class="cap-s">已用 ${capPct.toFixed(capPct < 1 ? 2 : 1)}% · 剩余 ${num(Math.max(0, capTotal - capUsed))} · 账本双分录，超额度发放会被拒绝</div>
    </div>
    <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:0">
      <div class="kpi go" title="去数字身份：按用户看身份档案、旅豆账户与徽章" onclick="go('vc')"><i class="go-arrow">↗</i><div class="ico" style="background:#fdf3e0">👥</div><div><div class="l">旅豆账户数</div><div class="v" style="font-size:18px">${d.holders}</div><div class="s">点开看每个账户的身份档案</div></div></div>
      <div class="kpi"><div class="ico" style="background:#e3f6ec">🫘</div><div><div class="l">用户持有</div><div class="v" style="font-size:18px">${num(d.userBalance)}</div><div class="s">真实用户余额合计</div></div></div>
      <div class="kpi"><div class="ico" style="background:#e8effd">📈</div><div><div class="l">用户累计获得</div><div class="v" style="font-size:18px">${num(d.userLifetime)}</div><div class="s">不含预算 / 平台户</div></div></div>
      <div class="kpi"><div class="ico" style="background:var(--brand-soft)">📦</div><div><div class="l">发行批次</div><div class="v" style="font-size:18px">${(d.budgets || []).length}</div><div class="s">按批次预算发行</div></div></div>
    </div>
    ${d.calibers ? `<div class="note" style="margin-top:12px;border:1px solid #f1e1ca;background:#fffaf1;border-radius:9px;padding:10px 12px">
      <b>口径说明（四个数不要混用）</b>：预算登记累计 <b class="num">${num(d.calibers.budgetGranted)}</b>（批次额度内已发放的登记数）·
      账本业务发放累计 <b class="num">${num(d.calibers.bizGranted)}</b>（双分录可逐笔追溯）·
      期初导入累计 <b class="num">${num(d.calibers.openingImported)}</b>（历史余额一次性入账，业务号可识别）·
      当前留存累计 <b class="num">${num(d.calibers.retained)}</b>。${d.calibers.gap > 0 ? `差额 <b class="num">${num(d.calibers.gap)}</b> 为历史来源待核对（${esc(d.calibers.note)}）` : esc(d.calibers.note)}
    </div>` : ''}
  </div>
  <div class="card">
    <div class="card-head"><h3>按业务汇总（真实用户）</h3><span class="muted">只算用户账户这一侧；预算户、平台户不计入。右列是全账本双分录校验</span></div>
    ${biz.length ? `<table><thead><tr><th>业务</th><th>用户入账</th><th>用户出账</th><th>净额</th><th>笔数</th><th>双分录校验</th></tr></thead><tbody>
    ${biz.map((x) => { const net = Number(x.userIn || 0) - Number(x.userOut || 0); return `<tr><td class="td-main">${esc(BIZ[x.biz_type] || ('类型' + x.biz_type))}</td>
      <td class="num">${num(x.userIn)}</td><td class="num">${num(x.userOut)}</td><td class="num" style="color:${net > 0 ? '#17824d' : net < 0 ? '#b42318' : 'inherit'}">${signed(net)}</td><td class="num">${num(x.entries)}</td>
      <td>${Number(x.issued) === Number(x.burned) ? `<span class="pill ok" title="贷 ${num(x.issued)} = 借 ${num(x.burned)}">平衡</span>` : `<span class="pill s70" title="贷 ${num(x.issued)} ≠ 借 ${num(x.burned)}">不平</span>`}</td></tr>` }).join('')}
    <tr class="att-total"><td>合计</td><td class="num">${num(totIn)}</td><td class="num">${num(totOut)}</td><td class="num">${signed(totIn - totOut)}</td><td class="num">${num(totN)}</td><td></td></tr>
    </tbody></table>` : emptyBox('还没有旅豆流水')}
  </div>
  <div class="card">
    <div class="card-head"><h3>发行批次</h3><span class="muted">点一行去预算管理</span></div>
    <table><thead><tr><th>批次</th><th>名称</th><th>额度</th><th>已发放</th><th style="width:22%">使用进度</th><th>回流</th><th>状态</th></tr></thead><tbody>
    ${(d.budgets || []).map((b) => { const used = Number(b.total) ? Math.min(100, Number(b.granted) / Number(b.total) * 100) : 0; return `<tr class="click-row" ${dxKey} title="去预算管理查看这个批次" onclick="go('budgets')"><td>#${b.id}</td><td>${esc(b.name || '—')}</td><td class="num">${num(b.total)}</td>
      <td class="num">${num(b.granted)}</td><td><div class="att-bar"><i style="width:${used}%"></i></div><span class="td-sub">${used.toFixed(used < 1 && used > 0 ? 2 : 0)}%</span></td><td class="num">${num(b.returned)}</td>
      <td>${b.status === 1 ? '<span class="pill ok">启用</span>' : '<span class="pill s70">停用</span>'}</td></tr>` }).join('') || '<tr><td colspan="7" class="td-sub">暂无批次</td></tr>'}
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
      <td><img src="${pf.icon_img ? esc(pf.icon_img) : '/badge-art/' + b.id + (cat === 'mlevel' ? '.png' : '.svg') + (isMBadge(b) ? '?v=merchant-metal-20261108' : '')}" width="52" height="52" alt=""></td>
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
    <div class="card-head"><h3>商户等级徽章</h3><span class="muted">等级名、订单 / 评价 / 评分 / 退款率门槛、权益说明在「参数中心 → 商户经营等级体系」修改（双人复核）；徽章图形随等级自动变化（现有四级采用铜 / 银 / 金 / 钻石奖牌，经营门槛不变）</span></div>
    <div class="row" style="gap:18px;flex-wrap:wrap">${(mlvs || []).map((l) => `<div style="text-align:center;width:150px"><img src="/badge-art/mlevel/${l.lv}.png?v=merchant-metal-20261108" width="112" height="112" alt=""><div><b>Lv${l.lv} ${esc(l.name)}</b></div><div class="td-sub">订单 ≥${l.minOrders} · 评价 ≥${l.minReviews}</div><div class="td-sub">${l.minRating ? '评分 ≥' + l.minRating / 10 : '不限评分'} · 退款率 ≤${l.maxRefundPct}%</div></div>`).join('')}</div>
  </div>
  <div class="card">
    <div class="card-head"><h3>金属授勋材质预览</h3><span class="muted">铜、银、金、钻石对应现有四档；黑金图稿已备好，尚未绑定新增经营等级</span></div>
    <div class="row" style="gap:20px;flex-wrap:wrap">${[['bronze','铜牌'],['silver','银牌'],['gold','金牌'],['diamond','钻石'],['blackgold','黑金']].map(([metal,name])=>`<div style="text-align:center;width:150px"><img src="/badge-art/mlevel/1.png?metal=${metal}&v=merchant-metal-20261108" width="128" height="128" alt="${name}授勋奖牌"><div><b>${name}</b></div></div>`).join('')}</div>
    <div class="card-head" style="margin-top:24px"><h3>设计预览 · 各类徽章 × 稀有度</h3><span class="muted">每一类有自己的造型与材质；游客可信勋章保留既有样式</span></div>
    ${[['city', 'bridge', '城市徽章 · 朱红印章'], ['country', 'flag', '国家徽章 · 护照出入境章'], ['trusted', 'seal', '链上勋章 · 玻璃质感'], ['trusted', 'shieldcheck', '商户可信 · 林绿盾章', 'merchant'], ['member', 'heart', '会员荣誉 · 月桂缎带'], ['mhonor', 'store', '商户荣誉 · 暖色珐琅奖章'], ['journey', 'ticket', '旅程 · 盾牌'], ['explore', 'compass', '足迹 · 六边形'], ['creator', 'pen', '创作 · 花边圆章']].map(([c, ic, n, audience]) => `<div class="row" style="gap:12px;align-items:center;margin-bottom:6px"><span class="muted" style="width:150px">${n}</span>${['common', 'rare', 'epic', 'legend'].map((r) => `<img src="/badge-art/preview.svg?category=${c}&rarity=${r}&icon_key=${ic}&country_code=CN&seed=${c}${r}&audience=${audience || 'tourist'}&v=merchant-metal-20261108" width="72" height="72" alt="" title="${BADGE_RAR[r]}">`).join('')}</div>`).join('')}
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
