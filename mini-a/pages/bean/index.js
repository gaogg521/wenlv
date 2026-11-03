const api = require('../../utils/api')
const siteData = require('../../utils/site')
Page({
  data: { bean: null, ledger: [], level: 1, levels: [], levelPct: 0, levelHint: '', levelName: '', levelArt: '', glyph: { 1: '返', 2: '任', 3: '文', 4: '抵', 5: '退', 6: '期', 7: '调' }, bizName: { 1: '消费返豆', 2: '任务奖励', 3: '内容奖励', 4: '下单抵扣', 5: '退款冲正', 6: '滚动过期', 7: '风控调整' } },
  retry() { this.onShow() },
  onShow() {
    this.setData({ error: '' })
    siteData.get().then((s) => this.setData({ beanIntro: s.bean_intro || '' }))
    api.getBean().then(bean => this.setData({ bean }))
      .catch(() => { this.setData({ bean: api.FALLBACK.bean }); wx.showToast({ title: '演示模式（后端未连接）', icon: 'none' }) })
    // 等级、门槛、加成与权益都来自服务端（参数中心「会员等级体系」）；后端不可达时用演示会员
    api.getMe().then((m) => this.fillMember(m)).catch(() => this.fillMember(api.FALLBACK.member))
    api.request('/c/bean/ledger').then((ledger) => this.setData({ ledger: (ledger || []).slice(0, 20) }))
      .catch(() => this.setData({ ledger: api.FALLBACK.ledger }))
  },
  fillMember(m) {
    const lv = (m && m.level) || {}
    this.setData({
      level: (m && m.memberLevel) || 1, levelPct: lv.pct || 0, levelName: lv.name || '', levelArt: lv.art || '',
      levelHint: lv.next ? '成长值 ' + Number(lv.points).toLocaleString() + '，再积累 ' + Number(lv.next.gapPoints).toLocaleString() + ' 升级「' + lv.next.name + '」' : '成长值 ' + Number(lv.points || 0).toLocaleString() + '，已是最高等级',
      levels: (lv.levels || []).map((l) => ({ ...l, need: l.points ? '成长值 ' + Number(l.points).toLocaleString() : '注册即享', perkText: (l.perks || []).join(' · ') })),
    })
  }
})
