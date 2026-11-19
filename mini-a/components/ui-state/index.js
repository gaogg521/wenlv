// 统一「加载 / 空 / 无资格 / 失败」四态组件（项1+项6）。
// 约定：权限类（denied）不给「重试」——它回答「这是什么 / 为什么不能用 / 怎么开通」；
//       error 才有重试；empty 给一个有实际作用的去处；示例预览一律标「示例示意 · 非真实数据」。
// 样式走 app.wxss 设计令牌（styleIsolation: apply-shared），不新增色板。
Component({
  options: { styleIsolation: 'apply-shared' },
  properties: {
    kind: { type: String, value: 'empty' },          // loading | empty | denied | error
    icon: { type: String, value: '' },               // 覆盖默认图标（emoji）
    title: { type: String, value: '' },              // 覆盖默认标题
    desc: { type: String, value: '' },               // 说明，\n 分行
    reasons: { type: Array, value: [] },             // denied 三问：[{ q, a }]
    previewTitle: { type: String, value: '' },       // 权益预览标题
    previewRows: { type: Array, value: [] },         // 预览行：[[label, value], ...]
    actionText: { type: String, value: '' },         // 主按钮
    actionUrl: { type: String, value: '' },          // 主按钮跳转（tab 页自动 switchTab）
    actionOpen: { type: String, value: '' },         // 'contact' = 客服会话
    secondaryText: { type: String, value: '' },      // 次按钮
    secondaryUrl: { type: String, value: '' },
    secondaryOpen: { type: String, value: '' },
    noRetry: { type: Boolean, value: false },        // error 态隐藏重试（极少用）
    compact: { type: Boolean, value: false },        // 内嵌小卡（tab 区内）
  },
  data: { defaultIcon: '', defaultTitle: '', descLines: [] },
  observers: {
    'kind, icon, title, desc'(kind, icon, title, desc) {
      const fallback = {
        empty: { icon: '🧭', title: '暂无内容' },
        denied: { icon: '🔒', title: '暂未开通' },
        error: { icon: '⚠️', title: '加载失败' },
        loading: { icon: '', title: '' },
      }[kind] || { icon: '', title: '' }
      this.setData({
        defaultIcon: fallback.icon,
        defaultTitle: fallback.title,
        descLines: desc ? String(desc).split('\n') : [],
      })
    },
  },
  methods: {
    go(e) {
      const url = e.currentTarget.dataset.url
      if (!url) return
      if (url.startsWith('/pages/') && ['home', 'tour-list', 'shop', 'notes', 'me'].some((t) => url.indexOf('/pages/' + t + '/') === 0)) {
        wx.switchTab({ url })
      } else {
        wx.navigateTo({ url, fail: () => wx.showToast({ title: '页面暂不可用', icon: 'none' }) })
      }
    },
    onAction() {
      this.triggerEvent('action')
      this.go({ currentTarget: { dataset: { url: this.data.actionUrl } } })
    },
    onSecondary() {
      this.triggerEvent('secondary')
      this.go({ currentTarget: { dataset: { url: this.data.secondaryUrl } } })
    },
    onRetry() { this.triggerEvent('retry') },
  },
})
