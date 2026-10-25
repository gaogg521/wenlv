// 生成 tabBar 图标：81×81 PNG（微信规范），3x 超采样抗锯齿，零依赖（zlib 手工 PNG 编码）
import zlib from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'

const CRC = (() => {
  const t = []
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 }
  return (buf) => { let c = 0xffffffff; for (const b of buf) c = t[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
})()
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(CRC(td))
  return Buffer.concat([len, td, crc])
}
function png(size, rgba) {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8; ihdr[9] = 6 // 8-bit RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}
const hex2rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]

// 各图标形状谓词：输入归一化坐标 (0..1)，返回是否命中（含内部镂空）
const inRect = (x, y, x1, y1, x2, y2, r = 0.05) => {
  if (x < x1 || x > x2 || y < y1 || y > y2) return false
  const cx = Math.max(x1 + r, Math.min(x, x2 - r)), cy = Math.max(y1 + r, Math.min(y, y2 - r))
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r || (x >= x1 + r && x <= x2 - r) || (y >= y1 + r && y <= y2 - r)
}
const inCircle = (x, y, cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r
const inTri = (x, y, ax, ay, bx, by, cx, cy) => {
  const s = (ax - cx) * (y - cy) - (ay - cy) * (x - cx)
  const t = (bx - ax) * (y - ay) - (by - ay) * (x - ax)
  const u = (cx - bx) * (y - by) - (cy - by) * (x - bx)
  return (s >= 0 && t >= 0 && u >= 0) || (s <= 0 && t <= 0 && u <= 0)
}

const SHAPES = {
  home: (x, y) => inTri(x, y, 0.5, 0.08, 0.06, 0.46, 0.94, 0.46) || (inRect(x, y, 0.16, 0.44, 0.84, 0.92, 0.06) && !inRect(x, y, 0.42, 0.62, 0.58, 0.92, 0.04)),
  tour: (x, y) => (inCircle(x, y, 0.5, 0.5, 0.44) && !inCircle(x, y, 0.5, 0.5, 0.33)) || inTri(x, y, 0.5, 0.24, 0.38, 0.62, 0.62, 0.62) || inTri(x, y, 0.34, 0.68, 0.2, 0.8, 0.48, 0.8) || inTri(x, y, 0.66, 0.68, 0.52, 0.8, 0.8, 0.8),
  shop: (x, y) => {
    const body = inRect(x, y, 0.14, 0.34, 0.86, 0.92, 0.1)
    const handle = inCircle(x, y, 0.5, 0.34, 0.24) && !inCircle(x, y, 0.5, 0.34, 0.14) && y < 0.4
    return body || handle
  },
  bean: (x, y) => {
    const c = inCircle(x, y, 0.5, 0.5, 0.42)
    const slit = Math.abs((x - 0.5) * 0.7 + (y - 0.5) * 0.7) < 0.05
    return c && !slit
  },
  me: (x, y) => inCircle(x, y, 0.5, 0.3, 0.2) || inRect(x, y, 0.16, 0.56, 0.84, 0.94, 0.24),
  grid: (x, y) => {
    const g = [[0.1, 0.1], [0.54, 0.1], [0.1, 0.54], [0.54, 0.54]]
    return g.some(([gx, gy]) => x >= gx && x <= gx + 0.36 && y >= gy && y <= gy + 0.36)
  },
  list: (x, y) => {
    for (const yy of [0.14, 0.42, 0.7]) {
      if (inCircle(x, y, 0.14, yy + 0.08, 0.08)) return true
      if (inRect(x, y, 0.3, yy, 0.92, yy + 0.16, 0.08)) return true
    }
    return false
  },
  box: (x, y) => (inRect(x, y, 0.12, 0.3, 0.88, 0.44, 0.04) || inRect(x, y, 0.16, 0.44, 0.84, 0.92, 0.05)) && !(x > 0.44 && x < 0.56 && y > 0.52 && y < 0.7),
}

function render(shape, color, size = 81) {
  const [r, g, b] = hex2rgb(color)
  const rgba = Buffer.alloc(size * size * 4)
  const SS = 3
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let hit = 0
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        if (shape((px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size)) hit++
      }
      const a = Math.round(255 * hit / (SS * SS))
      const o = (py * size + px) * 4
      rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = a
    }
  }
  return png(size, rgba)
}

const jobs = [
  ['mini-a', [['home', 'home'], ['tour', 'tour-list'], ['shop', 'shop'], ['bean', 'bean'], ['me', 'me']], '#8a919c', '#e87722'],
  ['mini-b', [['grid', 'index'], ['list', 'orders'], ['box', 'supply'], ['me', 'me']], '#8a919c', '#7b5aa6'],
]
const root = path.resolve(import.meta.dirname, '..', '..')
for (const [app, icons, off, on] of jobs) {
  const dir = path.join(root, app, 'assets', 'tab')
  fs.mkdirSync(dir, { recursive: true })
  for (const [shape, name] of icons) {
    fs.writeFileSync(path.join(dir, `${name}.png`), render(SHAPES[shape], off))
    fs.writeFileSync(path.join(dir, `${name}-on.png`), render(SHAPES[shape], on))
  }
  console.log(app, 'icons ->', dir)
}
