const api = require('../../utils/api')
Page({
  data: { bean: null, ledger: [], level: 1, levels: [
    { lv: 1, name: '探索者', need: '注册即享' },
    { lv: 2, name: '旅行家', need: '成长值 2,000' },
    { lv: 3, name: '城市探索官', need: '成长值 10,000' },
    { lv: 4, name: '环球探索家', need: '成长值 50,000' },
  ], bizName: { 1: '消费返豆', 2: '任务奖励', 3: '内容奖励', 4: '下单抵扣', 5: '退款冲正', 6: '滚动过期', 7: '风控调整' } },
  retry() { this.onShow() },
  onShow() {
    this.setData({ error: '' })
    api.getBean().then(bean => this.setData({ bean })).catch(e => this.setData({ bean: null, error: e.msg || '加载失败' }))
    api.getMe().then((m) => this.setData({ level: m.memberLevel || 1, levels: this.data.levels.map((l,i) => ({ ...l, need: i === 0 ? '注册即享' : '成长值 ' + Number((m.levelThresholds || [0,2000,10000,50000])[i]).toLocaleString() })) })).catch(() => {})
    api.request('/c/bean/ledger').then((ledger) => this.setData({ ledger: ledger.slice(0, 10) })).catch(() => {})
  }
})
