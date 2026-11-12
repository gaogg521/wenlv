const api = require('../../utils/api')
const siteData = require('../../utils/site')
Page({
  data: { bean: null, ledger: [], level: 1, levels: [], levelPct: 0, levelHint: '', levelName: '', levelArt: '', glyph: { 1: '返', 2: '任', 3: '文', 4: '抵', 5: '退', 6: '期', 7: '调', 8: '初' }, bizName: { 1: '消费返豆', 2: '任务奖励', 3: '内容奖励', 4: '下单抵扣', 5: '退款冲正', 6: '滚动过期', 7: '风控调整', 8: '期初余额导入' } },
  retry() { this.onShow() },
  onShow() {
    this.setData({ error: '' })
    siteData.get().then((s) => this.setData({ beanIntro: s.bean_intro || '' }))
    // A-18：演示兜底仅限开发环境且常驻标识；正式版错误态 + 重试；冻结（1003）原样提示
    api.getBean().then(bean => this.setData({ bean })).catch((e) => {
      if (api.demoAllowed()) { this.setData({ bean: api.FALLBACK.bean, demo: true, error: '' }); wx.showToast({ title: '演示模式（后端未连接）', icon: 'none' }) }
      else this.setData({ demo: false, error: e.msg || '加载失败，请检查网络后重试' })
    })
    // 等级、门槛、加成与权益都来自服务端（参数中心「会员等级体系」）
    api.getMe().then((m) => this.fillMember(m)).catch((e) => {
      if (api.demoAllowed()) { this.fillMember(api.FALLBACK.member); this.setData({ demo: true }) }
      else this.setData({ demo: false, error: e.msg || '加载失败，请检查网络后重试' })
    })
    api.request('/c/member/contribution').then(result => {
      const labels = { 1: '成交贡献', 2: '内容采纳', 3: '景区复购' }
      const states = { pending: '待发', limited: '受月上限限制', credited: '已发', revoked: '已冲回' }
      this.setData({ contribution: result.rows.filter(r => r.growth_state !== 'legacy').slice(0, 8).map(r => ({
        id: r.id, label: labels[r.kind], state: states[r.growth_state], score: Number(r.cs).toFixed(2),
        growth: (Number(r.growth_active) / 100).toFixed(2), reason: r.growth_state === 'revoked' ? r.reason : '',
      })) })
    }).catch(() => this.setData({ contribution: [] }))
    api.request('/c/bean/ledger').then((ledger) => this.setData({ ledger: (ledger || []).slice(0, 20) }))
      .catch((e) => {
        if (api.demoAllowed()) this.setData({ ledger: api.FALLBACK.ledger, demo: true })
        else this.setData({ demo: false, error: e.msg || '加载失败，请检查网络后重试' })
      })
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
