Component({
  properties: { title: String, home: Boolean, tab: Boolean },
  data: { top: 24, height: 44, right: 96, backLabel: '返回上一页' },
  lifetimes: {
    attached() {
      let info = {}, capsule = {}
      try { info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync() } catch (e) {}
      try { capsule = wx.getMenuButtonBoundingClientRect() } catch (e) {}
      const top = Number(info.statusBarHeight) || 24
      const valid = capsule.height > 0 && capsule.top >= top
      const height = valid ? capsule.height + (capsule.top - top) * 2 : 44
      const right = valid ? Math.max(96, info.windowWidth - capsule.left + 8) : 96
      this.setData({ top, height, right, backLabel: this.properties.tab ? '返回工作台' : '返回上一页' })
    },
  },
  methods: {
    back() {
      if (this.properties.tab || getCurrentPages().length <= 1) return wx.switchTab({ url: '/pages/index/index' })
      wx.navigateBack({ delta: 1, fail: () => wx.switchTab({ url: '/pages/index/index' }) })
    },
  },
})
