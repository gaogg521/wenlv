// 页面职责和下一步入口。分析指标与历史台账通过源业务操作变更。
const ADMIN_PAGE_OPERATIONS = {
  dash: ['经营分析', '查看经营与待办，进入对应业务页办理。', ['orders','content','merchants']],
  products: ['资料维护', '新增线路、编辑图文与履约资源，管理团期并上下架。', []],
  merchants: ['入驻管理', '维护商户资料，审核进件；交易与结算数据随业务生成。', []],
  scenics: ['资源维护', '维护景区合作资料、状态与关联线路，查看景点业绩。', []],
  suppliers: ['资源维护', '维护供给方资料、合作状态和服务能力。', []],
  orders: ['订单处理', '点“查看与处理”修正履约联系人、记录客服备注或处理退款；金额与状态按业务流程变更。', ['conflicts']],
  phrases: ['核销配置', '配置线路的核销暗号、剧情和适用场景。', ['products']],
  conflicts: ['异常处理', '逐笔核实离线凭证冲突，确认核销或驳回并记录原因。', ['orders']],
  users: ['账号管理', '点“查看与管理”进入用户画像，冻结/解冻或管理风险；等级、余额由规则与业务流水形成。', ['badges','kyc']],
  kyc: ['审核处理', '审核用户提交的实名材料，通过或驳回；原始证件信息不作为普通资料编辑。', ['users']],
  wallets: ['权益台账', '核对用户积分、等级、徽章和存证记录；余额不提供直接覆盖修改。', ['users','badges']],
  badges: ['权益管理', '维护徽章定义与发放规则，人工授予或按规则补发。', ['users']],
  contentdash: ['内容分析', '查看发布、审核与转化数据；内容处理进入审核或举报申诉。', ['content','contentcases','tasks']],
  content: ['审核处理', '查看投稿全文与图片，审核笔记、处理评价展示或下架违规笔记；正文由作者修改。', ['contentcases','tasks']],
  contentcases: ['举报与申诉', '处理举报、记录下架原因，复核作者申诉并反馈处理结论。', ['content']],
  tasks: ['任务管理', '创建和编辑约稿，管理上线状态、参与者与投稿审核；现金奖励交财务登记。', ['taskcash','creators']],
  creators: ['合作维护', '查看创作者作品与履约表现，维护合作标签和限制状态。', ['tasks']],
  partners: ['合作管理', '可直接编辑推广服务商、共创人合作资料；城市账号的新建、改城市与停用流程尚未开放。', ['promoters','partnerperf']],
  partnerperf: ['业绩与对账', '核对角色业绩和资金来源；维护合作资料或处理资金请进入源业务。', ['partners','settlements','withdrawals']],
  promoters: ['推广管理', '开通推广资格，维护合作资料，调档、冻结或解冻。', ['partners','withdrawals']],
  settlements: ['结算处理', '生成结算单、复核并登记回单；历史计账金额不作为普通表格编辑。', ['agreements']],
  withdrawals: ['资金审批', '核实提现申请，登记真实打款流水或驳回；冻结账号暂停打款。', ['partners']],
  taskcash: ['奖励打款', '核对已通过投稿的现金奖励，实际线下支付后登记唯一流水号；登记不会自动发起转账。', []],
  agreements: ['协议审批', '审批商户发起的协议变更；已生效协议通过新变更保留历史。', ['merchants']],
  budgets: ['预算管理', '新建、编辑、启停旅豆预算批次；已发放量随业务流水累计。', []],
  rateov: ['佣金配置', '维护单品佣金覆盖规则，核对比例与适用商品。', ['promoters']],
  cocreate: ['共创管理', '登记共创人，编辑合作资料与状态，核对分润台账。', ['partners']],
  miniapp: ['渠道配置', '编辑小程序装修文案；页面业务内容通过映射进入对应管理栏目。', ['banners','faqs']],
  banners: ['投放管理', '新增、编辑、排序及启停轮播素材。', []],
  faqs: ['内容维护', '新增、编辑、分类、排序及启停常见问题。', []],
  web3dash: ['链路分析', '查看业务存证链路与队列；需要处理时进入存证或接入中心。', ['attest','chainhub']],
  attest: ['存证处理', '打包、锚定、核验并查看证明；历史已确认记录不可直接改写。', ['chainhub']],
  vc: ['凭证管理', '签发、验签或吊销旅行凭证；原凭证内容不可直接覆盖修改。', []],
  pointassets: ['发行台账', '核对发行批次、持有人和年度总量，发放通过预算及业务规则办理。', ['budgets']],
  chainassets: ['接入与资产', '查看链能力、发行台账和已接入状态，连接参数在链接入中心维护。', ['chainhub']],
  chainhub: ['接入配置', '维护接入参数、探测与切换；自检成功不代表真实业务上链完成。', []],
  terms: ['参考说明', '统一内部与小程序用语口径；词表由代码统一维护，此页不提供业务编辑。', []],
  risk: ['风险处理', '查看风险明细，核实并标记处理；账号风险到用户中心管理。', ['users']],
  audit: ['审计台账', '追踪操作人与变更记录；历史审计只读，修正业务需生成新记录。', []],
  security: ['安全管理', '维护验证器、验证通道与访问安全；后台角色账号生命周期管理尚未完整提供。', []],
  config: ['规则审批', '修改规则需提交提案，按敏感等级复核；生效与回滚均保留历史。', []],
  features: ['功能配置', '按现有功能键启停功能，变更写入审计。', []],
  integrations: ['服务配置', '维护支付、小程序等外部通道配置，确认真实接入状态。', []],
  system: ['运维处理', '查看健康、任务与告警，按需触发后台任务；业务资料到相应业务页维护。', []],
}

