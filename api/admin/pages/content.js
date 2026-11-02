// 内容运营：内容审核、约稿任务、创作者池、常见问题、轮播
// 普通脚本（非模块）：与 core.js 共享全局作用域，加载顺序见 index.html

/* ============ 内容审核（笔记 + 线路评价） ============ */
async function content() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  const [rows, rvs] = await Promise.all([api('GET', '/admin/content'), api('GET', '/admin/reviews')])
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>笔记审核</h2><span class="muted">P0 笔记只读 · P1 开放发布后进入此队列（机审+人工）</span></div>
    ${rows.length ? `<table><thead><tr><th>作者</th><th>标题</th><th>内容</th><th>状态</th><th>时间</th><th>操作</th></tr></thead><tbody>
    ${rows.map((n) => `<tr><td>${esc(n.nickname)}${n.creator_tag && n.creator_tag !== 'none' ? ` <span class="pill ${n.creator_tag === 'star' ? 'ok' : (n.creator_tag === 'limited' ? 's70' : 's40')}">${CREATOR_TAG[n.creator_tag] || ''}</span>` : ''}</td><td class="td-main">${esc(n.title || '（无题）')}</td>
      <td class="td-sub" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(String(n.body).slice(0, 50))}</td>
      <td>${['<span class="pill warn">机审中</span>', '<span class="pill s20">人工审核</span>', '<span class="pill ok">已发布</span>', '<span class="pill s70">已驳回</span>', '<span class="pill off">已下架</span>'][n.status]}</td>
      <td class="td-sub">${esc(String(n.created_at).slice(5, 16))}</td>
      <td>${[0, 1].includes(n.status) ? `<button class="btn primary sm" onclick="verdict('content', ${n.id}, true)">通过</button>
        <button class="btn danger sm" onclick="verdict('content', ${n.id}, false)">驳回</button>` : ''}</td></tr>`).join('')}
    </tbody></table>` : emptyBox('暂无待审内容（P1 开放笔记发布后进入此队列）')}
  </div>
  <div class="card">
    <div class="card-head"><h2>线路评价管理</h2><span class="muted">游客核销后一单一评 · 文本已过机审 · 可隐藏违规/刷评</span></div>
    ${rvs.length ? `<table><thead><tr><th>用户</th><th>线路</th><th>评分</th><th>内容</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${rvs.map((r) => `<tr><td>${esc(r.nickname)}</td><td class="td-main">${esc(r.title)}</td>
      <td class="num" style="color:var(--brand);font-weight:700">${r.rating} ★</td>
      <td class="td-sub" style="max-width:320px">${esc(r.content)}</td>
      <td><span class="pill ${r.status === 1 ? 'ok' : 'off'}">${r.status === 1 ? '展示中' : '已隐藏'}</span></td>
      <td><button class="btn ${r.status === 1 ? 'danger' : 'primary'} sm" onclick="toggleReview(${r.id}, ${r.status === 1 ? 0 : 1})">${r.status === 1 ? '隐藏' : '恢复展示'}</button></td></tr>`).join('')}
    </tbody></table>` : emptyBox('还没有评价——游客核销完成后可评价')}
  </div>`
}
async function toggleReview(id, show) {
  try { await api('POST', `/admin/reviews/${id}/hide`, { show }); content() } catch (e) { toast(e.message, true) }
}


/* ============ 约稿任务管理 ============ */
// ---- 富表单共享组件：富文本编辑器 / 单图上传（各页复用）----
async function tasks() {
  $('#app').innerHTML = '<div class="card"><div class="sk" style="height:120px"></div></div>'
  const [list, prods] = await Promise.all([api('GET', '/admin/content-tasks'), api('GET', '/admin/products')])
  const ST = { 0: '<span class="pill warn">待领取</span>', 1: '<span class="pill s20">进行中</span>', 2: '<span class="pill s30">审核中</span>', 3: '<span class="pill ok">已完成</span>' }
  const cnt = (s) => list.filter((t) => t.status === s).length
  const beans = list.reduce((s, t) => s + Number(t.reward_beans) || 0, 0)
  const cash = list.reduce((s, t) => s + Number(t.cash_reward) || 0, 0)
  window.__taskSt = window.__taskSt === undefined ? '' : window.__taskSt
  const frs = window.__taskSt === '' ? list : list.filter((t) => String(t.status) === window.__taskSt)
  const TABS = [['', '全部'], ['0', '待领取'], ['1', '进行中'], ['2', '审核中'], ['3', '已完成']]
  $('#app').innerHTML = `
  <div class="kpi-grid" style="grid-template-columns:repeat(5,1fr);margin-bottom:16px">
    <div class="kpi"><div class="ico" style="background:#fdf3e0">📢</div><div><div class="l">待领取</div><div class="v" style="font-size:20px">${cnt(0)}</div><div class="s">游客可在小程序领取</div></div></div>
    <div class="kpi"><div class="ico" style="background:#e8effd">✍️</div><div><div class="l">进行中</div><div class="v" style="font-size:20px">${cnt(1)}</div><div class="s">创作进行中</div></div></div>
    <div class="kpi"><div class="ico" style="background:#f1e9fd">🔎</div><div><div class="l">审核中</div><div class="v" style="font-size:20px">${cnt(2)}</div><div class="s">等待人工判定</div></div></div>
    <div class="kpi"><div class="ico" style="background:#e3f6ec">✅</div><div><div class="l">已完成</div><div class="v" style="font-size:20px">${cnt(3)}</div><div class="s">奖励已发放</div></div></div>
    <div class="kpi"><div class="ico" style="background:var(--brand-soft)">💰</div><div><div class="l">悬赏总额</div><div class="v" style="font-size:20px">${beans.toLocaleString()} 豆</div><div class="s">${cash ? '含现金 ' + fen(cash) : '纯旅豆激励'}</div></div></div>
  </div>
  <div class="card">
    <div class="card-head"><h2>约稿任务</h2>
      <div class="cfg-tabs" style="margin:0">${TABS.map(([v, n]) => `<div class="cfg-tab ${String(window.__taskSt) === v ? 'on' : ''}" onclick="window.__taskSt='${v}';tasks()">${n} ${v !== '' ? cnt(Number(v)) : ''}</div>`).join('')}</div>
      <button class="btn primary sm" onclick="taskModal()">＋ 新建任务</button></div>
    ${frs.length ? `<table><thead><tr><th>任务</th><th>类型</th><th>报酬</th><th>交付要求</th><th>领取</th><th>截止</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${list.map((t) => `<tr>
      <td><div style="display:flex;gap:8px;align-items:center">${t.cover_img ? `<img src="${esc(t.cover_img)}" style="width:56px;height:38px;object-fit:cover;border-radius:6px;flex:none">` : ''}
        <div><div class="td-main">${esc(t.title)}</div><div class="td-sub">${esc((t.tags || '').split(',').filter(Boolean).map((x) => '#' + x.trim()).join(' ') || (t.product_title ? '目标：' + t.product_title : String(t.brief || '').slice(0, 26)))}</div></div></div></td>
      <td><span class="pill off">${TASK_CAT[t.category] || esc(t.category)}</span></td>
      <td class="num"><b>${Number(t.reward_beans)}</b> 豆${Number(t.cash_reward) ? '<br>+' + fen(t.cash_reward) : ''}</td>
      <td class="td-sub">${[t.min_words ? Number(t.min_words) + ' 字' : '', t.min_images ? Number(t.min_images) + ' 图' : '', t.max_participants ? '限 ' + t.max_participants + ' 人' : ''].filter(Boolean).join(' · ') || '不限'}</td>
      <td class="num">${t.claimed_by ? esc(t.claimer || '用户#' + t.claimed_by) : '待领取'}</td>
      <td class="td-sub">${t.deadline ? esc(String(t.deadline).slice(0, 10)) : '长期'}</td>
      <td>${ST[t.status] || ''}</td>
      <td><div style="display:flex;gap:4px;flex-wrap:wrap">
        ${t.status === 2 ? `<button class="btn primary sm" onclick="taskVerdict(${t.id},true)">通过</button><button class="btn danger sm" onclick="taskVerdict(${t.id},false)">驳回</button>` : ''}
        ${t.status <= 1 ? `<button class="btn ghost sm" onclick="taskModal(${t.id})">编辑</button>` : ''}
        ${t.rich_brief ? `<button class="btn ghost sm" onclick="taskDetail(${t.id})">说明</button>` : ''}
        <button class="btn ghost sm" onclick="deleteTask(${t.id})">删除</button></div></td></tr>`).join('')}</tbody></table>`
    : emptyBox(window.__taskSt === '' ? '暂无约稿任务：点右上「新建任务」发布第一单' : '该状态下暂无任务')}</div>`
}
const TASK_CAT = { note: '图文笔记', video: '短视频', strategy: '攻略长文', review: '体验点评' }
async function taskModal(id) { return entityEditor('task', id || null, { onSaved: () => tasks() }) }
async function taskDetail(id) {
  const t = (await api('GET', '/admin/content-tasks')).find((x) => x.id === id)
  if (!t) return
  modal('任务说明 · ' + esc(t.title), `
    <div class="rt-preview">${t.rich_brief || ''}</div>
    <div class="row" style="margin-top:12px"><span class="muted">报酬 ${Number(t.reward_beans)} 豆${Number(t.cash_reward) ? ' + ' + fen(t.cash_reward) : ''} ·
      要求 ${Number(t.min_words) ? Number(t.min_words) + ' 字' : '字数不限'}${Number(t.min_images) ? ' / ' + Number(t.min_images) + ' 图' : ''} ·
      截止 ${t.deadline ? String(t.deadline).slice(0, 10) : '长期'}${t.product_title ? ' · 目标商品：' + esc(t.product_title) : ''}</span></div>`,
    `<button class="btn primary" onclick="closeModal()">关闭</button>`)
}
async function taskVerdict(id, pass) {
  try { await api('POST', '/admin/content-tasks/' + id + '/verdict', { pass }); toast(pass ? '任务已通过' : '任务已驳回'); tasks() } catch (e) { toast(e.message, true) }
}
async function deleteTask(id) {
  if (!confirm('删除该任务？')) return
  try { await api('POST', '/admin/content-tasks/' + id + '/delete', {}); toast('任务已删除'); tasks() } catch (e) { toast(e.message, true) }
}


// ---- 创作者池（UGC 运营）：内容产出聚合 + 合作标签 ----
const CREATOR_TAG = { none: '普通', signed: '签约', star: '优质', limited: '限流' }
async function creators() {
  $('#app').innerHTML = `<div class="card">${skel(4)}</div>`
  window.__kw = window.__kw || {}
  const all = await api('GET', '/admin/creators')
  const K = (window.__kw.creators || '').trim()
  const rows = K ? all.filter((c) => (c.nickname || '').includes(K) || (c.creator_tag || '').includes(K)) : all
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>创作者池</h2>
      <input id="cr_kw" placeholder="搜昵称 / 标签" style="width:170px" value="${esc(window.__kw.creators || '')}" onchange="window.__kw.creators=this.value;creators()">
      <span class="muted">${K ? '筛出 ' + rows.length + ' / ' + all.length + ' 人' : '共 ' + all.length + ' 人'}</span>
      ${EXPBTN('creators', '创作者 CSV')}<span class="muted">有内容产出的用户自动入池 · 标签 = 资源合作状态（签约/优质享受激励加权）</span></div>
    ${rows.length ? `<table><thead><tr><th>用户</th><th>标签</th><th>笔记</th><th>已发布</th><th>点评</th><th>约稿完成</th><th>最近发布</th><th></th></tr></thead><tbody>
    ${rows.map((c) => `<tr><td class="td-main">${esc(c.nickname || '用户' + c.id)}<div class="td-sub">Lv${c.member_level}${Number(c.status) === 0 ? ' · <span class="pill s70">封禁</span>' : ''}</div></td>
      <td><span class="pill ${c.creator_tag === 'star' ? 'ok' : (c.creator_tag === 'signed' ? 's40' : (c.creator_tag === 'limited' ? 's70' : 'off'))}">${CREATOR_TAG[c.creator_tag] || esc(c.creator_tag)}</span></td>
      <td class="num">${c.note_count}</td><td class="num"><b>${c.published_count}</b></td><td class="num">${c.review_count}</td>
      <td class="num">${c.task_done}</td><td class="td-sub">${c.last_published ? esc(String(c.last_published).slice(0, 10)) : '—'}</td>
      <td><button class="btn ghost sm" onclick="setCreatorTag(${c.id},'${esc(c.creator_tag || 'none')}')">设标签</button></td></tr>`).join('')}</tbody></table>`
    : emptyBox(window.__kw.creators ? '没有匹配的创作者' : '池子还空：用户发布笔记或点评后自动入池')}
  </div>`
}
async function setCreatorTag(id, cur) {
  modal('设置创作者标签 · 用户#' + id, `
    <div class="field"><label>标签</label><select id="ct_tag">${Object.entries(CREATOR_TAG).map(([v, t]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <p class="muted">签约/优质创作者在约稿任务与内容激励中享受加权（运营口径）；限流用于配合风控。</p>`,
    `<button class="btn ghost" onclick="closeModal()">取消</button><button class="btn primary" onclick="saveCreatorTag(${id})">保存</button>`)
}
async function saveCreatorTag(id) {
  try { await api('PUT', '/admin/creators/' + id + '/tag', { tag: $('#ct_tag').value }); toast('标签已更新'); closeModal(); creators() }
  catch (e) { toast(e.message, true) }
}


