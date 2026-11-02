// 存证报告（一页 A4 证书）：订单凭证 / 旅豆账本日终封存
// 生成路径：数据 → SVG（中文走系统字体）→ resvg 位图 → PDF
// 设计原则：
//   1. 只呈现"可被第三方独立复核"的东西：哈希、根、路径、链上编号；绝不含姓名/手机号/金额明细
//   2. 每一份报告都必须能在没有本平台登录的情况下被验证（二维码直达 /verify）
//   3. 未真实上链时必须写"待锚定"，不得写成"已上链"
import { Resvg } from '@resvg/resvg-js'
import qrcode from 'qrcode-generator'
import { pngToPdf } from '../infra/pdf.mjs'

const W = 1240
const H = 1754
const M = 84
const BRAND = '#0f766e'
const INK = '#14181f'
const SUB = '#5b6572'
const FAINT = '#98a1b0'
const LINE = '#e3e7ee'
const CARD = '#f7f9fb'

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const cut = (h, n = 20) => (h && h.length > n * 2 ? String(h).slice(0, n) + '…' + String(h).slice(-6) : String(h ?? '—'))

function qrSvg(url, x, y, size) {
  const qr = qrcode(0, 'M')
  qr.addData(url)
  qr.make()
  const n = qr.getModuleCount()
  const cell = size / n
  let rects = ''
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) rects += `<rect x="${(x + c * cell).toFixed(2)}" y="${(y + r * cell).toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}"/>`
    }
  }
  return `<g fill="#111">${rects}</g>`
}

/** 通用行：标签在左、值在右 */
function kvRows(rows, y0, gap = 52) {
  return rows.map((r, i) => {
    const y = y0 + i * gap
    const mono = r.mono !== false
    return `<text x="${M + 24}" y="${y}" font-size="19" fill="${SUB}">${esc(r.k)}</text>
      <text x="${M + 210}" y="${y}" font-size="19" fill="${INK}" ${mono ? 'font-family="Consolas,Menlo,monospace"' : ''}>${esc(r.v)}</text>`
  }).join('')
}

function sectionTitle(txt, y) {
  return `<rect x="${M}" y="${y - 17}" width="5" height="22" rx="2.5" fill="${BRAND}"/>
    <text x="${M + 18}" y="${y}" font-size="22" font-weight="700" fill="${INK}">${esc(txt)}</text>`
}

/**
 * @param {object} d 报告数据
 * @param {string} d.docTitle   主标题（存证证明）
 * @param {string} d.docSub     副标题
 * @param {string} d.certNo     证明编号
 * @param {object[]} d.meta     [{k,v}] 基本信息
 * @param {object[]} d.finger   [{k,v}] 指纹与锚定
 * @param {object[]} d.path     [{level,dir,h,dup}] 证明路径
 * @param {string[]} d.steps    核验步骤
 * @param {string} d.verifyUrl  在线复核地址
 * @param {string[]} d.notes    页脚声明
 * @param {string} d.kind       报告类型标签
 */
