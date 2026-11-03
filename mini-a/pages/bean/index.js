const api = require('../../utils/api')
const siteData = require('../../utils/site')
Page({
  data: { bean: null, ledger: [], level: 1, levels: [], levelPct: 0, levelHint: '', bizName: { 1: '消费返豆', 2: '任务奖励', 3: '内容奖励', 4: '下单抵扣', 5: '退款冲正', 6: '滚动过期', 7: '风控调整' } },
  retry() { this.onShow() },
  onShow() {
    this.setData({ error: '' })
    siteData.get().then((s) => this.setData({ beanIntro: s.bean_intro || '' }))
    api.getBean().then(bean => this.setData({ bean })).catch(e => this.setData({ bean: null, error: e.msg || '加载失败' }))
    // 等级、门槛、加成与权益都来自服务端（参数中心「会员等级体系」）
    api.getMe().then((m) => {
      const lv = m.level || {}
      this.setData({
        level: m.memberLevel || 1, levelPct: lv.pct || 0,
        levelHint: lv.next ? '成长值 ' + Number(lv.points).toLocaleString() + '，再积累 ' + Number(lv.next.gapPoints).toLocaleString() + ' 升级「' + lv.next.name + '」' : '成长值 ' + Number(lv.points || 0).toLocaleString() + '，已是最高等级',
        levels: (lv.levels || []).map((l) => ({ ...l, need: l.points ? '成长值 ' + Number(l.points).toLocaleString() : '注册即享', perkText: (l.perks || []).join(' · ') })),
      })
    }).catch(() => {})
    api.request('/c/bean/ledger').then((ledger) => this.setData({ ledger: ledger.slice(0, 10) })).catch(() => {})
  }
})
