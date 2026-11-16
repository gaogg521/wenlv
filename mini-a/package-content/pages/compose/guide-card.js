const GUIDE_STYLES = [
  { name: '路线卡', background: '#e8f2ed', accent: '#21604e', ink: '#183a31', numbered: true },
  { name: '景点清单', background: '#edf2fa', accent: '#345686', ink: '#243857', numbered: true },
  { name: '图文拼贴', background: '#fff1d9', accent: '#9a4d27', ink: '#543222', numbered: false },
]
const WIDTH = 720

function suggestTitle(text, scenicName = '', topic = '') {
  const clean = value => String(value || '').replace(/\s+/g, ' ').trim()
  const limit = value => {
    let result = ''
    for (const char of value) {
      if (result.length + char.length > 20) break
      result += char
    }
    return result.trim()
  }
  const excerpt = clean(String(text || '').split(/[。！？!?；;\n]/).find(line => line.trim())).replace(/^[\s\-–—•#·\d.、]+/, '')
  const place = clean(scenicName) || clean(topic).replace(/^#+/, '')
  if (place && excerpt && !excerpt.includes(place) && place.length <= 10) return limit(place + '｜' + excerpt)
  if (excerpt) return limit(excerpt)
  return limit(place ? place + '旅行手记' : '旅途中的小发现')
}

function wrap(ctx, text, width) {
  const lines = []
  let line = ''
  for (const char of text) {
    if (line && ctx.measureText(line + char).width > width) {
      lines.push(line)
      line = ''
    }
    line += char
  }
  if (line) lines.push(line)
  return lines
}

async function renderGuide(page, { title, text, photo, style }) {
  const photoInfo = photo ? await new Promise((resolve, reject) => wx.getImageInfo({ src: photo, success: resolve, fail: reject })) : null
  const ctx = wx.createCanvasContext('guideCard', page)
  ctx.setFontSize(56)
  const headings = wrap(ctx, title, 600)
  ctx.setFontSize(29)
  const paragraphs = text.trim().split(/\n+/).map(line => line.trim()).filter(Boolean)
  const cards = paragraphs.slice(0, 7).concat(paragraphs.length > 7 ? [paragraphs.slice(7).join(' · ')] : [])
    .map(line => wrap(ctx, line, 526))
  const top = 136 + headings.length * 66
  const photoHeight = photoInfo ? 270 : 0
  const height = Math.max(960, top + photoHeight + cards.reduce((sum, lines) => sum + 22 + lines.length * 43, 0) + 104)
  await new Promise(resolve => page.setData({ guideHeight: height }, resolve))
  ctx.setFillStyle(style.background)
  ctx.fillRect(0, 0, WIDTH, height)
  ctx.setFillStyle(style.accent)
  ctx.fillRect(54, 60, 44, 6)
  ctx.setFontSize(24)
  ctx.fillText(style.name, 54, 113)
  ctx.setFillStyle(style.ink)
  ctx.setFontSize(56)
  headings.forEach((line, i) => ctx.fillText(line, 54, 172 + i * 66))
  let y = top
  if (photoInfo) {
    const ratio = 612 / 244
    const cropWidth = Math.min(photoInfo.width, photoInfo.height * ratio)
    const cropHeight = cropWidth / ratio
    ctx.drawImage(photoInfo.path, (photoInfo.width - cropWidth) / 2, (photoInfo.height - cropHeight) / 2, cropWidth, cropHeight, 54, y, 612, 244)
    y += photoHeight
  }
  cards.forEach((lines, i) => {
    const cardHeight = 10 + lines.length * 43
    ctx.setFillStyle('#ffffff')
    ctx.fillRect(54, y, 612, cardHeight)
    ctx.setFillStyle(style.accent)
    ctx.setFontSize(23)
    ctx.fillText(style.numbered ? String(i + 1).padStart(2, '0') : '●', 72, y + 36)
    ctx.setFillStyle(style.ink)
    ctx.setFontSize(29)
    lines.forEach((line, index) => ctx.fillText(line, 117, y + 36 + index * 43))
    y += cardHeight + 12
  })
  ctx.setFillStyle(style.accent)
  ctx.setFontSize(22)
  ctx.fillText('向往的自由', 54, height - 48)
  await new Promise(resolve => ctx.draw(false, resolve))
  const result = await new Promise((resolve, reject) => wx.canvasToTempFilePath({
    canvasId: 'guideCard', width: WIDTH, height, destWidth: WIDTH, destHeight: height,
    fileType: 'jpg', quality: 0.9, success: resolve, fail: reject,
  }, page))
  return result.tempFilePath
}

module.exports = { GUIDE_STYLES, renderGuide, suggestTitle }
