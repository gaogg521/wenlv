// 生成线路示意图（纯 Node PNG：天空渐变 + 太阳 + 山峦 + 水面），每主题一色
// 运行：node scripts/gen-scene-images.mjs  → 输出到 api/scripts/scene/*.png（剧本随后经接口上传）
import zlib from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'

const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return (b) => { let c = 0xffffffff; for (const x of b) c = t[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 } })()
const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(CRC(td)); return Buffer.concat([l, td, c]) }
const png = (w, h, rgba) => {
  const raw = Buffer.alloc(h * (w * 4 + 1))
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4) }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t))

// 场景：天空色 → 地平线色，太阳位置，三层山色，水面反光
const SCENES = {
  zhujiajiao: { sky: [255, 190, 120], horizon: [232, 119, 34], sun: [0.72, 0.3], m1: [190, 100, 40], m2: [150, 75, 32], water: [90, 50, 30] },
  yoga: { sky: [150, 230, 210], horizon: [14, 159, 138], sun: [0.3, 0.26], m1: [30, 130, 112], m2: [18, 95, 82], water: [12, 70, 60] },
  garden: { sky: [160, 190, 245], horizon: [82, 113, 196], sun: [0.78, 0.24], m1: [70, 98, 175], m2: [50, 70, 135], water: [35, 48, 95] },
  camping: { sky: [200, 165, 240], horizon: [130, 80, 210], sun: [0.5, 0.2], m1: [105, 65, 175], m2: [75, 45, 130], water: [50, 30, 85] },
}
const W = 860, H = 560
function draw(s) {
  const rgba = Buffer.alloc(W * H * 4)
  const horizon = 0.72
  for (let y = 0; y < H; y++) {
    const t = y / H
    for (let x = 0; x < W; x++) {
      let c
      if (t < horizon) {
        c = mix(s.sky, s.horizon, Math.pow(t / horizon, 1.25))
        const [sx, sy] = s.sun
        const d = Math.hypot(x / W - sx, t - sy)
        if (d < 0.07) c = mix([255, 250, 230], c, Math.min(1, d / 0.07))
        else if (d < 0.1) c = mix(c, [255, 245, 215], 0.35)
      } else {
        const wt = (t - horizon) / (1 - horizon)
        c = mix(s.water, s.horizon, 0.35 * (1 - wt))
        if ((y * 7 + x * 3) % 97 < 4 && wt < 0.7) c = mix(c, [255, 255, 255], 0.28) // 水面波光
      }
      const o = (y * W + x) * 4
      rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255
    }
  }
  // 三层山峦
  const ridge = (base, amp, freq, color) => {
    for (let x = 0; x < W; x++) {
      const hgt = base + amp * (Math.sin(x / W * freq * Math.PI) * 0.6 + Math.sin(x / W * freq * 2.7 * Math.PI) * 0.4)
      const top = Math.round(horizon * H * hgt)
      for (let y = top; y < Math.round(horizon * H); y++) {
        const o = (y * W + x) * 4
        rgba[o] = color[0]; rgba[o + 1] = color[1]; rgba[o + 2] = color[2]
      }
    }
  }
  ridge(0.62, 0.1, 3, s.m2)
  ridge(0.72, 0.07, 5, s.m1)
  return png(W, H, rgba)
}
const dir = path.join(import.meta.dirname, 'scene')
fs.mkdirSync(dir, { recursive: true })
for (const [k, s] of Object.entries(SCENES)) {
  fs.writeFileSync(path.join(dir, k + '.jpg.png'), draw(s))
  console.log('scene:', k, Math.round(fs.statSync(path.join(dir, k + '.jpg.png')).size / 1024) + 'KB')
}
