// A-33：按角色渲染 tab——核销员（role<2）只保留 工作台/我的，不出现"订单""库存"
// （原生 tabBar 无法按角色隐藏；此前核销员点这两个常驻标签只会看到"需要店长及以上权限"）
Component({
  data: {
    role: 0,
    selected: 0,
    list: [
      { path: '/pages/index/index', text: '工作台', ico: '▦' },
      { path: '/pages/orders/index', text: '订单', ico: '☰' },
      { path: '/pages/supply/index', text: '库存', ico: '▣' },
      { path: '/pages/me/index', text: '我的', ico: '◉' },
    ],
  },
  lifetimes: { attached() { this.sync() } },
  pageLifetimes: { show() { this.sync() } },
  methods: {
    sync() {
      const pages = getCurrentPages(), current = pages[pages.length - 1]
      const path = current ? '/' + current.route : ''
      const selected = this.data.list.findIndex(item => item.path === path)
      this.setData({ role: Number(getApp().globalData.role) || 0, selected: selected < 0 ? 0 : selected })
    },
    tap(e) {
      const { path, index } = e.currentTarget.dataset
      wx.switchTab({ url: path })
      this.setData({ selected: Number(index) })
    },
  },
})
