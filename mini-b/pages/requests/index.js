// 我的变更申请(V94):商户端提交的资源变更(改价/名额/停售/恢复/早鸟)审批进度。
// 跨端可查:PC 端提交的等价变更在 PC 主体工作台可见,本页展示本人从小程序提交的申请;撤回仅限提交人本人。
const api = require('../../utils/api')

const STATUS_CN = { 0: '草稿', 1: '待审核', 2: '已撤回', 3: '已退回', 4: '已生效' }
const KIND_CN = { session: '团期', product: '商品', stock: '直购库存', merchant: '商户资料', scenic: '景区资料' }

Page({
  data: { list: [], loaded: false, tab: 'all', error: '', canCreateProduct: false },
  onShow() {
    const app = getApp()
    this.setData({ role: app.globalData.role || 0 })
    // 退回项4:按最新权限快照决定「新增商品」入口(撤权后入口关闭)
    api.refreshPerms(true).then(() => {
      const perms = api.permsFor()
      this.setData({ canCreateProduct: !!(perms.product && perms.product.create && perms.product.create.allowed) })
    })
    this.fetch()
  },
  onPullDownRefresh() { this.fetch(() => wx.stopPullDownRefresh()) },
  fetch(done) {
    if (typeof done !== 'function') done = undefined
    if (!getApp().globalData.token) { this.setData({ loaded: true, list: [], error: '' }); done && done(); return }
    const qs = this.data.tab === 'all' ? '' : '&status=' + this.data.tab
    api.request('/m/subject-requests?page=1&pageSize=50' + qs).then((d) => {
      const items = (d.items || []).map((r) => Object.assign({}, r, {
        kindText: KIND_CN[r.kind] || r.kind,
        statusText: STATUS_CN[r.status] || r.status,
        changeText: (r.changedLabels || []).join('、') || (r.action === 'create' ? '新增' : '—'),
        timeText: String(r.submitted_at || r.created_at || '').slice(0, 16),
        resultText: Number(r.status) === 3 && r.review_note ? '退回原因:' + r.review_note : (Number(r.status) === 4 ? '已生效' : ''),
        canEditDraft: Number(r.status) === 0 && r.kind === 'product',
        canWithdraw: Number(r.status) === 1,
        canRedo: Number(r.status) === 2 || Number(r.status) === 3,
      }))
      this.setData({ list: items, loaded: true, error: '' })
      done && done()
    }).catch((e) => { this.setData({ loaded: true, list: [], error: e.msg || '申请加载失败' }); done && done() })
  },
  editDraft(e) { wx.navigateTo({ url: '/pages/product-edit/index?draftId=' + Number(e.currentTarget.dataset.id) }) },
  goCreate() { wx.navigateTo({ url: '/pages/product-edit/index' }) },
  setTab(e) {
    const k = String(e.currentTarget.dataset.k || 'all')
    this.setData({ tab: k })
    this.fetch()
  },
  withdraw(e) {
    const id = Number(e.currentTarget.dataset.id)
    wx.showModal({ title: '撤回申请', content: '撤回后待审任务移除(原通知保留历史);可重新核对后再次提交。确认撤回?', confirmText: '撤回', confirmColor: '#c2410c',
      success: (r) => { if (!r.confirm) return
        api.request('/m/subject-requests/' + id + '/withdraw', 'POST', {}).then(() => {
          wx.showToast({ title: '已撤回', icon: 'success' }); this.fetch()
        }).catch((err) => wx.showToast({ title: err.msg || '撤回失败', icon: 'none' }))
      } })
  },
  redo(e) {
    const id = Number(e.currentTarget.dataset.id)
    wx.showToast({ title: '请在库存页重新发起同样的调整(旧申请历史保留)', icon: 'none', duration: 3000 })
    wx.navigateTo({ url: '/pages/supply/index' })
  },
})
