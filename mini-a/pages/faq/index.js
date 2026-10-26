const api = require('../../utils/api')
Page({
  data: { list: [], open: 0 },
  onShow() { this.fetch() },
  async fetch() {
    try {
      const list = await api.request('/c/faqs')
      this.setData({ list, open: list.length ? 1 : 0 })
    } catch (e) {}
  },
  toggle(e) {
    const i = Number(e.currentTarget.dataset.i)
    this.setData({ open: this.data.open === i ? 0 : i })
  },
})
