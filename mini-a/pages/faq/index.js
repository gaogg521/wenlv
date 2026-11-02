const api = require('../../utils/api')
Page({
  data: { list: [], shown: [], cats: ['全部'], cat: '全部', kw: '', open: 0 },
  onShow() { this.fetch() },
  async fetch() {
    try {
      const list = await api.request('/c/faqs')
      const cats = ['全部', ...new Set(list.map((f) => f.category || '通用'))]
      this.setData({ list, cats }, () => this.filter(true))
    } catch (e) {}
  },
  onKw(e) { this.setData({ kw: e.detail.value }, () => this.filter()) },
  pickCat(e) { this.setData({ cat: e.currentTarget.dataset.c }, () => this.filter()) },
  // 搜索命中问题、答案纯文本，以及后台维护的「同义问法/关键词」
  filter(first) {
    const kw = this.data.kw.trim()
    const shown = this.data.list.filter((f) => (this.data.cat === '全部' || (f.category || '通用') === this.data.cat) &&
      (!kw || f.question.includes(kw) || String(f.answer).replace(/<[^>]+>/g, '').includes(kw) || (f.keywords || []).some((k) => k.includes(kw) || kw.includes(k))))
    this.setData({ shown, open: first && shown.length ? shown[0].id : this.data.open })
  },
  toggle(e) { const id = e.currentTarget.dataset.id; this.setData({ open: this.data.open === id ? 0 : id }) },
})