/* ============ 常见问题 / 轮播管理（低垂果实 #5）============ */
const FAQ_CAT = ['预订', '出行', '旅豆', '退款', '会员', '其他']
async function faqs() {
  $('#app').innerHTML = `<div class="card">${skel(3)}</div>`
  const d = await api('GET', '/admin/faqs')
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>常见问题管理</h2><span class="muted">小程序「我的-常见问题」展示位 · 分类 + 热门标记 + 排序</span>
      <button class="btn primary sm" onclick="faqModal()">＋ 新增问题</button></div>
    <table><thead><tr><th>分类</th><th>问题</th><th>答案摘要</th><th>热门</th><th>序号</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${d.map((f) => `<tr><td><span class="pill off">${esc(f.category || '通用')}</span></td>
      <td class="td-main">${esc(f.question)}</td><td class="td-sub">${esc(String(f.answer).slice(0, 46))}…</td>
      <td>${Number(f.is_hot) ? '<span class="pill s10">🔥 热门</span>' : '<span class="pill off">—</span>'}</td>
      <td class="num">${f.sort}</td>
      <td>${f.status === 1 ? '<span class="pill ok">上架</span>' : '<span class="pill s70">下架</span>'}</td>
      <td><button class="btn ghost sm" onclick="faqModal(${f.id})">编辑</button>
      <button class="btn ghost sm" onclick="toggleFaq(${f.id}, ${f.status === 1 ? 0 : 1})">${f.status === 1 ? '下架' : '上架'}</button>
      <button class="btn ghost sm" onclick="delFaq(${f.id})">删除</button></td></tr>`).join('') || `<tr><td colspan="7" class="td-sub">暂无问题</td></tr>`}
    </tbody></table>
  </div>`
}
async function faqModal(id) { return entityEditor('faq', id || null, { onSaved: () => faqs() }) }
async function toggleFaq(id, status) { await api('POST', '/admin/faqs/' + id + '/update', { status }); faqs() }
async function delFaq(id) {
  if (!confirm('确认删除该问题？')) return
  await api('POST', '/admin/faqs/' + id + '/delete', {}); toast('已删除'); faqs()
}
async function banners() {
  $('#app').innerHTML = `<div class="card">${skel(3)}</div>`
  const d = await api('GET', '/admin/banners')
  const live = (b) => Number(b.status) === 1 && (!b.start_at || new Date(b.start_at) <= new Date()) && (!b.end_at || new Date(b.end_at) >= new Date())
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>轮播媒体管理</h2><span class="muted">小程序首页轮播位 · 图片上传 + 投放窗口 + 排序</span>
      <button class="btn primary sm" onclick="bannerModal()">＋ 新增轮播</button></div>
    <table><thead><tr><th>预览</th><th>标题</th><th>跳转</th><th>投放窗口</th><th>序号</th><th>状态</th><th>操作</th></tr></thead><tbody>
    ${d.map((b) => `<tr><td><img src="${esc(b.image)}" style="width:88px;height:48px;object-fit:cover;border-radius:6px"></td>
      <td><div class="td-main">${esc(b.title)}</div>${b.sub_title ? `<div class="td-sub">${esc(b.sub_title)}</div>` : ''}</td>
      <td class="td-sub">${esc(b.link || '不跳转')}</td>
      <td class="td-sub">${b.start_at || b.end_at ? esc(String(b.start_at || '').slice(0, 10)) + ' ~ ' + esc(String(b.end_at || '').slice(0, 10)) : '长期'}</td>
      <td class="num">${b.sort}</td>
      <td>${live(b) ? '<span class="pill ok">投放中</span>' : (Number(b.status) === 1 ? '<span class="pill warn">未在窗口</span>' : '<span class="pill s70">已下架</span>')}</td>
      <td><button class="btn ghost sm" onclick="bannerModal(${b.id})">编辑</button>
      <button class="btn ghost sm" onclick="toggleBanner(${b.id}, ${b.status === 1 ? 0 : 1})">${b.status === 1 ? '下架' : '上架'}</button>
      <button class="btn ghost sm" onclick="delBanner(${b.id})">删除</button></td></tr>`).join('') || '<tr><td colspan="7" class="td-sub">暂无轮播（首页将隐藏轮播位）</td></tr>'}
    </tbody></table>
  </div>`
}
async function bannerModal(id) { return entityEditor('banner', id || null, { onSaved: () => banners() }) }
async function toggleBanner(id, status) { await api('POST', '/admin/banners/' + id + '/update', { status }); banners() }
async function delBanner(id) {
  if (!confirm('确认删除该轮播？')) return
  await api('POST', '/admin/banners/' + id + '/delete', {}); toast('已删除'); banners()
}