export function buildSvg(d) {
  const now = new Date()
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

  const pathRows = (d.path || []).map((p) => ({
    k: `${p.dir === 'R' ? '兄弟在右' : '兄弟在左'}${p.dup ? ' · 末节点自身复制' : ''}`,
    v: cut(p.h, 26),
  }))

  // ── 顺序游标布局：每个区块算完高度再往下走，杜绝硬编码 Y 造成的重叠 ──
  const out = []
  const cardTop = (y, rows) => {
    const h = rows * 52 + 36
    out.push(`<rect x="${M}" y="${y}" width="${W - M * 2}" height="${h}" rx="10" fill="${CARD}" stroke="${LINE}"/>`)
    return { y, h, bottom: y + h }
  }

  let y = 262                                  // 证明编号行基线
  y += 60
  out.push(sectionTitle(d.s1Title || '一、基本信息', y))
  let c = cardTop(y + 22, d.meta.length)
  out.push(d.meta.map((r, i) => `<text x="${M + 24}" y="${c.y + 42 + i * 52}" font-size="19" fill="${SUB}">${esc(r.k)}</text>
    <text x="${M + 210}" y="${c.y + 42 + i * 52}" font-size="${r.small ? 16 : 19}" fill="${INK}" ${r.mono !== false ? 'font-family="Consolas,Menlo,monospace"' : ''}>${esc(r.v)}</text>`).join(''))
  y = c.bottom + 62

  out.push(sectionTitle(d.s2Title || '二、指纹与锚定', y))
  c = cardTop(y + 22, d.finger.length)
  out.push(d.finger.map((r, i) => `<text x="${M + 24}" y="${c.y + 42 + i * 52}" font-size="19" fill="${SUB}">${esc(r.k)}</text>
    <text x="${M + 210}" y="${c.y + 42 + i * 52}" font-size="${r.small ? 15 : 18}" fill="${r.warn ? '#b45309' : INK}" ${r.mono !== false ? 'font-family="Consolas,Menlo,monospace"' : ''}>${esc(r.v)}</text>`).join(''))
  y = c.bottom + 62

  out.push(sectionTitle(d.s3Title || '三、证明路径（可离线重算）', y))
  out.push(`<text x="${M}" y="${y + 32}" font-size="16" fill="${SUB}">${esc(d.pathHint || '从「载荷哈希」起，按下列顺序逐层计算 sha256(左 + 右)，末值应等于上方 Merkle 根。')}</text>`)
  if (pathRows.length) {
    const y0 = y + 32 + 40
    out.push(pathRows.map((r, i) => `<text x="${M + 24}" y="${y0 + i * 40}" font-size="17" fill="${SUB}">第 ${i + 1} 层</text>
      <text x="${M + 150}" y="${y0 + i * 40}" font-size="17" fill="${SUB}">${esc(r.k)}</text>
      <text x="${M + 470}" y="${y0 + i * 40}" font-size="17" fill="${INK}" font-family="Consolas,Menlo,monospace">${esc(r.v)}</text>`).join(''))
    y = y0 + (pathRows.length - 1) * 40 + 56
  } else {
    out.push(`<text x="${M}" y="${y + 80}" font-size="17" fill="${FAINT}">${esc(d.pathEmpty || '该记录尚未打包进批次，暂无证明路径（打包后自动生成）')}</text>`)
    y = y + 80 + 52
  }

  out.push(sectionTitle(d.s4Title || '四、如何核验', y))
  out.push(d.steps.map((s, i) => `<circle cx="${M + 11}" cy="${y + 36 + i * 40 - 6}" r="11" fill="${BRAND}"/>
    <text x="${M + 11}" y="${y + 36 + i * 40}" text-anchor="middle" font-size="14" font-weight="700" fill="#fff">${i + 1}</text>
    <text x="${M + 34}" y="${y + 36 + i * 40}" font-size="17" fill="${INK}">${esc(s)}</text>`).join(''))
  y = y + 36 + (d.steps.length - 1) * 40

  // ── 页脚：贴着内容走，但整体上提避免超出 A4 ──
  // y 此时是最后一条核验步骤的基线：必须留出 96px 才放页脚，且二维码整体不能越过 H-260
  const footY = Math.min(Math.max(y + 96, 1340), H - 260)
  out.push(`<line x1="${M}" y1="${footY}" x2="${W - M}" y2="${footY}" stroke="${LINE}" stroke-width="1.5"/>`)
  out.push(`<rect x="${M - 8}" y="${footY + 26}" width="166" height="166" fill="#ffffff"/>`)
  out.push(qrSvg(d.verifyUrl, M, footY + 34, 150))
  out.push(`<text x="${M + 192}" y="${footY + 60}" font-size="17" font-weight="700" fill="${INK}">扫码在线复核</text>`)
  out.push(`<text x="${M + 192}" y="${footY + 90}" font-size="14" fill="${SUB}" font-family="Consolas,Menlo,monospace">${esc(d.verifyUrl)}</text>`)
  out.push(d.notes.map((n, i) => `<text x="${M + 192}" y="${footY + 130 + i * 28}" font-size="14" fill="${SUB}">${esc(n)}</text>`).join(''))
  out.push(`<rect x="${W - M - 210}" y="${footY + 34}" width="210" height="96" rx="8" fill="none" stroke="${LINE}" stroke-dasharray="6 5"/>`)
  out.push(`<text x="${W - M - 105}" y="${footY + 78}" text-anchor="middle" font-size="14" fill="${FAINT}">${esc(d.sealLabel || '平台存证章')}</text>`)
  out.push(`<text x="${W - M - 105}" y="${footY + 104}" text-anchor="middle" font-size="12" fill="${FAINT}">（正式版加盖电子签章）</text>`)

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <rect x="0" y="0" width="${W}" height="10" fill="${BRAND}"/>
  <rect x="${M}" y="96" width="3" height="86" fill="${BRAND}"/>
  <text x="${M + 22}" y="132" font-size="30" font-weight="700" fill="${INK}" letter-spacing="1">向往的自由</text>
  <text x="${M + 22}" y="164" font-size="15" fill="${SUB}" letter-spacing="3">${esc(d.brandSub || 'WANDERLUST · 向往自由链')}</text>
  <text x="${W - M}" y="126" text-anchor="end" font-size="42" font-weight="700" fill="${INK}">${esc(d.docTitle)}</text>
  <text x="${W - M}" y="158" text-anchor="end" font-size="13" fill="${FAINT}" letter-spacing="2">${esc(d.docSub)}</text>
  <text x="${W - M}" y="192" text-anchor="end" font-size="15" fill="${BRAND}" font-weight="700">${esc(d.kind)}</text>
  <line x1="${M}" y1="216" x2="${W - M}" y2="216" stroke="${LINE}" stroke-width="1.5"/>
  <text x="${M}" y="262" font-size="16" fill="${SUB}">${esc(d.certLabel || '证明编号')}</text>
  <text x="${M + 120}" y="262" font-size="16" fill="${INK}" font-family="Consolas,Menlo,monospace">${esc(d.certNo)}</text>
  <text x="${W - M}" y="262" text-anchor="end" font-size="16" fill="${SUB}">生成时间 ${esc(stamp)}</text>
  ${out.join('\n')}
  <text x="${M}" y="${H - 46}" font-size="13" fill="${FAINT}">${esc(d.footNote || '本证明由系统自动生成 · 哈希指纹已固定，业务数据留存于平台数据库 · 不含个人身份与金额明细')}</text>
  <text x="${W - M}" y="${H - 46}" text-anchor="end" font-size="13" fill="${FAINT}">wanderlust / attestation report v1</text>
</svg>`
}

const FONT_FILES = [
  'C:/Windows/Fonts/simhei.ttf',
  'C:/Windows/Fonts/msyh.ttc',
  'C:/Windows/Fonts/simsun.ttc',
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
]

/** SVG → PDF（A4 纵向） */
export function svgToPdf(svg) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: W },
    font: { loadSystemFonts: true, defaultFontFamily: 'Microsoft YaHei', fontFiles: FONT_FILES },
    background: '#ffffff',
  })
  const png = resvg.render().asPng()
  return pngToPdf(png, { widthPt: 595.28, heightPt: 841.89, title: '向往的自由 · 存证证明', author: '上海璟宬文化发展有限公司' })
}

/** SVG → PNG（自检用：不开浏览器也能看排版对不对） */
export function svgToPng(svg) {
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: W },
    font: { loadSystemFonts: true, defaultFontFamily: 'Microsoft YaHei', fontFiles: FONT_FILES },
    background: '#ffffff',
  })
  return resvg.render().asPng()
}

/* ============ 数据装配：把 /open/verify 的返回变成报告内容 ============ */

const anchorState = (v) => (v.chainRef
  ? '已锚定（链上可查）'
  : '已打包 · 待锚定（根已生成，链凭据到位后补锚）')

/** 订单/凭证存证证明 */
export function orderReportDoc(v, baseUrl) {
  const verifyUrl = `${baseUrl}/verify?no=${encodeURIComponent(v.bizRef)}`
  return {
    docTitle: '存证证明',
    docSub: 'CERTIFICATE OF ATTESTATION',
    kind: '订单履约凭证',
    certNo: 'CR-' + String(v.bizRef).replace(/[^A-Za-z0-9]/g, '').slice(-14) + '-' + String(v.payloadHash || '').slice(0, 6).toUpperCase(),
    verifyUrl,
    meta: [
      { k: '业务单号', v: v.bizRef },
      { k: '业务类型', v: '订单完成（状态 50）', mono: false },
      { k: '记录版本', v: 'v' + v.versionNo, mono: false },
      { k: '所处批次', v: v.batchSeq ? '#' + v.batchSeq + ' · 第 ' + (v.leafIndex ?? 0) + ' 片叶子' : '未打包', mono: false },
    ],
    finger: [
      { k: '载荷哈希', v: v.payloadHash || '—' },
      { k: 'Merkle 根', v: v.merkleRoot || '—' },
      { k: '前一批根', v: v.prevRoot || '链起点（本批为存证链第一环）', small: true },
      { k: '锚定状态', v: anchorState(v), mono: false, warn: !v.chainRef },
      { k: '链上编号', v: v.chainRef || '待锚定', warn: !v.chainRef },
      { k: '锚定时间', v: v.anchoredAt ? String(v.anchoredAt).slice(0, 19) : '待锚定', mono: false },
    ],
    path: (v.leafPath || []).map((p, i) => ({ level: i + 1, dir: p.p, h: p.h, dup: p.dup })),
    steps: [
      '打开上方二维码或链接，在浏览器内当场重算哈希（Web Crypto，无需登录）',
      Number(v.merkleVersion) === 2
        ? '从「载荷哈希」起，先算 sha256(0x00‖叶)，再按第三节顺序逐层 sha256(0x01‖左‖右)（字节拼接），末值应等于 Merkle 根'
        : '从「载荷哈希」起，按第三节顺序逐层计算 sha256(左 + 右)，末值应等于 Merkle 根',
      v.chainRef ? '持「链上编号」到链数根链上浏览器查询，可看到该 Merkle 根与锚定时间' : '待锚定：链接入完成后，链上编号自动出现在此证明中',
    ],
    notes: [
      '本证明仅固定哈希指纹与时点，不含姓名、手机号、身份证号与金额明细。',
      '任何一方均可在不依赖本平台的情况下独立复核。',
    ],
  }
}

/** 旅豆账本日终封存证明 */
export function beanDayReportDoc(v, baseUrl) {
  const verifyUrl = `${baseUrl}/verify?date=${encodeURIComponent(v.bizDate)}`
  return {
    docTitle: '账本封存证明',
    docSub: 'LEDGER SEALING CERTIFICATE',
    kind: '旅豆账本 · 日终',
    certNo: 'BD-' + String(v.bizDate).replace(/-/g, '') + '-' + String(v.merkleRoot || '').slice(0, 6).toUpperCase(),
    verifyUrl,
    meta: [
      { k: '业务日期', v: v.bizDate },
      { k: '账本笔数', v: Number(v.leafCount) + ' 笔（借贷双向合计）', mono: false },
      { k: '记账口径', v: '双分录：每笔业务同时记借贷两条', mono: false },
      { k: '封存规则', v: '借贷恒等（Σ借 = Σ贷）方允许封存', mono: false },
    ],
    finger: [
      { k: 'Σ贷（发放）', v: String(v.creditSum) + ' 豆' },
      { k: 'Σ借（消耗）', v: String(v.debitSum) + ' 豆' },
      { k: '借贷恒等', v: v.balanced ? '成立（差额 0）' : '不成立', mono: false, warn: !v.balanced },
      { k: 'Merkle 根', v: v.merkleRoot || '—' },
      { k: '前一日根', v: v.prevRoot || '链起点', small: true },
      { k: '锚定状态', v: anchorState(v), mono: false, warn: !v.chainRef },
      { k: '链上编号', v: v.chainRef || '待锚定', warn: !v.chainRef },
    ],
    path: [],
    pathHint: '账本以「日终根」为证明单元：根一旦封存，该日全部流水即被固定。',
    pathEmpty: '任意一笔流水均可经平台接口单独出具包含路径；本页只呈现日终根，不逐条展开。',
    steps: [
      '打开上方二维码或链接，查看该日账本的 Σ贷 / Σ借 与日终根',
      'Σ贷 = Σ借 说明账本自洽：没有凭空的豆被创造出来（对应「严禁超发」）',
      v.chainRef ? '持「链上编号」到链数根链上浏览器查询该日终根' : '待锚定：链接入完成后，链上编号自动出现在此证明中',
    ],
    notes: [
      '本证明用于向审计、政府与投资方说明：平台旅豆的发行与消耗逐日自洽、可追溯。',
      '账本明细留存于平台数据库，不含个人身份与金额归属。',
    ],
  }
}

/**
 * 结算可信记录（T1 口径：给商户看，绝不出现「存证 / 链 / Merkle / Web3」字样）
 * 为什么金额可以出现在这份文件里：它是商户自己持有的结算单；对外公开的复核页只出校验码，不出金额。
 */
export function settlementReportDoc(v, baseUrl) {
  const verifyUrl = `${baseUrl}/verify?settle=${encodeURIComponent(v.settlementId)}&mode=t1`
  const st = ['生成待确认', '商户已确认', '平台已复核', '已结算完成', '异议中'][Number(v.status)] || '进行中'
  return {
    docTitle: '结算可信记录',
    docSub: 'SETTLEMENT RECORD',
    kind: '商户结算 · 记录封存',
    brandSub: 'WANDERLUST',
    sealLabel: '平台记录章',
    footNote: '本记录由系统自动生成 · 校验码已固定，账单明细留存于平台数据库 · 对外复核不展示金额',
    certNo: 'ST-' + String(v.settlementId).padStart(6, '0') + '-' + String(v.payloadHash || '').slice(0, 6).toUpperCase(),
    certLabel: '记录编号',
    s1Title: '一、基本信息',
    s2Title: '二、账目与校验码',
    s3Title: '三、核对说明',
    s4Title: '四、如何核对',
    verifyUrl,
    meta: [
      { k: '结算单号', v: '#' + v.settlementId, mono: true },
      { k: '结算周期', v: v.period, mono: true },
      { k: '订单笔数', v: String(v.orderCount) + ' 笔', mono: false },
      { k: '结算总额', v: (Number(v.totalAmount) / 100).toFixed(2) + ' 元', mono: false },
      { k: '当前状态', v: st, mono: false },
    ],
    finger: [
      { k: '履约结算', v: (Number(v.amtFulfill) / 100).toFixed(2) + ' 元' },
      { k: '平台服务费', v: (Number(v.amtService) / 100).toFixed(2) + ' 元' },
      { k: '推广服务费', v: (Number(v.amtPromoter) / 100).toFixed(2) + ' 元' },
      { k: '权益预算', v: (Number(v.amtBeanbudget) / 100).toFixed(2) + ' 元' },
      { k: '留存毛利', v: (Number(v.amtRetained) / 100).toFixed(2) + ' 元' },
      { k: '五项合计', v: (Number(v.totalAmount) / 100).toFixed(2) + ' 元（恒等：合计 = 结算总额）', mono: false },
      ...(Number(v.feeTotal) > 0 ? [
        { k: '退改手续费', v: (Number(v.feeTotal) / 100).toFixed(2) + ' 元（' + v.feeCount + ' 笔）', mono: false },
        { k: '其中商户分成', v: (Number(v.feeMerchant) / 100).toFixed(2) + ' 元', mono: false },
      ] : []),
      { k: '应付商户', v: ((Number(v.amtFulfill) + Number(v.feeMerchant || 0)) / 100).toFixed(2) + ' 元（履约结算 + 手续费分成）', mono: false },
      { k: '整单校验码', v: v.merkleRoot || v.payloadHash || '—', small: true },
    ],
    path: [],
    pathHint: '本记录以「整单校验码」为核对单元：账单任何一处改动，校验码都会完全不同。',
    pathEmpty: '扫码可在浏览器中直接核对校验码，无需登录、无需安装。',
    steps: [
      '扫描右侧二维码，打开复核页，比对校验码是否与本记录一致',
      '复核页只展示校验码与封存状态，不展示金额与商户信息',
      '若对账单有异议，在商户端发起异议，平台按流程重算并重新封存',
    ],
    notes: [
      '本记录供商户留存与对账使用，不含用户个人信息。',
      '校验码是账单内容的指纹：它是"说不清就拿出来对"的那张底牌。',
    ],
  }
}
