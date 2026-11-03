const api = require('../../../utils/api')

const PASS_STATUS = { 1: '待使用', 2: '已核销' }
// 兜底词表：接口不可用时用这套，保证页面只出现「可信记录 / 校验码」口径的用语
const LEX_FALLBACK = {
  did: '文旅数字身份', pass: '权益凭证', badge: '勋章', attest_list: '可信记录流水',
  note: '记录仅用于权益与贡献核算', ledger_sealed: '今日账本已封存',
}

Page({
  data: { d: null, lex: LEX_FALLBACK, loadTxt: '加载中…' },
  onShow() { this.fetch() },
  async fetch() {
    try {
      await api.ensureLogin()
      // 术语从后端字典取（一处定义、多端分发），页面里不硬写专业术语
      const lex = await api.request('/c/lexicon').catch(() => LEX_FALLBACK)
      const d = await api.request('/c/identity')
      // 等级名由服务端给出（d.profile.levelName，参数中心「会员等级体系」）；凭证状态在 JS 里算好：
      // WXML 绑定表达式里写「数组字面量 + 下标表达式」会让分包编译失败
      if (d && Array.isArray(d.passes)) {
        d.passes = d.passes.map((p) => Object.assign({}, p, {
          statusText: PASS_STATUS[p.status] || '已作废',
        }))
      }
      const ownedCount = (d.badges || []).filter((b) => b.owned).length
      // 勋章墙按类别分组（分组顺序与名称由服务端给出）；组内同系列相邻、按阶数从低到高
      const groups = (d.groups || []).map((g) => {
        const items = (d.badges || []).filter((b) => b.category === g.key).sort((x, y) => String(x.series).localeCompare(String(y.series)) || (x.tier - y.tier) || (x.order - y.order))
        return { key: g.key, label: g.label, items, got: items.filter((b) => b.owned).length }
      }).filter((g) => g.items.length)
      this.setData({ d, ownedCount, groups, lex: Object.assign({}, LEX_FALLBACK, lex || {}), loadTxt: '' })
    } catch (e) {
      // 后端不可达：用演示身份渲染（真机演示/断网兜底），不再只显示错误文案
      this.setData({ d: api.FALLBACK.identity, groups: [], ownedCount: 0, lex: LEX_FALLBACK, loadTxt: '' })
      wx.showToast({ title: '演示模式（后端未连接）', icon: 'none' })
    }
  },
  showBadge(e) {
    const b = this.data.d.badges.find((x) => Number(x.id) === Number(e.currentTarget.dataset.id))
    if (!b) return
    const plain = String(b.description || '').replace(/<[^>]+>/g, '').trim()
    const lines = [plain, b.ruleDesc ? '获得方式：' + b.ruleDesc : '', !b.owned && b.progress ? '当前进度 ' + b.progress.cur + '/' + b.progress.need : '', b.proof ? '封存编号 ' + b.proof.code + (b.proof.sealed ? '（已封存）' : '（封存中）') : '', b.owned ? '获得于 ' + String(b.granted_at).slice(0, 10) + (b.expireAt ? '，有效至 ' + b.expireAt : '') : '尚未获得']
    wx.showModal({ title: b.name + ' · ' + b.rarityLabel, content: lines.filter(Boolean).join('\n'), showCancel: false, confirmText: '知道了' })
  },
})