async function contract() {
  $('#app').innerHTML = `<div class="card">${skel(3)}</div>`
  const d = await api('GET', '/admin/web3/contract-account')
  $('#app').innerHTML = `
  <div class="card">
    <div class="card-head"><h2>合约调用账户</h2><span class="muted">${esc(d.mode)}</span></div>
    <table><tr><td class="td-sub">接入状态</td><td>${esc(d.mode)}</td></tr>
      <tr><td class="td-sub">链端点 CHAIN_ENDPOINT</td><td>${d.endpoint ? '<code>' + esc(d.endpoint) + '</code>' : '<span class="muted">未配置（NOOP 模式）</span>'}</td></tr>
      <tr><td class="td-sub">账户 CHAIN_ACCOUNT</td><td>${d.account ? '<code>' + esc(d.account) + '</code>' : '<span class="muted">未配置</span>'}</td></tr>
      <tr><td class="td-sub">私钥 CHAIN_KEY</td><td>${d.keyConfigured ? '<span class="pill ok">已配置（加密落库）</span>' : '<span class="muted">未配置</span>'}</td></tr></table>
    <div class="muted" style="margin-top:8px">${esc(d.note)} · 凭据在「系统-集成中心」配置（AES-256-GCM 加密，库→env 兜底）</div>
  </div>`
}

