const api = require('../../../utils/api')
Page({
  data: { p: null, sessions: [], sel: 0, qty: 1, useBean: true, beanBal: 0, loading: true, fallback: false,freedomRightId:0,freedomRows:[],freedomSelected:null,freedomError:'',pricing:false,
    contactName: '', contactPhone: '', phoneTicket: '', agree: false, buyInsurance: false, gallery: [], gIdx: 0, rich: { intro: '', highlights: [], includes: [] }, rv: { avg: 0, count: 0, list: [] } },
  onLoad(q) {
    this.pid = q.id
    api.request('/c/consent').then(d => this.setData({ legalVersions: d.versions })).catch(() => {})
    if (q.scene && /^[pm][0-9a-z-]+$/i.test(decodeURIComponent(q.scene))) {
      wx.setStorageSync('promoScene', decodeURIComponent(q.scene))
    }
    api.getTourDetail(q.id).then((d) => {
      const withFallbackSessions = d.sessions || []
      const rich = typeof d.rich_desc === 'string' ? JSON.parse(d.rich_desc || '{}') : (d.rich_desc || {})
      const images = api.productImages(d)
      const gallery = images.length ? images.map(api.img) : [api.coverFor(d)]
      this.setData({ illustrated: !images.length })
      const sv = this.sessView(withFallbackSessions[0])
      // 默认选中第一个还有名额的团期
      const firstOpen = Math.max(0, withFallbackSessions.findIndex((x) => Number(x.left_seats) > 0))
      // A-42：分包 wxml 只做取值——保险相关在 JS 预计算（复杂表达式会静默炸分包编译）
      d.hasInsurance = Number(d.insurance_fee) > 0 && d.insuranceAvailable !== false
      d.insuranceFeeYuan = (Number(d.insurance_fee) / 100).toFixed(2)
      // B02：套餐组成项（预订页展示包含内容；空数组=非套餐）
      d.pkgItems = (d.packageItems || []).map((i) => ({ name: i.name, qtyText: '×' + i.qtyPerUnit, kindText: Number(i.kind) === 1 ? '按人凭证' : '服务项', merchantName: i.merchantName, benefit: (i.benefitDesc ? i.benefitDesc : '') + (i.benefitRules ? '；' + i.benefitRules : '') }))
      this.setData({ p: d, sessions: withFallbackSessions, sel: firstOpen, selView: this.sessView(withFallbackSessions[firstOpen]), loading: false, fallback: !(d.sessions && d.sessions.length),
        gallery, gIdx: 0, rich: { intro: rich.intro || '', highlights: rich.highlights || [], includes: rich.includes || [] },
        rv: d.rating ? { avg: d.rating.avg, count: d.rating.count, list: [] } : this.data.rv }, () => this.updatePrice())
    }).catch(e => this.setData({ error: e.msg || '线路加载失败，请重试', loading: false }))
    api.getBean().then(b => this.setData({ beanBal: b.balance }, () => this.updatePrice())).catch(() => {})
    // 推广服务商本人：分享自动带自己的归因 scene（好友下单即归因）
    api.request('/c/promote/scene').then((s) => { if (s.promoter) this.myScene = s.scene }).catch(() => {})
  },
  fetchReviews() {
    api.getReviews(this.pid).then((rv) => this.setData({ rv })).catch(() => {})
  },
  retry() { this.setData({ loading: true, error: '' }); this.onLoad({ id: this.pid }) },
  onReady() { wx.setNavigationBarTitle({ title: '确认订单' }) },
  onSwiper(e) { this.setData({ gIdx: e.detail.current }) },
  onShareAppMessage() {
    const p = this.data.p || {}
    const scene = this.myScene ? '&scene=' + this.myScene : ''
    return { title: p.title || '向往的自由 · 主题游', path: '/package-tour/pages/detail/index?id=' + this.pid + scene }
  },
  onShareTimeline() {
    const p = this.data.p || {}
    return { title: p.title || '向往的自由 · 主题游', query: 'id=' + this.pid + (this.myScene ? '&scene=' + this.myScene : '') }
  },
  // 本地估算（登录试算前的即时反馈）：s.priceNow 已是详情接口按早鸟/折扣同源注价的有效单价
  updatePrice() {
    const s = this.data.sessions[this.data.sel]
    if (!s) return
    const goods = Number(s.priceNow || s.price_adult) * this.data.qty
    const beans = this.data.useBean ? Math.min(Number(this.data.beanBal) || 0, this.beanCap(goods, 0)) : 0
    const unit = Number(s.priceNow || s.price_adult)
    const ins = this.data.buyInsurance ? Math.max(0, Number(this.data.p.insurance_fee) || 0) * this.data.qty : 0
    const promo = s.promo || null
    const zheLabel = promo ? String(promo.zheLabel || promo.zhe || '') : ''
    this.setData({ priceSummary: { unit: (unit / 100).toFixed(2), goods: (goods / 100).toFixed(2),
      originalUnit: promo ? (Number(promo.originalFen) / 100).toFixed(2) : '', showPromo: !!(promo && unit < Number(promo.originalFen)),
      zheLabel, promoText: promo && unit < Number(promo.originalFen) ? zheLabel + '折 · 按原价' + Math.round(Number(promo.zhe) * 10 * 10) / 10 + '%付款' : '',
      capYuan: (this.beanCap(goods, 0) / 10).toFixed(2),
      insurance: (ins / 100).toFixed(2), showInsRow: ins > 0,
      deduct: (beans / 10).toFixed(2), pay: ((goods - beans * 10 + ins) / 100).toFixed(2) } })
    this.quoteFreedom(s)
  },
  // 服务端试算（权威）：有效商品价→自由豆门槛与满减→旅豆实付锚定→现金应付，全部以本结果覆盖本地估算
  async quoteFreedom(s){
    const seq=this.priceSeq=(this.priceSeq||0)+1,rightId=this.data.freedomRightId
    this.setData({pricing:true,freedomError:''})
    try{await api.ensureLogin()
      const beanWanted=this.data.useBean?Math.min(Number(this.data.beanBal)||0,this.beanCap(Number(s.priceNow||s.price_adult)*this.data.qty,0)):0
      const d=await api.request('/c/freedom/quote','POST',{sessionId:s.id,qty:this.data.qty,insurance:this.data.buyInsurance,rightId:rightId||undefined,beanDeduct:beanWanted})
      if(seq!==this.priceSeq)return
      const money=v=>(Number(v)/100).toFixed(2).replace(/\.00$/,'')
      const rows=d.rows.map(x=>({...x,thresholdText:money(x.threshold),discountText:money(x.discount),validTo:String(x.to||'').slice(0,10),label:'满'+money(x.threshold)+'元减'+money(x.discount)+'元 · '+(x.reason||('有效期至'+String(x.to||'').slice(0,10)))}))
      // 修复1（Codex退回#1）：beanDeduct/beanCap 为分（服务端口径），按分换元展示；提交数用服务端回包的 beanDeductCount 整豆，
      // 不再从展示金额反推（此前除以10导致抵扣十倍显示、提交数量按错误金额计算）
      const quoted={goods:(d.goods/100).toFixed(2),deduct:(d.beanDeduct/100).toFixed(2),pay:(d.cashPay/100).toFixed(2),insurance:(d.insurance/100).toFixed(2),
        capYuan:(d.beanCapBeans/10).toFixed(2),discount:(d.discount/100).toFixed(2),beanDeductCount:Math.max(0,Math.round(Number(d.beanDeductCount)||0))}
      this.setData({freedomRows:rows,freedomOptions:[{label:'不使用自由豆'}].concat(rows),freedomSelected:rightId?rows.find(x=>Number(x.id)===Number(rightId))||null:null,freedomDiscount:quoted.discount,
        quoted,'priceSummary.goods':quoted.goods,'priceSummary.deduct':quoted.deduct,'priceSummary.pay':quoted.pay,'priceSummary.insurance':quoted.insurance,'priceSummary.capYuan':quoted.capYuan})
    }catch(e){if(seq===this.priceSeq)this.setData({freedomRows:[],freedomError:e.msg||'补贴试算失败，请重试'})}finally{if(seq===this.priceSeq)this.setData({pricing:false})}
  },
  // D01：自由豆与旅豆同单可用——选择/取消券不再清空旅豆选择，反之亦然；两者分别试算、独立记账
  chooseFreedom(e){
    if(this.data.pricing)return
    const rows=this.data.freedomRows
      const i=Number(e.detail.value),x=i?rows[i-1]:null
      if(x&&!x.eligible)return wx.showToast({title:x.reason||'不适用',icon:'none'})
      this.setData({freedomRightId:x?x.id:0,freedomSelected:x||null},()=>this.updatePrice())
  },
  /** 本地抵扣上限（豆）：与服务端 bean.anchorCapBeans 同一整数公式——
   *  抵扣 B ≤ r×X（X＝有效商品额−券额−B）→ beans ≤ floor(rBp×net/(10×(10000+rBp)))；试算返回后以服务端为准 */
  beanCap(goodsFen, freedomFen) {
    const pct = this.data.p && this.data.p.bookingRules ? Number(this.data.p.bookingRules.beanDeductMaxPct) : 0.1
    const rBp = Math.round(pct * 10000), net = goodsFen - (freedomFen || 0)
    if (net <= 0 || rBp <= 0) return 0
    return Math.floor((rBp * net) / (10 * (10000 + rBp)))
  },
  // 团期展示预计算（wxml 只做取值，防分包表达式炸编译）
  sessView(s) {
    if (!s) return { label: '', extra: '', info: null }
    const parts = [s.depart_date + ' · 余' + s.left_seats]
    const extra = []
    if (s.isEarly) extra.push('🐦 早鸟价 ¥' + (s.priceNow / 100) + '（提前 ' + s.daysToDepart + ' 天报名）')
    if (s.promo && Number(s.priceNow) < Number(s.promo.originalFen)) extra.push('折扣 ' + (s.promo.zheLabel || s.promo.zhe) + ' 折 · 按原价 ' + (Math.round(Number(s.promo.zhe) * 100) / 10) + '% 付款')
    if (s.groupProgress) extra.push(s.groupProgress.reached ? '已成团' : '需 ' + s.groupProgress.minGo + ' 人成团 · 已报 ' + s.groupProgress.booked)
    const info = s.info && Object.keys(s.info).length ? s.info : null
    return { label: parts[0], extra: extra.join(' · '), info }
  },

  pick(e) {
    const s = this.data.sessions[Number(e.currentTarget.dataset.i)]
    if (s && Number(s.left_seats) <= 0) return wx.showToast({ title: '该团期已满，请选择其他日期', icon: 'none' })
    this.setData({ sel: Number(e.currentTarget.dataset.i), qty: 1, selView: this.sessView(this.data.sessions[Number(e.currentTarget.dataset.i)]) }, () => this.updatePrice()) },
  addQty() {
    const s = this.data.sessions[this.data.sel]
    const cap = Math.min(9, s && s.left_seats ? Number(s.left_seats) : 9)
    if (this.data.qty >= cap) return wx.showToast({ title: s && s.left_seats ? '已达该团期剩余名额（' + cap + '）' : '单单最多 9 人', icon: 'none' })
    this.setData({ qty: this.data.qty + 1 }, () => this.updatePrice())
  },
  subQty() {
    if (this.data.qty <= 1) return
    this.setData({ qty: this.data.qty - 1 }, () => this.updatePrice())
  },
  // D01：切换旅豆不再清空已选自由豆——同单可用、独立试算
  toggleBean(e) { this.setData({ useBean: e && e.detail && typeof e.detail.value === 'boolean' ? e.detail.value : !this.data.useBean }, () => this.updatePrice()) },
  toggleInsurance(e) { this.setData({ buyInsurance: !!e.detail.value }, () => this.updatePrice()) },
  toggleAgree(e) { this.setData({ agree: e.detail.value.includes('agree') }) },
  goDoc(e) { wx.navigateTo({ url: '/package-content/pages/doc/index?type=' + (e.currentTarget.dataset.type === 'terms' ? 'agreement' : 'privacy') }) },
  onName(e) { this.setData({ contactName: e.detail.value }) },
  // 微信官方手机号快速验证组件回调：code 交服务端换号。
  // A-08：服务端不下发明文也不下发打码值（打码值过不了 11 位校验，一键获取后必下单失败），
  // 改为下发短期凭证 phoneTicket——提交订单时随单带上，服务端解封后加密落库
  async onPhone(e) {
    if (!e.detail || !e.detail.code) return
    try {
      const r = await api.getPhoneNumber(e.detail.code)
      this.setData({ phoneTicket: r.ticket || '', contactPhone: r.phoneMasked || '' })
      wx.showToast({ title: '手机号已验证', icon: 'success' })
    } catch (err) { wx.showToast({ title: err.msg || '验证失败', icon: 'none' }) }
  },
  // 手动输入兜底：微信快速验证组件之外的常规途径（11 位格式校验）；手动输入清掉凭证
  onPhoneInput(e) {
    const v = String(e.detail.value || '').replace(/[^0-9]/g, '').slice(0, 11)
    this.setData({ contactPhone: v, phoneTicket: '' })
  },
  async submit() {
    const s = this.data.sessions[this.data.sel]
    if (this.data.submitting) return
    if(this.data.freedomRightId&&(this.data.pricing||this.data.freedomError))return wx.showToast({title:this.data.freedomError||'请等待补贴试算',icon:'none'})
    if (!this.data.agree) return wx.showToast({ title: '请先阅读并同意服务条款与隐私政策', icon: 'none' })
    if (!s || Number(s.left_seats) < this.data.qty) return wx.showToast({ title: '当前团期名额不足，请选择其他日期', icon: 'none' })
    if (!String(this.data.contactName || '').trim()) return wx.showToast({ title: '请填写联系人姓名', icon: 'none' })
    // A-08：一键获取（有 phoneTicket）或手输 11 位手机号，二者其一即可下单
    if (!this.data.phoneTicket && !/^1[3-9]\d{9}$/.test(this.data.contactPhone || '')) return wx.showToast({ title: '请填写 11 位有效手机号', icon: 'none' })
    this.setData({ submitting: true })
    try {
      await api.ensureLogin()
      await api.request('/c/consent', 'POST', { scene: 'privacy', granted: true, version: this.data.legalVersions?.privacy })
      await api.request('/c/consent', 'POST', { scene: 'terms', granted: true, version: this.data.legalVersions?.terms })
      // 旅豆抵扣：优先用服务端试算回包的整豆数 beanDeductCount（已按余额+实付锚定上限收敛）；
      // 无试算结果时本地估算。修复1：不再从展示金额（元）反推豆数。
      const want = this.data.quoted && this.data.quoted.beanDeductCount != null
        ? this.data.quoted.beanDeductCount
        : (this.data.useBean ? Math.min(this.data.beanBal || 0, this.beanCap(Number(s.priceNow || s.price_adult) * this.data.qty, 0)) : 0)
      const r = await api.createOrder({ sessionId: s.id, qty: this.data.qty, beanDeduct: want,
        freedomRightId:this.data.freedomRightId||undefined,
        expectedGoodsFen: this.data.quoted ? Math.round(Number(this.data.quoted.goods) * 100) : Math.round(Number(s.priceNow || s.price_adult) * this.data.qty),
        insurance: this.data.buyInsurance,
        promoScene: (!Number(wx.getStorageSync('promoProductId'))||Number(wx.getStorageSync('promoProductId'))===Number(this.pid))?(wx.getStorageSync('promoScene')||undefined):undefined,
        contactName: this.data.contactName,
        phoneTicket: this.data.phoneTicket || undefined,
        contactPhone: this.data.phoneTicket ? undefined : this.data.contactPhone })
      // 订阅在支付结果页由独立按钮同步触发，避免异步下单丢失用户手势。
      try { await api.pay(r.payParams) } catch (err) { wx.showToast({ title: '支付未完成，可在订单中继续支付', icon: 'none' }) }
      wx.redirectTo({ url: '/package-tour/pages/pay-result/index?orderNo=' + r.orderNo + '&mock=' + (r.payParams.mock ? 1 : 0) })
    } catch (e) {
      wx.showToast({ title: e.msg || '下单失败', icon: 'none' })
    } finally { this.setData({ submitting: false }) }
  },
})
