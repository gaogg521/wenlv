// 可信能力一页纸（A4 单页）：给政府 / 景区 / 投资人
//
// 设计原则：
//   1. 不堆架构名词，只回答"你能核验什么"与"我现在就能怎么验"
//   2. 每一块都带一个可现场扫码/点开的入口 —— 说了不算，能当场验才算
//   3. 多链能力矩阵放在下半页：告诉对方"我们不被某一家链锁死"
import { Resvg } from '@resvg/resvg-js'
import qrcode from 'qrcode-generator'
import { pngToPdf } from '../infra/pdf.mjs'

const W = 1240
const H = 1754
const M = 80
const BRAND = '#0f766e'
const INK = '#14181f'
const SUB = '#5b6572'
const FAINT = '#98a1b0'
const LINE = '#e3e7ee'
const CARD = '#f7f9fb'

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

function qr(url, x, y, size) {
  const q = qrcode(0, 'L')
  q.addData(url)
  q.make()
  const n = q.getModuleCount()
  const cell = size / n
  let r = ''
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    if (q.isDark(i, j)) r += `<rect x="${(x + j * cell).toFixed(2)}" y="${(y + i * cell).toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}"/>`
  }
  return `<g fill="#111">${r}</g>`
}

/** 四宫格能力卡 */
function card(x, y, w, h, o) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" fill="${CARD}" stroke="${LINE}"/>
  <rect x="${x}" y="${y}" width="4" height="${h}" rx="2" fill="${o.color || BRAND}"/>
  <text x="${x + 22}" y="${y + 38}" font-size="20" font-weight="700" fill="${INK}">${esc(o.title)}</text>
  ${o.lines.map((ln, i) => `<text x="${x + 22}" y="${y + 68 + i * 24}" font-size="14.5" fill="${SUB}">${esc(ln)}</text>`).join('')}
  <text x="${x + 22}" y="${y + h - 16}" font-size="13" fill="${BRAND}" font-family="Consolas,Menlo,monospace">${esc(o.proof)}</text>`
}

/**
 * @param {object} ctx
 * @param {string} ctx.baseUrl  对外可访问基址（生成二维码）
 * @param {object} ctx.chain    当前链状态
 * @param {object[]} ctx.providers 多链能力矩阵
 * @param {object} ctx.counts   { events, batches, dayRoots, vc, assets }
 */
export function capabilityDoc(ctx) {
  const { baseUrl, chain, providers, counts = {} } = ctx
  const cur = chain || {}
  const cap = cur.capabilities || {}

  const CAPS = [
    { title: '一、每条记录都能被独立核验', color: BRAND,
      lines: ['订单 / 权益凭证 / 核销 / 旅豆发放与消耗 / 退款 / 结算，共 7 类事件逐条留指纹。',
        '对外给出 merkle 证明路径，任何一方可离线重算，不需要相信平台。'],
      proof: `${baseUrl}/verify  ·  浏览器本地 SHA-256 重算` },
    { title: '二、身份可携带，且不泄露隐私', color: '#2f6f9f',
      lines: ['用户持 VC-JWT 数字身份，Ed25519 签名，公钥公开可离线验签。',
        '只披露等级 / 行程数 / 城市数 / 徽章；姓名、手机号、身份证、金额从不下发。'],
      proof: `${baseUrl}/vc  ·  ${baseUrl}/open/vc/issuer` },
    { title: '三、账本可自证，不靠平台承诺', color: '#7c4dff',
      lines: ['旅豆采用双分录账本，每日封存日终根，且 Σ借 = Σ贷 才允许封存。',
        '「严禁超发」由此从口号变成可审计的密码学事实。'],
      proof: `${baseUrl}/open/verify/bean-day/{日期}` },
    { title: '四、不被任何一家链锁死', color: '#e87722',
      lines: [`当前接入：${cur.label || '未接入'}（${cur.mode === 'real' ? '真实上链' : '本地就绪，待凭据'}）。`,
        '链数根 / 腾讯云 TBaaS / 蚂蚁链鲸探 / EVM 公链，切一个环境变量即换链，业务零改动。'],
      proof: `${baseUrl}/open/chain/capabilities` },
  ]

  const colW = (W - M * 2 - 24) / 2
  const rowH = 150
  const gridY = 470
  const rowGap = 18

  const provRows = (providers || []).map((p, i) => {
    const y = 1060 + i * 36
    const sep = `<line x1="${M + 16}" x2="${W - M - 16}" y1="${y + 14}" y2="${y + 14}" stroke="#f0f2f6"/>`
    const yn = (b) => (b ? '✔' : '—')
    return `${sep}<text x="${M + 24}" y="${y}" font-size="14" fill="${INK}">${esc(p.label)}${p.current ? '（当前）' : ''}</text>
      <text x="${M + 470}" y="${y}" font-size="14" fill="${p.capabilities.anchor ? BRAND : FAINT}">${yn(p.capabilities.anchor)}</text>
      <text x="${M + 610}" y="${y}" font-size="14" fill="${p.capabilities.queryByRoot ? BRAND : FAINT}">${yn(p.capabilities.queryByRoot)}</text>
      <text x="${M + 750}" y="${y}" font-size="14" fill="${p.capabilities.assets ? BRAND : FAINT}">${yn(p.capabilities.assets)}</text>
      <text x="${M + 890}" y="${y}" font-size="14" fill="${p.capabilities.did ? BRAND : FAINT}">${yn(p.capabilities.did)}</text>
      <text x="${M + 980}" y="${y}" font-size="13" fill="${p.mode === 'real' ? '#0f9d58' : FAINT}">${p.mode === 'real' ? '已配置' : '缺凭据'}</text>`
  }).join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <rect x="0" y="0" width="${W}" height="12" fill="${BRAND}"/>

  <text x="${M}" y="86" font-size="16" font-weight="700" fill="${BRAND}" letter-spacing="3">向往的自由 · WANDERLUST</text>
  <text x="${M}" y="150" font-size="40" font-weight="700" fill="${INK}">可信能力一页纸</text>
  <text x="${M}" y="188" font-size="16" fill="${SUB}">给政府 / 景区 / 投资人的现场核验清单 —— 每一项都能当场扫码验证，不需要相信我们的说法</text>
  <line x1="${M}" y1="214" x2="${W - M}" y2="214" stroke="${LINE}" stroke-width="1.5"/>

  <rect x="${M}" y="244" width="${W - M * 2}" height="150" rx="12" fill="${BRAND}"/>
  <text x="${M + 28}" y="292" font-size="22" font-weight="700" fill="#ffffff">平台说的是真的吗？—— 不用信，自己算。</text>
  <text x="${M + 28}" y="328" font-size="15" fill="#cdebe5">我们把"可信"拆成三件可被外部独立验证的事：记录有指纹、身份有签名、账本有恒等式。</text>
  <text x="${M + 28}" y="360" font-size="15" fill="#cdebe5">任何人拿一个单号 / 一张凭证 / 一个日期，就能自己复核；我们无权修改结论。</text>

  ${CAPS.map((c, i) => card(M + (i % 2) * (colW + 24), gridY + Math.floor(i / 2) * (rowH + rowGap), colW, rowH, c)).join('')}

  <text x="${M}" y="822" font-size="20" font-weight="700" fill="${INK}">规模与现状（实时）</text>
  <rect x="${M}" y="846" width="${W - M * 2}" height="70" rx="10" fill="${CARD}" stroke="${LINE}"/>
  ${[
    ['存证事件', counts.events ?? 0],
    ['存证批次', counts.batches ?? 0],
    ['账本封存天数', counts.dayRoots ?? 0],
    ['数字身份签发', counts.vc ?? 0],
    ['链上资产', counts.assets ?? 0],
  ].map(([k, v], i) => `<text x="${M + 40 + i * 218}" y="876" font-size="13" fill="${SUB}">${esc(k)}</text>
    <text x="${M + 40 + i * 218}" y="902" font-size="22" font-weight="700" fill="${INK}">${esc(v)}</text>`).join('')}

  <text x="${M}" y="962" font-size="20" font-weight="700" fill="${INK}">多链能力矩阵</text>
  <text x="${M}" y="990" font-size="13.5" fill="${SUB}">联盟链只做存证、公链才发资产 —— 我们如实标明每条链能做什么，不做"都能做"的承诺。</text>
  <rect x="${M}" y="1006" width="${W - M * 2}" height="34" rx="8" fill="#eef3f6"/>
  <text x="${M + 24}" y="1029" font-size="13" font-weight="700" fill="${SUB}">链</text>
  <text x="${M + 470}" y="1029" font-size="13" font-weight="700" fill="${SUB}">存证锚定</text>
  <text x="${M + 610}" y="1029" font-size="13" font-weight="700" fill="${SUB}">按根反查</text>
  <text x="${M + 750}" y="1029" font-size="13" font-weight="700" fill="${SUB}">资产发行</text>
  <text x="${M + 890}" y="1029" font-size="13" font-weight="700" fill="${SUB}">DID</text>
  <text x="${M + 980}" y="1029" font-size="13" font-weight="700" fill="${SUB}">状态</text>
  ${provRows}

  <rect x="${M}" y="1240" width="${W - M * 2}" height="132" rx="12" fill="#fff8ec" stroke="#f1dfc2"/>
  <text x="${M + 24}" y="1272" font-size="17" font-weight="700" fill="#8a5a00">我们主动说清边界 —— 这比只说能力更可信</text>
  <text x="${M + 24}" y="1298" font-size="13.5" fill="#8a5a00">· 微信生态内永久不做藏品发行 / 交易 / 转赠（监管已明确，我们不碰）</text>
  <text x="${M + 24}" y="1320" font-size="13.5" fill="#8a5a00">· 不做钱包地址、助记词、转账界面；链上只放哈希指纹，不放任何个人信息</text>
  <text x="${M + 24}" y="1342" font-size="13.5" fill="#8a5a00">· 境外业务（稳定币 / 境外 Token）与境内完全隔离，独立主体、独立合规</text>
  <text x="${M + 24}" y="1364" font-size="13.5" fill="#8a5a00">· 不对任何权益承诺升值、兑付或可交易；贡献分不对应股权</text>

  <line x1="${M}" y1="1400" x2="${W - M}" y2="1400" stroke="${LINE}" stroke-width="1.5"/>
  <text x="${M}" y="1440" font-size="18" font-weight="700" fill="${INK}">现场扫码验证（三张牌）</text>
  ${qr(`${baseUrl}/verify`, M, 1462, 128)}
  <text x="${M + 148}" y="1492" font-size="14" font-weight="700" fill="${INK}">① 记录复核</text>
  <text x="${M + 148}" y="1516" font-size="12.5" fill="${SUB}">输入单号或日期，浏览器本地重算</text>
  <text x="${M + 148}" y="1538" font-size="12" fill="${BRAND}" font-family="Consolas,Menlo,monospace">${esc(baseUrl)}/verify</text>

  ${qr(`${baseUrl}/vc`, M + 470, 1462, 128)}
  <text x="${M + 618}" y="1492" font-size="14" font-weight="700" fill="${INK}">② 身份验签</text>
  <text x="${M + 618}" y="1516" font-size="12.5" fill="${SUB}">粘贴凭证即可验签</text>
  <text x="${M + 618}" y="1538" font-size="12" fill="${BRAND}" font-family="Consolas,Menlo,monospace">${esc(baseUrl)}/vc</text>

  ${qr(`${baseUrl}/open/chain/capabilities`, W - M - 134, 1462, 128)}
  <text x="${W - M - 146}" y="1492" text-anchor="end" font-size="14" font-weight="700" fill="${INK}">③ 链能力声明</text>
  <text x="${W - M - 146}" y="1516" text-anchor="end" font-size="12.5" fill="${SUB}">当前接了哪条链、能做什么</text>
  <text x="${W - M - 146}" y="1538" text-anchor="end" font-size="11" fill="${BRAND}" font-family="Consolas,Menlo,monospace">/open/chain/capabilities</text>

  <text x="${M}" y="${H - 44}" font-size="12.5" fill="${FAINT}">上海璟宬文化发展有限公司 · 向往的自由（Tourism Web3 OS）· 本页数据由系统实时生成</text>
  <text x="${W - M}" y="${H - 44}" text-anchor="end" font-size="12.5" fill="${FAINT}">可信能力说明 v1 · 2026</text>
</svg>`
}

const FONTS = ['C:/Windows/Fonts/simhei.ttf', 'C:/Windows/Fonts/msyh.ttc', '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc']

export function renderPng(svg) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: W }, font: { loadSystemFonts: true, defaultFontFamily: 'Microsoft YaHei', fontFiles: FONTS }, background: '#ffffff' })
    .render().asPng()
}

export function renderPdf(svg) {
  return pngToPdf(renderPng(svg), { widthPt: 595.28, heightPt: 841.89, title: '向往的自由 · 可信能力一页纸', author: '上海璟宬文化发展有限公司' })
}
