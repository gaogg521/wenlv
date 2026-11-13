// 约稿任务详情：后台约稿编辑器的全部游客可见字段
const api = require('../../../utils/api')
Page({
  data: { t: null, error: '' },
  onLoad(q) { this.id = q.id; this.load() },
  load() {
    this.setData({ error: '' })
    api.request('/c/tasks/' + this.id).then((t) => {
      wx.setNavigationBarTitle({ title: t.title || '约稿任务' })
      this.setData({ t: { ...t,
        platformsText: (t.platforms_labels || []).join(' · '),
        deadlineText: t.deadline ? String(t.deadline).slice(0, 16) : '',
        wordsText: t.min_words ? '不少于 ' + t.min_words + ' 字' : (t.min_images ? t.min_images + ' 张图以上' : ''),
        rewardText: t.cash_reward_label ? ' + ¥' + t.cash_reward_label : '',
        slotsText: t.slotsLeft !== null && t.slotsLeft !== undefined ? '（剩 ' + t.slotsLeft + ' 个名额）' : '' } })
    }).catch((e) => this.setData({ error: e.msg || '加载失败' }))
  },
  async claim() {
    try {
      await api.request('/c/tasks/' + this.id + '/claim', 'POST', {})
      wx.showToast({ title: '已领取，去创作吧' })
      setTimeout(() => wx.navigateBack(), 800)
    } catch (e) { wx.showToast({ title: e.msg || '领取失败', icon: 'none' }) }
  },
  openRef(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    wx.setClipboardData({ data: url, success: () => wx.showToast({ title: '链接已复制，可在浏览器打开', icon: 'none' }) })
  },
  goProduct() { if (this.data.t.product) wx.navigateTo({ url: '/package-tour/pages/detail/index?id=' + this.data.t.product.id }) },
})
