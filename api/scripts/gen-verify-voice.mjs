// 生成核销语音提示音（16-bit PCM WAV，8kHz 单声道）：
// ok.wav 双升调（核销成功）/ fail.wav 低鸣（无效码）/ dup.wav 三连音（重复码）
// 运行：node scripts/gen-verify-voice.mjs  → 输出 mini-b/assets/voice/*.wav
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SR = 8000
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'mini-b', 'assets', 'voice')
fs.mkdirSync(root, { recursive: true })

function tone(freq, ms, vol = 0.6, shape = 'sine') {
  const n = Math.floor(SR * ms / 1000)
  const out = new Int16Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    let v = Math.sin(2 * Math.PI * freq * t)
    if (shape === 'square') v = Math.sign(v) * 0.7
    // 10ms 淡入淡出防爆音
    const env = Math.min(1, i / (SR * 0.01), (n - i) / (SR * 0.01))
    out[i] = Math.round(v * vol * env * 32767)
  }
  return out
}
function silence(ms) { return new Int16Array(Math.floor(SR * ms / 1000)) }
function concat(...parts) {
  const total = parts.reduce((s, p) => s + p.length, 0)
  const out = new Int16Array(total)
  let off = 0
  for (const p of parts) { out.set(p, off); off += p.length }
  return out
}
function wav(samples) {
  const hdr = Buffer.alloc(44)
  hdr.write('RIFF', 0); hdr.writeUInt32LE(36 + samples.length * 2, 4); hdr.write('WAVE', 8)
  hdr.write('fmt ', 12); hdr.writeUInt32LE(16, 16); hdr.writeUInt16LE(1, 20); hdr.writeUInt16LE(1, 22)
  hdr.writeUInt32LE(SR, 24); hdr.writeUInt32LE(SR * 2, 28); hdr.writeUInt16LE(2, 32); hdr.writeUInt16LE(16, 34)
  hdr.write('data', 36); hdr.writeUInt32LE(samples.length * 2, 40)
  const data = Buffer.from(samples.buffer)
  return Buffer.concat([hdr, data])
}

const files = {
  'ok.wav': concat(tone(880, 90), silence(40), tone(1320, 140)),          // 成功：do→mi 上行
  'fail.wav': concat(tone(220, 260, 0.5, 'square')),                       // 无效：低鸣
  'dup.wav': concat(tone(660, 80), silence(50), tone(660, 80), silence(50), tone(660, 80)), // 重复：三连
}
for (const [name, samples] of Object.entries(files)) {
  fs.writeFileSync(path.join(root, name), wav(samples))
  console.log('written', name, samples.length / SR, 's')
}