// 可信存证页签：侧栏只留 4 个入口，合并的子页在页面顶部以页签并排（页面重绘不会丢，因为页签在 #app 之外）
const TRUST_MERGE = { attest: 'web3dash', pointassets: 'vc', chainassets: 'chainhub' }                       // 子页 → 父页
const TRUST_LABEL = { web3dash: '存证总览', vc: '数字身份与账户', chainhub: '链接入' }                          // 侧栏显示名
const TRUST_ALIAS = { web3dash: '链路总览 存证中心 链路视图', vc: '数字身份 积分发行台账 旅豆账户 身份档案', chainhub: '链接入中心 链与资产 多链能力' } // 搜索别名
const TRUST_TABS = [
  ['web3dash', [['web3dash', '链路视图'], ['attest', '存证中心']]],
  ['vc', [['vc', '身份与凭证'], ['pointassets', '旅豆发行台账']]],
  ['chainhub', [['chainhub', '链接入中心'], ['chainassets', '链与资产']]],
]
function renderPageOperations(key) {
  const grp = TRUST_TABS.find(([, tabs]) => tabs.some(([k]) => k === key))
  if (grp) {
    const have = new Set([...document.querySelectorAll('#nav [data-p]')].map((el) => el.dataset.p))
    const tabs = grp[1].filter(([k]) => have.has(k))
    if (tabs.length > 1) {
      const root = document.getElementById('pageOperations'); root.hidden = false
      root.innerHTML = `<div class="trust-tabs" role="tablist">${tabs.map(([k, n]) => `<button class="trust-tab ${k === key ? 'on' : ''}" role="tab" aria-selected="${k === key}" onclick="go('${k}')">${esc(n)}</button>`).join('')}<span class="trust-tabs-hint">${esc((ADMIN_PAGE_OPERATIONS[key] || [])[1] || '')}</span></div>`
      return
    }
  }
  const root = document.getElementById('pageOperations'), info = ADMIN_PAGE_OPERATIONS[key]
  if (!info) { root.hidden = true; return }
  root.hidden = false
  const available = [...document.querySelectorAll('#nav [data-p]')]
  const links = info[2].map(k => available.find(el => el.dataset.p === k)).filter(Boolean)
  root.innerHTML = `<div><b>${esc(info[0])}</b><span>${esc(info[1])}</span></div>${links.length ? `<div class="operation-links">${links.map(el => `<button class="btn ghost sm" onclick="go('${el.dataset.p}')">去${esc(el.textContent.trim())} →</button>`).join('')}</div>` : ''}`
}
