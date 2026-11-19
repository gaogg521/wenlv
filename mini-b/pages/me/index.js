const api = require('../../utils/api')
const { confirmAsk, confirmChange } = require('../../utils/confirm')
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
  data: { demoAvailable: false, demoBusy: false, loginTip: '', merchant: null, role: 0, roleNames:['未绑定','核销员','店长','老板'], midInput: '', inviteCode: '', inviteInput: '', applyName: '', applyContact: '', applyMobile: '', roleGuide: null, roleGuideOpen: false, roleGuideCurrent: '', roleGuideOthers: [], prefs: null, notifyOpen: false, notifyState: null },
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
        this.refreshNotifyState()
      }).catch(() => { this.notifyIds = []; this.refreshNotifyState() })
      // M-02：提醒偏好（老板/店长默认开，核销员默认关；可在此自行开关）
      this.fetchPrefs()
    }
    this.setData({ merchant: app.globalData.merchant || wx.getStorageSync('merchant') || null, role: app.globalData.role })
    if (app.globalData.token) this.fetchApplications()
    if (this.data.merchant && this.data.role >= 2) this.fetchInvite()
    if (this.data.merchant && this.data.role >= 3) this.fetchStaff()
    // M-02：工作台引导「去设置」跳转过来时自动展开提醒面板
    if (wx.getStorageSync('notifyPanelOpen')) { wx.removeStorageSync('notifyPanelOpen'); this.setData({ notifyOpen: true }) }
  },
  // M-05：下拉刷新（开关在 index.json）
  onPullDownRefresh() {
    const jobs = [api.request('/m/site').then((s) => { this.setData({ joinTip: s.joinTip || '', miniAAppId: s.miniAAppId || null, roleGuide: s.roleGuide || null }); this.fillRoleGuide() }).catch(() => {}),
      this.fetchPrefs()]
    if (getApp().globalData.token) jobs.push(this.fetchApplications())
    if (this.data.merchant && this.data.role >= 2) jobs.push(this.fetchInvite())
    if (this.data.merchant && this.data.role >= 3) jobs.push(this.fetchStaff())
    Promise.all(jobs).catch(() => {}).then(() => wx.stopPullDownRefresh())
  },
  async fetchApplications() {
    try { const applications = await api.request('/m/applications'); this.setData({ applications: applications.map(a => ({ ...a, statusText: Number(a.status) === 1 ? '审核通过 · 请重新登录进入门店' : Number(a.status) === 2 ? '已驳回' + (a.reject_note ? '：' + a.reject_note : '') : '平台审核中', rejected: Number(a.status) === 2 })) }) } catch (e) {}
  },
  async fetchStaff() {
    try { const staff = await api.request('/m/staff'); this.setData({ staff: staff.map(s => ({ ...s, roleText: ['','核销员','店长','老板'][s.role] })) }) } catch (e) { wx.showToast({ title: e.msg || '员工加载失败', icon: 'none' }) }
  },
  // M-06：改岗带确认与新岗位提示；停用（A+）必须填原因。确认/提交拆在 staffApply，供走查直调。
  async changeStaff(e) {
    const s = this.data.staff.find(s => s.id === e.currentTarget.dataset.id)
    if (!s || s.role === 3) return
    const choice = await new Promise(resolve => wx.showActionSheet({ itemList: ['设为核销员','设为店长',s.status ? '停用该员工' : '启用该员工'], success:r => resolve(r.tapIndex), fail:() => resolve(null) }))
    if (choice === null) return
    this.staffApply(s, choice)
  },
  async staffApply(s, choice) {
    try {
      if (choice < 2) {
        const to = ['', '核销员', '店长'][choice + 1]
        const c = await confirmChange({ title: '确认改岗', target: '员工「' + (s.nickname || '未命名') + '」',
          changes: [{ label: '岗位', from: s.roleText, to }], impact: '改岗立即生效，新岗位权限马上替代旧岗位（对方无需退出重登）', confirmText: '确认改岗' })
        if (!c.ok) return
        await api.request('/m/staff/' + s.id, 'POST', { role: choice + 1, status: s.status, reason: c.reason })
        wx.showToast({ title: '已改为' + to, icon: 'success' })
      } else if (s.status) {
        const c = await confirmChange({ title: '确认停用员工', target: '员工「' + (s.nickname || '未命名') + '」',
          impact: '停用后该员工立即无法登录商户端，已登录的会话马上失效；可随时再启用', needReason: true, confirmText: '确认停用', danger: true })
        if (!c.ok) return
        await api.request('/m/staff/' + s.id, 'POST', { role: s.role, status: 0, reason: c.reason })
        wx.showToast({ title: '已停用（' + (s.nickname || '员工') + '）', icon: 'none' })
      } else {
        const ok = await confirmAsk({ title: '确认启用员工', content: '「' + (s.nickname || '未命名') + '」恢复后可重新登录商户端并按当前岗位工作', confirmText: '确认启用' })
        if (!ok) return
        await api.request('/m/staff/' + s.id, 'POST', { role: s.role, status: 1 })
        wx.showToast({ title: '已启用', icon: 'success' })
      }
      this.fetchStaff()
    }
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
  // ===== M-02/M-08/M-09：到单提醒（开关 + 三态 + 订阅被拒分流） =====
  // 状态计算：prefs 全开 + 微信订阅正常 = 已开启；额度不足 = 补订阅；总开关关 = 去设置；模板未接入 = 未接入。
  async fetchPrefs() {
    try {
      const p = await api.request('/m/notify/prefs')
      this.setData({ prefs: p })
      this.refreshNotifyState()
    } catch (e) { /* 未绑定门店时无偏好 */ }
  },
  toggleNotifyPanel() { this.setData({ notifyOpen: !this.data.notifyOpen }); if (this.data.notifyOpen) this.refreshNotifyState() },
  // wx.getSetting withSubscriptions 判断微信侧状态（M-02-2 三态）
  refreshNotifyState() {
    const ids = this.notifyIds || []
    const p = this.data.prefs || {}
    const anyOff = [p.newOrder, p.refundApply, p.settlementPending].some((v) => v === false)
    if (!ids.length) return this.setData({ notifyState: { key: 'unlinked', label: '提醒通道未接入（联系平台配置模板）' } })
    wx.getSetting({ withSubscriptions: true, success: (r) => {
      const ss = r.subscriptionsSetting || {}
      if (ss.mainSwitch === false) return this.setData({ notifyState: { key: 'off', label: '微信通知总开关已关，去设置' } })
      const accepted = ids.filter((id) => ss.itemSettings && ss.itemSettings[id] === 'accept').length
      if (accepted < ids.length) return this.setData({ notifyState: { key: 'partial', label: '授权额度不足，点此补订阅' } })
      this.setData({ notifyState: { key: 'on', label: '已开启（微信订阅正常）' } })
    }, fail: () => this.setData({ notifyState: { key: anyOff ? 'off-prefs' : 'on', label: anyOff ? '提醒项已关闭' : '偏好已开启（订阅状态未知）' } }) })
  },
  // 偏好开关：即偏好即状态（开关就是 GET/POST /m/notify/prefs 的偏好）
  async onPrefChange(e) {
    const k = e.currentTarget.dataset.k
    const on = !!e.detail.value
    try {
      await api.request('/m/notify/prefs', 'POST', { [k]: on })
      this.setData({ ['prefs.' + k]: on })
      wx.showToast({ title: on ? '已开启，可到单提醒' : '已关闭', icon: 'none' })
      this.refreshNotifyState()
    } catch (err) { wx.showToast({ title: err.msg || '保存失败', icon: 'none' }); this.fetchPrefs() }
  },
  // M-08：订阅被拒按原因分流——用户拒绝（稍后再说）/ 总开关关（去设置）/ 模板未配置（联系平台）
  askNotify() {
    const ids = this.notifyIds || []
    if (!ids.length) return wx.showModal({ title: '到单提醒', content: '平台尚未接入订阅消息模板，请联系平台开通。目前工作台内的到单提示不受影响。', showCancel: false })
    wx.requestSubscribeMessage({ tmplIds: ids, success: (r) => {
      const banned = ids.every((id) => r[id] === 'ban')
      const accepted = ids.filter((id) => r[id] === 'accept').length
      if (banned) return wx.showModal({ title: '微信通知总开关已关', content: '请在设置里打开「通知 · 订阅消息」总开关后再来补订阅。', confirmText: '去设置', cancelText: '稍后', success: (m) => { if (m.confirm) wx.openSetting({ withSubscriptions: true }) } })
      if (accepted) { wx.showToast({ title: '已开启到单提醒', icon: 'success' }); return this.refreshNotifyState() }
      const rejected = ids.some((id) => r[id] === 'reject')
      wx.showModal({ title: rejected ? '这次没有开启' : '订阅未完成', content: rejected ? '你选择了拒绝。不影响使用：工作台内的到单提示常开，之后可随时来这里补订阅。' : '没有获得订阅授权，之后可随时来这里补订阅。', showCancel: false })
      this.refreshNotifyState()
    }, fail: () => wx.showToast({ title: '订阅未完成，可稍后再试', icon: 'none' }) })
  },
  goNotifySetting() { wx.openSetting({ withSubscriptions: true, fail: () => wx.showToast({ title: '请到微信设置里打开订阅消息', icon: 'none' }) }) },
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