async function verifyAttest() {
  const ref = document.getElementById('vref').value.trim()
  if (!ref) return
  const r = await api('GET', '/admin/attest/verify?bizType=order&bizRef=' + encodeURIComponent(ref))
  const anchored = !!r.chainRef
  document.getElementById('vout').innerHTML = r.found
    ? `<div class="card" style="margin-top:14px;background:#f0faf7"><div class="row" style="margin:0">
        <span class="pill ${anchored ? 'ok' : 's20'}">${anchored ? '✓ 已锚定上链' : '已打包·待锚定'}</span><span>${esc(r.note)}</span></div>
       <table style="margin-top:8px"><tr><td class="td-sub">业务单号</td><td class="num">${esc(r.bizRef)} · v${Number(r.versionNo || 1)}</td></tr>
       <tr><td class="td-sub">载荷哈希</td><td><code>${esc(r.payloadHash)}</code></td></tr>
       ${r.merkleRoot ? `<tr><td class="td-sub">Merkle 根</td><td><code>${esc(r.merkleRoot)}</code></td></tr>` : ''}
       <tr><td class="td-sub">证明路径</td><td>${r.leafPath ? `<span class="pill ok">${r.leafPath.length} 层 · 本地重算${r.proofValid ? '通过' : '不通过'}</span>` : '—'}${r.leafIndex != null ? ` <span class="td-sub">leaf#${r.leafIndex}</span>` : ''}</td></tr>
       ${anchored ? `<tr><td class="td-sub">链上编号</td><td><code>${esc(r.chainRef)}</code>${r.chainBlock ? ' · 区块 ' + esc(r.chainBlock) : ''}</td></tr>` : ''}
       </table>
       <div class="row" style="margin-top:10px">
         <a class="btn primary sm" target="_blank" rel="noopener" href="/open/report/order/${encodeURIComponent(r.bizRef)}">下载存证证明 PDF</a>
         <a class="btn ghost sm" target="_blank" rel="noopener" href="/verify?no=${encodeURIComponent(r.bizRef)}">公开复核页</a>
       </div>
       <div class="muted" style="margin-top:6px">${esc(r.verifyTip || '')}</div></div>`
    : `<div class="card" style="margin-top:14px"><span class="pill s70">未找到该单存证记录</span></div>`
}
