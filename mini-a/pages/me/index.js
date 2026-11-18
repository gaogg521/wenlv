const app = getApp()
const api = require('../../utils/api')
const siteData = require('../../utils/site')
const place = require('../../utils/place')
Page({
  goWork() { wx.navigateTo({ url: '/package-promo/pages/work/index' }) },
  goPromo() { wx.navigateTo({ url: '/package-promo/pages/center/index' }) },
  goCreate() { wx.navigateTo({ url: '/package-content/pages/create/index' }) },
  goIdentity() { wx.navigateTo({ url: '/package-content/pages/identity/index' }) },
  // KYC 实名入口已下线（A-06：实名结果暂无业务使用；存量数据已 AES-256-GCM 加密保留，恢复需负责人明确用途）
  goFaq() { wx.navigateTo({ url: '/pages/faq/index' }) },
  goOrders() { wx.navigateTo({ url: '/package-order/pages/orders/index' }) },
  // A-02：资产与快捷入口
  // A-03：旅豆页已从一级位并入「我的」资产摘要，改为普通页面跳转
  goBean() { wx.navigateTo({ url: '/pages/bean/index' }) },
  goFreedom() { wx.navigateTo({ url: '/package-promo/pages/freedom/index' }) },
  goOrdersFilter(e) {
    wx.setStorageSync('orderFilter', e.currentTarget.dataset.bucket)
    wx.navigateTo({ url: '/package-order/pages/orders/index' })
  },
  // R-04：门店员工 → 商户端工作台（WX_B_APPID 未配置时入口不渲染；跳转属外部条件）
  goMerchantWorkbench() {
    const { miniBAppId, merchantStaff } = this.data
    if (!miniBAppId || !merchantStaff) return
    wx.navigateToMiniProgram({
      appId: miniBAppId, path: 'pages/index/index',
      success: () => wx.setStorageSync('merchantGuideShown', '1'),
      fail: () => wx.showToast({ title: '打开商户端失败，请确认已安装', icon: 'none' }),
    })
  },
  data: { site: siteData.DEFAULT, user: null, avatarUrl: '', ordersSummary: null, freedomCount: null, beanBalance: 0, passCount: 0, merchantStaff: null, miniBAppId: null, staffRoleText: '',
    consentOpen: false, consents: [], consentVersions: {}, consentSavedAt: '' },
  goDoc(e) { wx.navigateTo({ url: '/package-content/pages/doc/index?type=' + e.currentTarget.dataset.type }) },
  callService() { place.call(this.data.site.service_phone) },
  onShow() {
    this.setData({workAvailable:false,canPromote:false})
    api.request('/c/work-contexts').then(d=>this.setData({workAvailable:d.canCooperate,canPromote:d.canPromote})).catch(()=>{})
    siteData.get().then((site) => this.setData({ site, serviceLine: site.service_hours ? ' · ' + site.service_hours : '' }))
    this.setData({ user: app.globalData.user })
    this.loadMe()
    // A-02：登录后拉取资产摘要与订单快捷计数（未登录不发请求、不报错）
    if (app.globalData.token) {
      api.request('/c/orders/summary').then((s) => this.setData({ ordersSummary: s })).catch(() => {})
      api.request('/c/freedom?status=available&page=1&pageSize=1').then((d) => this.setData({ freedomCount: Number(d.total) || 0 })).catch(() => {})
    } else this.setData({ ordersSummary: null, freedomCount: null })
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
    const ROLE_CN = { 1: '核销员', 2: '店长', 3: '老板' }
    this.setData({
      avatarUrl: (m && m.avatarUrl) ? api.img(m.avatarUrl) : '', initial: String((m && m.nickname) || '旅').trim().slice(0, 1) || '旅', user: { nickname: (m && m.nickname) || '旅友', levelName: lv.name || '探索者', levelArt: lv.art || '', levelPct: lv.pct || 0, levelHint: hint },
      beanBalance: Number((m && m.bean) || 0), passCount: Number((m && m.passes) || 0),
      merchantStaff: (m && m.merchantStaff) || null, miniBAppId: (m && m.miniBAppId) || null,
      staffRoleText: (m && m.merchantStaff) ? (ROLE_CN[m.merchantStaff.role] || '员工') : '',
    })
    // R-04：有门店绑定但没进过商户端 → 一次性引导（进过或点过即不再提示）
    if (m && m.merchantStaff && !wx.getStorageSync('merchantGuideShown')) {
      wx.setStorageSync('merchantGuideShown', '1')
      wx.showModal({ title: '你是门店员工', content: '「我的身份与工作」里可以进入商户工作台（核销、接单）。', showCancel: false, confirmText: '知道了' })
    }
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
