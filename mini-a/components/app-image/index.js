// T-04：统一图片加载失败占位——src 加载失败时显示主题化占位图，src 变化后自动重置重试
Component({
  options: { addGlobalClass: true },
  properties: {
    src: String,
    mode: { type: String, value: 'aspectFill' },
    lazy: Boolean,
  },
  data: { failed: false },
  observers: {
    src() { this.setData({ failed: false }) },
  },
  methods: {
    onError() { this.setData({ failed: true }) },
  },
})
