// 小红书化走查种子：演示库造 2 位游客 + 3 篇带话题/封面图笔记 + 点赞 + 评论
// 用法：node scripts/xhs-walk-seed.mjs  （对 8080 演示库直跑，mock 登录全 mock 机审）
import fs from 'node:fs'
import path from 'node:path'
const root = path.resolve(import.meta.dirname, '../..')

const BASE = process.env.API_BASE || 'http://127.0.0.1:8080'
const call = async (m, p, b, t) => (await fetch(BASE + p, { method: m, headers: { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }, body: b ? JSON.stringify(b) : undefined })).json()
const ok = (r) => { if (r.code !== 0) throw new Error(p + ' -> ' + r.msg); return r.data }

const upload = async (token, file) => {
  const data = fs.readFileSync(file).toString('base64')
  const ext = file.endsWith('.png') ? 'png' : 'jpg'
  return ok(await call('POST', '/c/upload/note-image', { data, ext }, token))
}

const STAMP = 'XHSW' + Date.now().toString(36)
const IMGS = [
  path.join(root, 'mini-a/assets/photos/water-town.jpg'),
  path.join(root, 'mini-a/assets/photos/zongzi.jpg'),
  path.join(root, 'brand-logo/mini-a-reference/scenes/lake.png'),
]

const author = ok(await call('POST', '/c/auth/login', { code: 'mock-xhs-walk-author-' + STAMP }))
const reader = ok(await call('POST', '/c/auth/login', { code: 'mock-xhs-walk-reader-' + STAMP }))
console.log('users ok')

const me = ok(await call('GET', '/c/me', null, author.token))
console.log('author uid', me.id)

const notes = []
for (let i = 0; i < 3; i++) {
  const urls = []
  for (const f of IMGS.slice(0, i + 2)) urls.push((await upload(author.token, f)).url)
  const n = ok(await call('POST', '/c/notes', {
    title: ['乌镇的清晨', '南湖的日落', '巷口的粽子香'][i],
    blocks: [{ type: 'text', html: '<p>' + ['早上六点的乌镇几乎没有游客，石板路湿漉漉的，摇橹船刚出坞。','傍晚的南湖把天烧成橘红色，环湖步道走到第三座桥最美。','巷口的粽子铺一天只出一笼，酱肉粽子是招牌。'][i] + '</p>' }],
    images: urls, video: null, topics: [['古镇漫步', '周末遛娃'], ['山水风光'], ['美食探店', '小众路线']][i],
    coverIndex: i % urls.length, relatedProductId: null,
  }, author.token))
  console.log('note', i + 1, '->', n.status, n.msg, urls.length + '图')
  notes.push(n)
}

// 点赞与评论
for (const n of notes) {
  ok(await call('POST', `/c/notes/${n.id}/like`, {}, reader.token))
  ok(await call('POST', `/c/notes/${n.id}/comments`, { content: '拍得真好，请问是手机直出的吗？' }, reader.token))
}
ok(await call('POST', `/c/notes/${notes[0].id}/comments`, { content: '收藏了，下周末就出发！' }, author.token))
console.log('likes + comments ok')
console.log('SEED-NOTE-IDS=' + notes.map(n => n.id).join(','))
