// 记录复核：商户拿勋章 / 订单记录上的 8 位「记录编号」来核对这条记录有没有被改动。
// 走接口 GET /open/verify/record/:code（无需登录），只展示类型、名称、日期、封存状态和校验结果；
// 不展示业务单号、金额，也不展示指纹原文。想自己在浏览器里再算一遍，可复制复核链接。
const api = require('../../utils/api')
const STATE = { 0: '等待封存', 1: '已封存 · 待确认', 2: '已确认', 3: '处理中', 4: '待人工核对', 5: '已提交 · 待确认' }
const CODE_RE = /^[0-9A-F]{8}$/

/** 把接口回的一条记录整理成页面要显示的样子 */
function view(r) {
  let result = 'wait', resultText = '这条记录还没封存，暂时无法校验', resultNote = '封存后再来复核'
  if (r.proofValid === false || r.canonicalValid === false) {
    result = 'bad'; resultText = '校验不一致'; resultNote = '这条记录与封存时不同，请联系平台处理'
  } else if (r.proofValid === true) {
    result = 'ok'; resultText = '校验一致'; resultNote = '这条记录自封存后没有被改动'
  }
  const stateText = STATE[Number(r.status)] || '记录处理中'
  const batchText = r.batchSeq != null ? '第 ' + r.batchSeq + ' 批' : ''
  return {
    kind: r.kind, title: r.title, date: r.date,
    stateText, batchText,
    // WXML 红线：拼接在 JS 预组合（stateLine = 状态 · 批次）
    stateLine: stateText + (batchText ? ' · ' + batchText : ''),
    result, resultText, resultNote,
    mark: result === 'ok' ? '✓' : (result === 'bad' ? '!' : '·'),
  }
}

Page({
  data: { input: '', code: '', loading: false, tried: false, err: '', records: [] },
  onLoad(q) {
    const c = String((q && q.code) || '').trim()
    if (c) { this.setData({ input: c.toUpperCase() }); this.check(c) }
  },
  onInput(e) { this.setData({ input: e.detail.value }) },
  submit() { return this.check(this.data.input) },
  async check(raw) {
    const code = String(raw || '').replace(/\s+/g, '').toUpperCase()
    if (!CODE_RE.test(code)) return this.setData({ tried: true, records: [], code: '', err: '记录编号是 8 位数字或字母（0-9、A-F），例如 DEF45B80' })
    const seq = (this._seq = (this._seq || 0) + 1)   // 连点两次时只认最后一次的结果
    this.setData({ loading: true, err: '', code, input: code })
    try {
      const d = await api.request('/open/verify/record/' + code)
      if (seq !== this._seq) return
      this.setData({ loading: false, tried: true, records: (d.records || []).map(view) })
    } catch (e) {
      if (seq !== this._seq) return
      const err = e && e.network ? '网络不通，请稍后重试' : (e && Number(e.code) === 1004 ? '没有找到这个记录编号，请核对后重试' : ((e && e.msg) || '暂时无法复核，请稍后重试'))
      this.setData({ loading: false, tried: true, records: [], err })
    }
  },
  copyLink() {
    const code = this.data.code
    if (!code) return
    wx.setClipboardData({
      data: getApp().globalData.apiBase + '/verify?mode=t1&no=' + code,
      // 复制成功时微信会自己弹「内容已复制」，把紧接着的提示盖掉（真机渲染里看到的）；等它收起，再告诉商户下一步怎么做
      success: () => setTimeout(() => wx.showToast({ title: '复核链接已复制，用浏览器打开即可', icon: 'none', duration: 2600 }), 1600),
    })
  },
})
