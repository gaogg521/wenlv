const app = getApp()
const api = require('../../utils/api')
const siteData = require('../../utils/site')
const place = require('../../utils/place')
Page({
  goPromo() { wx.navigateTo({ url: '/package-promo/pages/center/index' }) },
  goCreate() { wx.navigateTo({ url: '/package-content/pages/create/index' }) },
  goIdentity() { wx.navigateTo({ url: '/package-content/pages/identity/index' }) },
  // KYC 实名入口已下线（A-06：实名结果暂无业务使用；存量数据已 AES-256-GCM 加密保留，恢复需负责人明确用途）
  goFaq() { wx.navigateTo({ url: '/pages/faq/index' }) },
  goOrders() { wx.navigateTo({ url: '/package-order/pages/orders/index' }) },
  data: { site: siteData.DEFAULT, user: null, avatarUrl: '',
    consentOpen: false, consents: [], consentVersions: {}, consentSavedAt: '' },
  goDoc(e) { wx.navigateTo({ url: '/package-content/pages/doc/index?type=' + e.currentTarget.dataset.type }) },
  callService() { place.call(this.data.site.service_phone) },
  onShow() {
    siteData.get().then((site) => this.setData({ site }))
    this.setData({ user: app.globalData.user })
    this.loadMe()
  },
  // 等级名与升级进度来自服务端（参数中心「会员等级体系」），页面里不写死
  loadMe() {
    return api.getMe().then((m) => this.fillMe(m)).catch((e) => {
      // A-18：假会员信息仅限开发环境且常驻标识；正式版错误态（冻结 1003 的提示也在这里露出）
      if (api.demoAllowed()) { this.fillMe(api.FALLBACK.member); this.setData({ demo: true }) }
      else this.setData({ user: null, demo: false, meError: e.msg || '加载失败，请重新进入' })
    })
  },
  fillMe(m) {
    const lv = (m && m.level) || {}
    const hint = lv.next ? '再积累 ' + Number(lv.next.gapPoints).toLocaleString() + ' 成长值升级「' + lv.next.name + '」' : '已是最高等级'
    this.setData({ avatarUrl: (m && m.avatarUrl) ? api.img(m.avatarUrl) : '', initial: String((m && m.nickname) || '旅').trim().slice(0, 1) || '旅', user: { nickname: (m && m.nickname) || '旅友', levelName: lv.name || '探索者', levelArt: lv.art || '', levelPct: lv.pct || 0, levelHint: hint } })
  },
  async login() {
    try {
      const api = require('../../utils/api')
      const d = await api.login()
      this.setData({ user: { nickname: d.user.nickname, levelName: '', levelPct: 0, levelHint: '' } })
      await this.loadMe()
    } catch (e) { wx.showToast({ title: e.msg || '登录失败（后端未启动时可用演示模式浏览）', icon: 'none' }) }
  },
  // 官方头像填写能力：chooseAvatar 临时文件 → base64 上传 → 服务端存 /uploads
  onChooseAvatar(e) {
    const tp = e.detail && e.detail.avatarUrl
    if (!tp) return
    try {
      const b64 = wx.getFileSystemManager().readFileSync(tp, 'base64')
      const api = require('../../utils/api')
      api.request('/c/upload/avatar', 'POST', { data: b64, ext: 'png' }).then((r) => {
        this.setData({ avatarUrl: r.url })
        api.request('/c/me/profile', 'POST', { avatarUrl: r.url }).catch(() => {})
        wx.showToast({ title: '头像已更新' })
      }).catch(() => wx.showToast({ title: '上传失败', icon: 'none' }))
    } catch (e2) { wx.showToast({ title: '读取头像失败', icon: 'none' }) }
  },
  // 官方昵称填写能力：type=nickname 键盘带微信昵称；服务端过机审
  async onNickname(e) {
    const nickname = (e.detail.value || '').trim()
    if (!nickname) return
    const api = require('../../utils/api')
    try {
      const r = await api.request('/c/me/profile', 'POST', { nickname })
      this.setData({ user: { ...this.data.user, nickname: r.nickname } })
      wx.showToast({ title: '昵称已更新' })
    } catch (err) { wx.showToast({ title: err.msg || '昵称未通过校验', icon: 'none' }) }
  },
  // 隐私授权：逐项可开关，每次操作都落库留档（服务端有对应记录，可逐笔复核）
  async showPrivacy() {
    const open = !this.data.consentOpen
    this.setData({ consentOpen: open })
    if (!open) return
    try {
      const d = await api.request('/c/consent')
      const SCENES = [
        { scene: 'terms', label: '用户协议' },
        { scene: 'privacy', label: '隐私政策' },
        { scene: 'location', label: '位置信息（用于推荐附近行程）' },
        { scene: 'marketing', label: '活动与优惠通知' },
      ]
      const items = (d.items || [])
      this.setData({
        consentVersions: d.versions || {},
        consents: SCENES.map((x) => {
          const hit = items.find((y) => y.scene === x.scene)
          return { ...x, granted: !!(hit && hit.granted),
            version: (d.versions && (d.versions[x.scene] || (x.scene === 'terms' ? d.versions.terms : d.versions.privacy))) || '' }
        }),
      })
    } catch (e) {
      wx.showToast({ title: e.msg || '加载失败，请稍后再试', icon: 'none' })
    }
  },
  async consentToggle(e) {
    const scene = e.currentTarget.dataset.scene
    const granted = !!e.detail.value
    try {
      await api.request('/c/consent', 'POST', { scene, granted })
      const now = new Date()
      const pad = (n) => (n < 10 ? '0' + n : '' + n)
      this.setData({
        consentSavedAt: now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()),
        consents: this.data.consents.map((x) => (x.scene === scene ? { ...x, granted } : x)),
      })
      wx.showToast({ title: granted ? '已同意并留档' : '已关闭', icon: 'none' })
    } catch (err) {
      // 失败就把开关拨回去，不能让界面显示成"已同意"而服务端没记录
      this.setData({ consents: this.data.consents.map((x) => (x.scene === scene ? { ...x, granted: !granted } : x)) })
      wx.showToast({ title: err.msg || '操作失败，请重试', icon: 'none' })
    }
  },
})
