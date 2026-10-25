const api = require('../../utils/api')
Page({
  data: { bean: null, ledger: [], level: 1, levels: [
    { lv: 1, name: '探索者', need: '注册即享' },
    { lv: 2, name: '旅行家', need: '成长值 5,000' },
    { lv: 3, name: '城市探索官', need: '成长值 20,000' },
    { lv: 4, name: '环球探索家', need: '成长值 60,000' },
  ], bizName: { 1: '消费返豆', 2: '任务奖励', 3: '内容奖励', 4: '下单抵扣', 5: '退款冲正', 6: '滚动过期', 7: '风控调整' } },
  onShow() {
    api.getBean().then(bean => this.setData({ bean }))
    api.getMe().then((m) => this.setData({ level: m.memberLevel || 1 })).catch(() => {})
    api.request('/c/bean/ledger').then((ledger) => this.setData({ ledger: ledger.slice(0, 10) })).catch(() => {})
  }
})
