// 极简 PDF 生成：PNG → PDF（单页、DeviceRGB、FlateDecode 图像 XObject）
// 为什么不用 pdfkit/浏览器打印：本项目零框架、只装必要依赖；存证报告是"一页证书"，
// 用 SVG 排版（中文由 resvg 走系统字体）+ 嵌入位图，视觉可控且不引新依赖。
import zlib from 'node:zlib'
import { PNG } from 'pngjs'

const PT_PER_INCH = 72

/**
 * @param {Buffer} pngBuf  PNG 二进制
 * @param {{widthPt?:number,heightPt?:number,title?:string,author?:string}} opt 页面尺寸（默认 A4 纵向）
 * @returns {Buffer} PDF 二进制
 */
export function pngToPdf(pngBuf, opt = {}) {
  const png = PNG.sync.read(pngBuf)
  const { width: iw, height: ih, data } = png

  // RGBA → RGB（PDF 的 DeviceRGB 不带 alpha；证书背景本身不透明，无需合成）
  const rgb = Buffer.alloc(iw * ih * 3)
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
    const a = data[i + 3] / 255
    // 与白底合成，避免半透明像素变成黑块
    rgb[j] = Math.round(data[i] * a + 255 * (1 - a))
    rgb[j + 1] = Math.round(data[i + 1] * a + 255 * (1 - a))
    rgb[j + 2] = Math.round(data[i + 2] * a + 255 * (1 - a))
  }
  const deflated = zlib.deflateSync(rgb, { level: 9 })

  const wPt = opt.widthPt || (A4_W_IN * PT_PER_INCH)
  const hPt = opt.heightPt || (A4_H_IN * PT_PER_INCH)

  const enc = (s) => Buffer.from(s, 'latin1')
  const parts = []
  const offsets = []
  let pos = 0
  const push = (b) => { parts.push(b); pos += b.length }
  const obj = (n, body, stream) => {
    offsets[n] = pos
    push(enc(`${n} 0 obj\n${body}\n`))
    if (stream) { push(enc('stream\n')); push(stream); push(enc('\nendstream\n')) }
    push(enc('endobj\n'))
  }

  push(enc('%PDF-1.4\n%\u00E2\u00E3\u00CF\u00D3\n'))

  obj(1, '<< /Type /Catalog /Pages 2 0 R >>')
  obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
  obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${wPt.toFixed(2)} ${hPt.toFixed(2)}] ` +
    '/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>')
  obj(4, `<< /Type /XObject /Subtype /Image /Width ${iw} /Height ${ih} /ColorSpace /DeviceRGB ` +
    `/BitsPerComponent 8 /Filter /FlateDecode /Length ${deflated.length} >>`, deflated)

  const content = Buffer.from(`q\n${wPt.toFixed(2)} 0 0 ${hPt.toFixed(2)} 0 0 cm\n/Im0 Do\nQ\n`, 'latin1')
  obj(5, `<< /Length ${content.length} >>`, content)

  const info = []
  if (opt.title) info.push(`/Title (${pdfStr(opt.title)})`)
  if (opt.author) info.push(`/Author (${pdfStr(opt.author)})`)
  info.push(`/Producer (wanderlust-attest)`, `/CreationDate (D:${pdfDate()})`)
  obj(6, `<< ${info.join(' ')} >>`)

  const xrefPos = pos
  let xref = `xref\n0 7\n0000000000 65535 f \n`
  for (let n = 1; n <= 6; n++) xref += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`
  push(enc(xref))
  push(enc(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`))

  return Buffer.concat(parts)
}

const A4_W_IN = 8.27
const A4_H_IN = 11.69

const pdfStr = (s) => String(s).replace(/[\\()]/g, (c) => '\\' + c).replace(/[^\x20-\x7E]/g, '?')

function pdfDate() {
  const d = new Date()
  const p = (n, l = 2) => String(n).padStart(l, '0')
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const ah = p(Math.floor(Math.abs(off) / 60))
  const am = p(Math.abs(off) % 60)
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${sign}${ah}'${am}'`
}
