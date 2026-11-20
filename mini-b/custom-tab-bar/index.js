// A-33：按角色渲染 tab——核销员（role<2）只保留 工作台/我的，不出现"订单""库存"
// （原生 tabBar 无法按角色隐藏；此前核销员点这两个常驻标签只会看到"需要店长及以上权限"）
Component({
  data: {
    role: 0,
    selected: 0,
    dots: {},
    // B-03：与游客端同质量的图标资源（gen-tab-icons.mjs 生成，暖色主色 #ad603d）；核销员只显示工作台/我的（A-33 逻辑保留）
    list: [
      { path: '/pages/index/index', text: '工作台', img: '/assets/tab/index.png', imgOn: '/assets/tab/index-on.png' },
      { path: '/pages/orders/index', text: '订单', img: '/assets/tab/orders.png', imgOn: '/assets/tab/orders-on.png' },
      { path: '/pages/supply/index', text: '库存', img: '/assets/tab/supply.png', imgOn: '/assets/tab/supply-on.png' },
      { path: '/pages/me/index', text: '我的', img: '/assets/tab/me.png', imgOn: '/assets/tab/me-on.png' },
    ],
  },
  lifetimes: { attached() { this.sync() } },
  pageLifetimes: { show() { this.sync() } },
  methods: {
    sync() {
      const pages = getCurrentPages(), current = pages[pages.length - 1]
      const path = current ? '/' + current.route : ''
      const selected = this.data.list.findIndex(item => item.path === path)
      // M-02：停在某个 tab 时清掉它的红点（用户已看到该列表）
      const dots = Object.assign({}, this.data.dots)
      if (selected >= 0 && dots[selected]) { delete dots[selected]; this.setData({ dots }) }
      this.setData({ role: Number(getApp().globalData.role) || 0, selected: selected < 0 ? 0 : selected })
    },
    // M-02：setDot(2, true) = 订单 tab 点红点；由工作台轮询通过 this.getTabBar().setDot(...) 调用
    setDot(index, on) {
      const dots = Object.assign({}, this.data.dots)
      if (on) dots[index] = true; else delete dots[index]
      this.setData({ dots })
    },
    tap(e) {
      const { path, index } = e.currentTarget.dataset
      wx.switchTab({ url: path })
      this.setData({ selected: Number(index) })
    },
  },
})
