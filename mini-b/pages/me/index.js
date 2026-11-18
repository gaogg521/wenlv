const api = require('../../utils/api')
const app = getApp()
Page({
  async chooseStore() {
    try {
      const stores = await api.request('/m/auth/stores')
      if (!stores.length) return wx.showToast({title:'没有有效门店授权',icon:'none'})
      const choice = await new Promise(resolve => wx.showActionSheet({itemList:stores.map(s=>s.name+' · '+['','核销员','店长','老板'][s.role]),success:r=>resolve(r.tapIndex),fail:()=>resolve(null)}))
      if(choice !== null) await api.switchStore(stores[choice].id)
    } catch(e) { wx.showToast({title:e.msg || '切换失败',icon:'none'}) }
  },
  data: { demoAvailable: false, demoBusy: false, loginTip: '', merchant: null, role: 0, roleNames:['未绑定','核销员','店长','老板'], midInput: '', inviteCode: '', inviteInput: '', applyName: '', applyContact: '', applyMobile: '', roleGuide: null, roleGuideOpen: false, roleGuideCurrent: '', roleGuideOthers: [] },
  onShow() {
    this.setData({ demoAvailable: api.canDemoLogin() })
    if (getApp().globalData.token) {
      api.request('/m/site').then((s) => {
        this.setData({ joinTip: s.joinTip || '', miniAAppId: s.miniAAppId || null, roleGuide: s.roleGuide || null })
        this.fillRoleGuide()
      }).catch(() => {})
      // X-05：商户侧订阅模板预取（requestSubscribeMessage 必须在手势栈内同步调用）
      api.request('/m/notify/templates').then((t) => {
        this.notifyIds = [t.newOrder, t.refundApply, t.settlementPending].filter(Boolean).slice(0, 3)
      }).catch(() => { this.notifyIds = [] })
    }
    this.setData({ merchant: app.globalData.merchant || wx.getStorageSync('merchant') || null, role: app.globalData.role })
    if (app.globalData.token) this.fetchApplications()
    if (this.data.merchant && this.data.role >= 2) this.fetchInvite()
    if (this.data.merchant && this.data.role >= 3) this.fetchStaff()
  },
  async fetchApplications() {
    try { const applications = await api.request('/m/applications'); this.setData({ applications: applications.map(a => ({ ...a, statusText: Number(a.status) === 1 ? '审核通过 · 请重新登录进入门店' : Number(a.status) === 2 ? '已驳回' + (a.reject_note ? '：' + a.reject_note : '') : '平台审核中', rejected: Number(a.status) === 2 })) }) } catch (e) {}
  },
  async fetchStaff() {
    try { const staff = await api.request('/m/staff'); this.setData({ staff: staff.map(s => ({ ...s, roleText: ['','核销员','店长','老板'][s.role] })) }) } catch (e) { wx.showToast({ title: e.msg || '员工加载失败', icon: 'none' }) }
  },
  async changeStaff(e) {
    const s = this.data.staff.find(s => s.id === e.currentTarget.dataset.id)
    if (!s || s.role === 3) return
    const choice = await new Promise(resolve => wx.showActionSheet({ itemList: ['设为核销员','设为店长',s.status ? '停用该员工' : '启用该员工'], success:r => resolve(r.tapIndex), fail:() => resolve(null) }))
    if (choice === null) return
    try { await api.request('/m/staff/' + s.id, 'POST', { role: choice < 2 ? choice + 1 : s.role, status: choice === 2 ? (s.status ? 0 : 1) : s.status }); this.fetchStaff() }
    catch (e) { wx.showToast({ title: e.msg || '操作失败', icon: 'none' }) }
  },
  async fetchInvite() {
    try {
      const r = await api.request('/m/invite')
      this.setData({ inviteCode: r.inviteCode })
    } catch (e) {}
  },
  copyInvite() {
    if (!this.data.inviteCode) return
    wx.setClipboardData({ data: this.data.inviteCode })
  },
  onInvite(e) { this.setData({ inviteInput: e.detail.value }) },
  async joinByInvite() {
    const code = String(this.data.inviteInput || '').trim()
    if (!code) return wx.showToast({ title: '输入老板给你的邀请码', icon: 'none' })
    try {
      if (!app.globalData.token) await api.login()
      const r = await api.request('/m/auth/join', 'POST', { inviteCode: code })
      // join 成功后用门店 ID 正常登录拿完整会话；门店名与角色以登录回包为准
      //（此前 role 硬编码 1、门店名取自死变量 null，店长/老板被邀请会显示错误岗位）
      const sess = await api.login(r.merchantId)
      const merchant = (sess && sess.merchant) || wx.getStorageSync('merchant') || app.globalData.merchant
      this.setData({ merchant, role: (sess && sess.role) || 0 })
      wx.showToast({ title: '已加入 ' + ((merchant && merchant.name) || '门店') })
      this.fetchInvite()
    } catch (e) { wx.showToast({ title: e.msg || '加入失败', icon: 'none' }) }
  },
  onApplyName(e) { this.setData({ applyName: e.detail.value }) },
  onApplyContact(e) { this.setData({ applyContact: e.detail.value }) },
  onApplyMobile(e) { this.setData({ applyMobile: e.detail.value }) },
  async applyMerchant() {
    const { applyName, applyContact, applyMobile } = this.data
    if (!applyName || !applyContact || !applyMobile) return wx.showToast({ title: '门店名/联系人/电话必填', icon: 'none' })
    try {
      if (!app.globalData.token) await api.login()
      const r = await api.request('/m/apply', 'POST', { name: applyName, contact: applyContact, mobile: applyMobile })
      wx.showModal({ title: '申请已提交', content: '编号 ' + r.merchantNo + '，平台审核通过后凭邀请码加入门店', showCancel: false })
      this.setData({ applyName: '', applyContact: '', applyMobile: '' }); this.fetchApplications()
    } catch (e) { wx.showToast({ title: e.msg || '提交失败', icon: 'none' }) }
  },
  async enterDemo() {
    if (this.data.demoBusy) return
    this.setData({ demoBusy: true })
    try {
      const d = await api.demoLogin()
      this.setData({ merchant: d.merchant, role: d.role, loginTip: '' })
      wx.switchTab({ url: '/pages/index/index' })
    } catch (e) { wx.showToast({ title: e.msg || '演示登录失败，请重试', icon: 'none' }) }
    finally { this.setData({ demoBusy: false }) }
  },
  onMid(e) { this.setData({ midInput: e.detail.value }) },
  doLogin() {
    api.login().then((d) => {
      this.setData({ merchant: d.merchant || null, role: d.role || 0 })
      this.setData({ loginTip: d.unbound ? '这个微信还没有绑定门店：请在下方填写邀请码加入；没有邀请码可提交入驻申请。' : '' })
      wx.showToast({ title: d.unbound ? '请凭邀请码加入门店' : '登录成功', icon: 'none' }); this.fetchApplications(); if (d.role >= 2) this.fetchInvite(); if (d.role >= 3) this.fetchStaff()
    }).catch((e) => wx.showToast({ title: e.msg || '登录失败', icon: 'none' }))
  },
  logout() { wx.removeStorageSync('mloginMode'); wx.removeStorageSync('mtoken'); wx.removeStorageSync('mrole'); app.globalData.role = 0; wx.removeStorageSync('merchant'); app.globalData.token = ''; app.globalData.merchant = null; this.setData({ loginTip: '', merchant: null, role: 0, qr:'', staff: [], inviteCode: '', applications: [] });const bar=this.getTabBar && this.getTabBar();if(bar && bar.sync)bar.sync() },
  goHonor() { wx.navigateTo({ url: '/pages/honor/index' }) },
  goCredentials() { wx.navigateTo({ url: '/pages/honor/index?tab=proof' }) },
  goSettle() { wx.navigateTo({ url: '/pages/settlement/index' }) },
  goReviews() { wx.navigateTo({ url: '/pages/reviews/index' }) },
  // R-05：岗位说明卡（当前岗位高亮 + 其他岗位摘要；文案由 /m/site.roleGuide 下发）
  fillRoleGuide() {
    const guide = this.data.roleGuide
    if (!guide) return
    const role = Number(this.data.role) || 0
    const NAMES = { 1: '核销员', 2: '店长', 3: '老板' }
    this.setData({
      roleGuideCurrent: guide[role] ? '【' + (NAMES[role] || '员工') + '】' + guide[role] : '',
      roleGuideOthers: [1, 2, 3].filter((r) => r !== role && guide[r]).map((r) => ({ role: r, text: (NAMES[r] || '') + '：' + guide[r] })),
      roleGuideOpen: this.data.roleGuideOpen,
    })
  },
  toggleRoleGuide() { this.setData({ roleGuideOpen: !this.data.roleGuideOpen }) },
  // X-05：到单提醒订阅（模板在 onShow 预取，手势内同步调用 requestSubscribeMessage；未配置跳过）
  askNotify() {
    const ids = this.notifyIds || []
    if (!ids.length) return wx.showToast({ title: '到单提醒尚未开通', icon: 'none' })
    wx.requestSubscribeMessage({ tmplIds: ids, complete: (r) => {
      const ok = ids.some((id) => r[id] === 'accept')
      wx.showToast({ title: ok ? '已订阅到单提醒' : '未订阅', icon: ok ? 'success' : 'none' })
    } })
  },
  // R-04：回到游客端（WX_A_APPID 未配置时入口不渲染；跳转能力依赖正式 AppID，记交验单外部条件）
  openTouristApp() {
    const appId = this.data.miniAAppId
    if (!appId) return
    wx.navigateToMiniProgram({ appId, path: 'pages/home/index', fail: () => wx.showToast({ title: '打开游客端失败，请确认已安装', icon: 'none' }) })
  },
  // 门店码：官方 getUnlimitedQRCode，游客扫码带商户归因进入首页
  async storeQrcode() {
    try {
      const r = await api.request('/m/qrcode')
      if (r.image) {
        const path = `${wx.env.USER_DATA_PATH}/store-qr.png`
        wx.getFileSystemManager().writeFile({ filePath: path, data: r.image, encoding: 'base64',
          success: () => wx.previewImage({ urls: [path] }),
          fail: () => this.setData({ qr: 'data:image/png;base64,' + r.image }) })
      } else {
        // B-04：对商户只说业务话术；技术细节（scene/集成中心配置）留在后台日志
        wx.showModal({ title: '门店码', content: '门店码暂未开通，请联系平台开通后使用。', showCancel: false })
      }
    } catch (e) { wx.showToast({ title: e.msg || '生成失败', icon: 'none' }) }
  },
})
