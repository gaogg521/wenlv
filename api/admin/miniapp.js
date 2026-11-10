// 小程序装修与映射：两个小程序的每个页面 → 页面上的内容 → 在后台哪里改。
// MINI_MAP 由 test/miniapp-map.mjs 校验：app.json 里每个页面都必须在此登记，新增页面忘了映射会让 npm test 失败。
(() => {
  const E = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  // [内容, [[后台入口名, 页面键], ...]]；页面键 'site' 表示「小程序装修」编辑器，'cfg:xxx' 表示参数中心某参数
  const MINI_MAP = [
    { end: '游客端', path: 'pages/home/index', name: '首页', items: [
      ['眉标、主标题、副标题、搜索提示、目的地快捷行', [['小程序装修 · 首页', 'site']]],
      ['主题入口（频道、名称、图标）', [['小程序装修 · 首页', 'site']]],
      ['轮播（图片、跳转、投放城市与时间）', [['轮播管理', 'banners']]],
      ['线路卡片（封面、标签、价格）', [['商品与团期', 'products']]],
      ['默认分享标题与分享图', [['小程序装修 · 品牌与分享', 'site']]]] },
    { end: '游客端', path: 'pages/tour-list/index', name: '线路列表 / 搜索', items: [
      ['线路标题、标签、搜索关键词', [['商品与团期', 'products']]], ['页脚说明', [['小程序装修 · 列表与商城', 'site']]]] },
    { end: '游客端', path: 'pages/destination/index', name: '目的地', items: [
      ['目的地名称、介绍、封面、排序', [['小程序装修 · 目的地', 'site']]], ['在架线路数与起价（自动统计）', [['商品与团期', 'products']]]] },
    { end: '游客端', path: 'pages/shop/index', name: '旅行商城', items: [
      ['商城 SKU', [['商品与团期（频道：商城 SKU）', 'products']]], ['标题、副标题、说明', [['小程序装修 · 列表与商城', 'site']]]] },
    { end: '游客端', path: 'package-tour/pages/detail/index', name: '线路详情', items: [
      ['标题、图集、亮点、行程介绍、行程节点、费用含/不含、集合点与导航、补充须知、安全与保险、分享图', [['商品与团期 → 编辑资料', 'products']]],
      ['近期团期（日期、价格、余位、成团进度）', [['商品与团期 → 团期', 'products']]],
      ['合作景区卡、履约商户卡', [['景区资源', 'scenics'], ['商户与进件', 'merchants']]],
      ['关联常见问题', [['常见问题（关联线路）', 'faqs']]],
      ['退改规则、支付时限、旅豆抵扣上限', [['参数中心 · 订单/旅豆', 'config']]], ['真实评价', [['内容审核 · 评价管理', 'content']]]] },
    { end: '游客端', path: 'package-tour/pages/booking/index', name: '确认订单', items: [
      ['团期出行安排（集合时间、交通、报名截止、注意事项）', [['商品与团期 → 团期', 'products']]], ['退改规则', [['参数中心 · order.refund_policy', 'config']]]] },
    { end: '游客端', path: 'package-tour/pages/pay-result/index', name: '支付结果', items: [['订单状态', [['订单', 'orders']]], ['支付通道', [['集成中心', 'integrations']]]] },
    { end: '游客端', path: 'package-tour/pages/place/index', name: '商户 / 景区资料页', items: [
      ['商户：Logo、门店照片、介绍、营业时间、设施、地址导航、客服电话', [['商户与进件 → 编辑', 'merchants']]],
      ['景区：封面、图集、介绍、开放时间、票种价格、交通指引', [['景区资源 → 编辑', 'scenics']]]] },
    { end: '游客端', path: 'package-order/pages/orders/index', name: '我的订单', items: [['订单列表与状态', [['订单', 'orders']]]] },
    { end: '游客端', path: 'package-order/pages/order-detail/index', name: '订单详情', items: [
      ['出行安排与领队', [['商品与团期 → 团期', 'products']]], ['商户联系方式', [['商户与进件', 'merchants']]], ['退款试算与退款明细', [['订单 → 退款', 'orders'], ['参数中心', 'config']]]] },
    { end: '游客端', path: 'package-order/pages/pass-code/index', name: '核销凭证', items: [['动态核销码时长', [['参数中心 · 核销', 'config']]], ['入戏暗号、提示、角色与地点', [['暗号管理', 'phrases']]]] },
    { end: '游客端', path: 'pages/bean/index', name: '旅豆', items: [
      ['返豆比例、抵扣上限、有效期', [['参数中心 · 旅豆', 'config']]], ['旅豆说明', [['小程序装修 · 旅豆与推广', 'site']]], ['旅豆账本', [['积分发行台账', 'pointassets']]]] },
    { end: '游客端', path: 'package-content/pages/create/index', name: '创作中心', items: [['约稿任务卡片', [['约稿任务', 'tasks']]], ['笔记审核', [['内容审核', 'content']]], ['下架原因、作者申诉与我的举报反馈', [['举报与申诉', 'contentcases']]], ['未通过原因（笔记 / 约稿投稿）', [['内容审核 → 审核', 'content'], ['约稿任务 → 审核投稿', 'tasks']]]] },
    { end: '游客端', path: 'package-content/pages/task/index', name: '约稿任务详情', items: [['任务说明、必须提及/禁止出现、参考范例、审核标准、奖励', [['约稿任务', 'tasks']]], ['上次投稿未通过的原因', [['约稿任务 → 审核投稿', 'tasks']]]] },
    { end: '游客端', path: 'package-content/pages/square/index', name: '旅行笔记广场', items: [['公开笔记流（已发布笔记、作者、点赞、关联线路）', [['内容审核', 'content'], ['创作者池', 'creators']]], ['点赞与举报入口', [['举报与申诉', 'contentcases']]]] },
    { end: '游客端', path: 'package-content/pages/note/index', name: '笔记详情', items: [['笔记内容与状态', [['内容审核', 'content'], ['创作者池', 'creators']]], ['读者举报入口及处理', [['举报与申诉', 'contentcases']]]] },
    { end: '游客端', path: 'package-content/pages/identity/index', name: '我的身份', items: [['勋章墙（勋章图、稀有度、规则、有效期）', [['勋章发行', 'badges']]], ['权益凭证与可信记录', [['存证中心', 'attest'], ['权益账户', 'wallets']]]] },
    { end: '游客端', path: 'package-content/pages/doc/index', name: '协议与说明', items: [['用户协议、隐私政策、关于我们；图片来源与许可可从关于页查看', [['小程序装修 · 客服与协议', 'site']]]] },
    { end: '游客端', path: 'package-promo/pages/center/index', name: '推广中心', items: [['资格、档位与费率', [['推广服务商', 'promoters'], ['逐品佣金', 'rateov']]], ['提现', [['提现审批', 'withdrawals']]], ['规则说明', [['小程序装修 · 旅豆与推广', 'site']]]] },
    { end: '游客端', path: 'package-promo/pages/work/index', name: '合作身份', items: [['主体、经办人授权与有效期、关联合作档案', [['合伙人中心 → 主体与经办授权', 'partners']]]] },
    { end: '游客端', path: 'pages/faq/index', name: '常见问题', items: [['问题、富文本答案、分类、热门、同义问法', [['常见问题', 'faqs']]]] },
    { end: '游客端', path: 'pages/me/index', name: '我的', items: [['客服电话与服务时间、协议入口、品牌标语', [['小程序装修 · 客服与协议', 'site']]], ['实名认证审核', [['实名认证', 'kyc']]]] },
    { end: '商户端', path: 'pages/index/index', name: '工作台', items: [['平台公告', [['小程序装修 · 商户端', 'site']]], ['今日流水、待核销、近 7 日经营', [['订单', 'orders']]], ['游客评价', [['内容审核 · 评价管理', 'content']]]] },
    { end: '商户端', path: 'pages/verify/index', name: '扫码 / 暗号核销', items: [['暗号对答与可接受变体、启停日期', [['暗号管理', 'phrases']]], ['离线核销冲突', [['离线冲突', 'conflicts']]]] },
    { end: '商户端', path: 'pages/records/index', name: '核销记录', items: [['核销流水', [['订单', 'orders'], ['审计日志', 'audit']]]] },
    { end: '商户端', path: 'pages/orders/index', name: '订单', items: [['门店订单、历史日期筛选与翻页', [['订单', 'orders']]]] },
    { end: '商户端', path: 'pages/order-detail/index', name: '订单详情', items: [['订单与凭证', [['订单', 'orders']]]] },
    { end: '商户端', path: 'pages/supply/index', name: '供给 / 库存', items: [['按商品分组、搜索与历史日期筛选的团期余位', [['商品与团期', 'products']]]] },
    { end: '商户端', path: 'pages/settlement/index', name: '结算', items: [['周结算单、确认、异议、回单', [['结算', 'settlements'], ['协议变更', 'agreements']]], ['退改手续费分成比例', [['参数中心 · settlement.refund_fee_merchant_pct', 'config'], ['商户资料 · 结算账户', 'merchants']]]] },
    { end: '商户端', path: 'pages/proof/index', name: '记录复核', items: [['复核结果里的类型、名称、日期、封存状态', [['存证总览 → 存证检索（后台查同一条记录）', 'web3dash']]], ['记录编号对应的勋章名称', [['徽章管理', 'badges']]]] },
    { end: '商户端', path: 'pages/honor/index', name: '经营等级与荣誉', items: [['商户等级名、门槛、权益说明', [['参数中心 · merchant.levels', 'config']]], ['商户徽章（等级 / 经营荣誉 / 可信经营）的定义与发放', [['徽章管理', 'badges']]], ['某家商户的当前等级与徽章', [['商户与进件 → 全景', 'merchants']]]] },
    { end: '商户端', path: 'pages/me/index', name: '我的 / 入驻', items: [['入驻申请与审核', [['商户与进件', 'merchants']]], ['入驻说明', [['小程序装修 · 商户端', 'site']]], ['门店资料', [['商户与进件 → 编辑', 'merchants']]]] },
  ]
  window.MINI_MAP = MINI_MAP

  const jump = (key) => key === 'site' ? `entityEditor('site', 1, { onSaved: () => miniapp() })` : `go('${key}')`
  window.miniapp = async function miniapp() {
    $('#app').innerHTML = `<div class="card">${skel(5)}</div>`
    const site = await api('GET', '/admin/entities/site/1')
    const v = site.values
    const ends = ['游客端', '商户端']
    $('#app').innerHTML = `
    <section class="mp-hero">
      <div class="mp-phone"><div class="mp-screen">
        <div class="mp-eyebrow">${E(v.hero_eyebrow || '')}</div>
        <div class="mp-title">${E(v.hero_title || '')}<em>${E(v.hero_title_em || '')}</em></div>
        <div class="mp-cap">${E(v.hero_caption || '')}</div>
        <div class="mp-search">⌕ ${E(v.search_ph || '')}</div>
        <div class="mp-themes">${(v.themes || []).slice(0, 4).map((t) => `<div><b>${E(t.icon || '')}</b>${E(t.name)}<small>${E(t.sub || '')}</small></div>`).join('')}</div>
      </div></div>
      <div class="mp-side">
        <div class="mp-eyebrow2">MINI PROGRAM · 小程序装修</div>
        <h2>${E(v.brand_name || '小程序')}</h2>
        <p>首页文案与主题入口、目的地、列表与商城、旅豆与推广说明、客服与协议、商户端公告，都在这里统一维护；保存后小程序 5 分钟内生效。</p>
        <div class="mp-stats"><div><b>${site.completeness}%</b><span>装修完整度</span></div><div><b>${MINI_MAP.length}</b><span>已映射页面</span></div><div><b>0</b><span>未映射页面</span></div></div>
        <button class="btn primary" onclick="entityEditor('site', 1, { onSaved: () => miniapp() })">编辑小程序装修</button>
        <p class="muted" style="margin-top:10px">小程序可见字段会自动拦截审核敏感词（如"区块链""存证""NFT"），后台其他页面不受限。</p>
      </div>
    </section>
    ${ends.map((end) => `<section class="card mp-map"><div class="card-head"><h3>${end}页面 → 后台入口</h3><span class="muted">${MINI_MAP.filter((r) => r.end === end).length} 个页面</span></div>
      <table><thead><tr><th style="width:170px">小程序页面</th><th>页面上的内容</th><th style="width:300px">在后台哪里改</th></tr></thead><tbody>
      ${MINI_MAP.filter((r) => r.end === end).map((r) => r.items.map((it, i) => `<tr>
        ${i === 0 ? `<td rowspan="${r.items.length}" class="mp-page"><b>${E(r.name)}</b><div class="td-sub">${E(r.path)}</div></td>` : ''}
        <td>${E(it[0])}</td>
        <td>${it[1].map(([n, k]) => `<button class="mp-go" onclick="${jump(k)}">${E(n)} →</button>`).join('')}</td></tr>`).join('')).join('')}
      </tbody></table></section>`).join('')}`
  }
})()
