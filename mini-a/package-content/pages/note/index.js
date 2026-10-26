// 笔记详情独立页（P2）：数据全在 JS 预计算，wxml 只做取值（分包 WXML 铁律）
const api = require('../../../utils/api')
Page({
  data: { n: null, loadTxt: '加载中…' },
  onLoad(q) { this.id = q.id; this.fetch() },
  async fetch() {
    try {
      const n = await api.request('/c/notes/' + this.id)
      this.setData({ n: { ...n, when: String(n.published_at || '').replace('T', ' ').slice(0, 16), html: n.text || n.body || '' } })
    } catch (e) { this.setData({ loadTxt: e.msg || '笔记不存在或未发布' }) }
  },
})
