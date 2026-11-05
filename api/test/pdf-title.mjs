// PDF 文档信息里的中文标题/作者必须是 UTF-16BE 十六进制串，不能被替换成 '?'（下载的区块链证明标题曾显示成 "????? ? ????"）
import assert from 'node:assert/strict'
import { pngToPdf, pdfText } from '../src/infra/pdf.mjs'
import { PNG } from 'pngjs'
let pass = 0
const t = (name, fn) => { try { fn(); pass++; console.log('  ✓', name) } catch (e) { console.log('  ✗', name, '\n    ', e.message); process.exitCode = 1 } }
const decode = (hexStr) => { const b = Buffer.from(hexStr.slice(1, -1), 'hex'); assert.equal(b.subarray(0, 2).toString('hex'), 'feff'); const body = Buffer.from(b.subarray(2)); for (let i = 0; i + 1 < body.length; i += 2) { const x = body[i]; body[i] = body[i + 1]; body[i + 1] = x } return body.toString('utf16le') }
console.log('== PDF 中文标题 ==')
t('ASCII 仍用括号串并转义；中文用 <FEFF…> 且可还原', () => {
  assert.equal(pdfText('a(b)c\\d'), '(a\\(b\\)c\\\\d)')
  assert.equal(decode(pdfText('向往的自由 · 存证证明')), '向往的自由 · 存证证明')
  assert.equal(decode(pdfText('𠮷 emoji 😀')), '𠮷 emoji 😀')   // 代理对
})
t('真实生成的 PDF：Info 里是 UTF-16BE 标题，不含 ?????', () => {
  const png = new PNG({ width: 2, height: 2 }); png.data.fill(255)
  const pdf = pngToPdf(PNG.sync.write(png), { title: '向往的自由 · 存证证明', author: '上海璟宬文化发展有限公司' }).toString('latin1')
  const m = pdf.match(/\/Title (<[0-9A-F]+>)/); assert.ok(m, '没有十六进制 Title'); assert.equal(decode(m[1]), '向往的自由 · 存证证明')
  assert.ok(!/\/Title \(\?/.test(pdf), '标题又被替换成问号了')
  assert.equal(decode(pdf.match(/\/Author (<[0-9A-F]+>)/)[1]), '上海璟宬文化发展有限公司')
})
console.log(`\n${pass} 项通过${process.exitCode ? '，有失败' : ''}`)
