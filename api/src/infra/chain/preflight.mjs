// 多链预埋体检（共享模块）：后台页面与命令行 scripts/chain-preflight.mjs 同源调用。
//
// 为什么提成模块：同一份"还缺什么/要问对方什么"不能两处各写一份——
// 写两份必然走样（铁律：同一笔数据不许两处各算一遍）。
//
// 三件事分开答：
//   1. 离线自测 selfTest：不需要凭据，证明签名/编码代码路径是通的
//   2. 凭据齐备度 missing：还缺哪几个 env
//   3. 待对方确认 ask：技术对接必须问的问题
import { PROVIDERS, providerId } from './index.mjs'

/** 每家链上线前必须问对方的问题（与 config/chains/*.env 模板注释同源） */
export const ASK = {
  chaingen: [
    '落根接口的真实路径与参数名（当前按 POST /v1/attest/anchor 预埋）',
    '签名串是否就是 METHOD\\nPATH\\nts\\nrawBody，密钥是否 HMAC-SHA256',
    '是否提供"给根反查交易"的接口（决定幂等靠链还是靠本地台账）',
    '出块/确认时延与 txRef 字段名；有无测试网',
  ],
  tbaas: [
    '落根合约由谁部署（我方给 ABI 规格 / 对方代部署）',
    '合约方法名与参数顺序（当前 writeRoot(bytes32,bytes32,uint64)）',
    'TC3 Action/Version/Region 是否就是 Invoke + 2020-04-17 + ap-shanghai',
    'NFT 发行方法名与合约（mint / safeMint / ERC-1155 mint）',
  ],
  antchain: [
    'OpenAPI 版本与签名方式（hmac-sha256 / rsa-sha256），签名字段以哪份文档为准',
    '存证是写合约还是走存证服务（当前按 POST /v1/attest/anchor 预埋）',
    '鲸探藏品：资质、内容审核、服务商接入的办理顺序与周期',
    '数字资产集合（CollectionId）如何申请、单个/批量发行上限',
  ],
  antchainopen: [
    '开放联盟链的租户 ID（tenantid）取自哪里（本账号实测为控制台地址 projectName 参数，文档示例 mytenant 不对）',
    '托管账户是否已分配燃料（未分配一律返回 204 account config invalid）',
    '免费版 TPS=1 / 燃料额度够不够批量补锚；生产是否升级专业版',
    '开放联盟链是公开共享链：content 明文可见，是否允许只写 Merkle 根与业务日',
  ],
  antchaincontract: [
    '合约是否已部署、部署时用的合约名（ANTOPEN_CONTRACT_NAME）；部署不可逆，源码改了要换合约名/地址',
    'bytes32 入参在 inputParamListStr 里怎么表示（0x… / 裸 hex / base64）——文档没写清，部署后真机核对',
    'QUERYRECEIPT 回执里成功标志与 output 的字段名；读调用也是交易，单次耗多少 gas',
    '合约链独立起链（创世 prevRoot=0），不接 DEPOSIT 时代批次的前根——是否接受这种口径',
  ],
  evm: [
    'relayer 的接口形状（当前按 POST {relayer}/tx，Bearer token）',
    '落根交易目标地址（EVM_ANCHOR_TO）与是否要求写合约事件',
    'NFT 合约方法签名（当前 mint(address,uint256,uint256,bytes)，选择器自动算）',
    '链 ID / 浏览器基址 / 确认数要求',
  ],
  noop: ['接入任一家后此 provider 自动退出'],
  mock: ['仅自测：生产环境会被代码层拒绝'],
}

/** 跑一遍全部 provider 的离线体检（不联网、不需要凭据，可安全在后台接口里调用） */
export function runPreflight() {
  const active = providerId()
  return Object.values(PROVIDERS).map((p) => {
    const st = p.status()
    let self = { ok: true, detail: '无需自检' }
    if (typeof p.selfTest === 'function') {
      try { self = p.selfTest() } catch (e) { self = { ok: false, detail: 'EXC ' + e.message } }
    }
    return {
      id: p.id,
      label: p.label,
      mode: st.mode,
      active: p.id === active,
      missing: st.missing || [],
      selfOk: self.ok,
      selfDetail: self.detail,
      caps: Object.entries(p.capabilities).filter(([, v]) => v).map(([k]) => k),
      ask: ASK[p.id] || [],
      note: st.note || '',
    }
  })
}

/** 汇总一句话：预埋完成度（后台 KPI / 命令行末尾都能用） */
export function preflightSummary(rows = runPreflight()) {
  const real = rows.filter((r) => r.id !== 'noop' && r.id !== 'mock')
  return {
    ready: real.filter((r) => r.selfOk).length,
    total: real.length,
    selfFail: real.filter((r) => !r.selfOk).map((r) => r.id),
    active: providerId(),
    credentialsReady: real.filter((r) => r.missing.length === 0).map((r) => r.id),
  }
}
