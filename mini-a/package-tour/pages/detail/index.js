const api = require('../../../utils/api')
const place = require('../../../utils/place')

// 城市编码 → 名称（与 tour-list 筛选一致；未知编码不显示，避免把数字编码直接给游客看）
const CITY = { '310118': '上海·青浦', '330523': '湖州·安吉', '320508': '苏州·姑苏', '310000': '上海' }

Page({
  data: { extra: { tags: [], suitable: '', itinerary: [] }, rules: rulesOf({}), p: null, sessions: [], sessPreview: [], minGo: 0, cityName: '', loading: true, error: '',
    gallery: [], gIdx: 0, illustrated: false, rich: { intro: '', highlights: [], includes: [], excludes: [] }, rv: { avg: 0, count: 0, list: [] } },
  async onLoad(q) {
    this.pid = q.id
    if(q.scene)try{const r=await require('../../../utils/promo-source')(q);this.pid=r.id}catch(e){wx.removeStorageSync('promoScene');wx.showModal({title:'推广来源已失效',content:e.msg||'请重新获取有效推广码',showCancel:false});if(!this.pid)return this.setData({loading:false,error:e.msg||'推广码无效'})}
    this.load()
    // 推广服务商本人：分享自动带自己的归因 scene（好友下单即归因）
    api.request('/c/promote/scene').then((s) => { if (s.promoter) this.myScene = s.scene }).catch(() => {})
  },
  load() {
    this.setData({ loading: true, error: '' })
    api.getTourDetail(this.pid).then((d) => {
      const sessions = d.sessions || []
      let rich = {}
      try { rich = typeof d.rich_desc === 'string' ? JSON.parse(d.rich_desc || '{}') : (d.rich_desc || {}) } catch (e) { rich = {} }
      const images = api.productImages(d).map(api.img)
      const sessPreview = sessions.slice(0, 3).map((s) => {
        const left = Number(s.left_seats)
        const g = s.groupProgress || {}
        // D01：折扣团期显示折后价与原价、折扣条件（早鸟/折扣同源试算）
        const isPromo = !!(s.promo && Number(s.priceNow) < Number(s.promo.originalFen))
        const zheLabel = s.promo ? String(s.promo.zheLabel || s.promo.zhe || '') : ''
        return {
          id: s.id, date: s.depart_date + ' ' + weekday(s.depart_date),
          price: s.priceNowLabel || s.priceLabel,
          priceOriginal: isPromo ? (Number(s.promo.originalFen) / 100).toFixed(2) : '',
          promoTag: isPromo ? zheLabel + '折 · 按原价' + Math.round(Number(s.promo.zhe) * 100) + '%付款' : '',
          seats: left <= 0 ? '已满' : (left <= 5 ? '仅剩 ' + left + ' 席' : '余 ' + left + ' 席'),
          state: s.isEarly ? '早鸟价 · 提前 ' + s.daysToDepart + ' 天' : (isPromo ? s.promo.name : (g.minGo > 1 ? (g.reached ? '已成团' : '已报 ' + g.booked + '/' + g.minGo + ' 人成团') : '可预订')),
        }
      })
      let pf = {}
      try { pf = typeof d.profile === 'string' ? JSON.parse(d.profile || '{}') : (d.profile || {}) } catch (e) { pf = {} }
      const SUIT = { family: '亲子', couple: '情侣', friends: '朋友结伴', solo: '独自出行', senior: '银发长辈', team: '公司团建' }
      wx.setNavigationBarTitle({ title: d.title || '线路详情' })
      this.setData({
        p: d, sessions, sessPreview, loading: false,
        minGo: sessions.reduce((m, s) => Math.max(m, Number(s.min_go) || 0), 0),
        cityName: CITY[d.city_code] || '',
        rules: rulesOf(d),
        // B02：套餐组成项（名称/类型/每份数量/提供方）；空数组=非套餐产品不渲染
        pkgItems: (d.packageItems || []).map((i) => ({ name: i.name, qty: i.qtyPerUnit, kindText: Number(i.kind) === 1 ? '按人凭证' : '服务项', merchantName: i.merchantName, benefitDesc: i.benefitDesc || '', benefitRules: i.benefitRules || '' })),
        promoVideo: rich.video || '',
        merchant: d.merchantCard ? { ...d.merchantCard, honor: d.merchantHonor || null, hoursText: (d.merchantCard.business_hours || []).map((h) => (h.days || '每天') + ' ' + h.open + '-' + h.close).join('；') } : null,
        scenic: d.scenicCard || null, faqs: d.relatedFaqs || [], faqOpen: -1,
        // 后台表单引擎维护的扩展资料（profile）：标签、适合人群、行程节点、补充须知等
        extra: {
          tags: pf.tags || [], suitable: (pf.suitable || []).map((k) => SUIT[k]).filter(Boolean).join('、'),
          ageRange: pf.age_range || '', groupSize: pf.group_size || '', transport: pf.transport || '',
          itinerary: (pf.itinerary || []).map((n) => ({ ...n, image: n.image ? api.img(n.image) : '' })),
          notice: pf.notice || '', meetingGeo: pf.meeting_geo || '', shareTitle: pf.share_title || '', shareImage: pf.share_image ? api.img(pf.share_image) : '',
        },
        gallery: images.length ? images : [api.coverFor(d)], illustrated: !images.length || images.every(api.isReferencePhoto), gIdx: 0,
        rich: { intro: rich.intro || '', highlights: rich.highlights || [], includes: rich.includes || [], excludes: rich.excludes || [] },
        rv: d.rating ? { avg: d.rating.avg, count: d.rating.count, list: [] } : this.data.rv,
      })
      api.getReviews(this.pid).then((rv) => this.setData({ rv })).catch(() => {})
    }).catch(e => this.setData({ error: e.msg || '线路加载失败，请重试', loading: false }))
  },
  retry() { this.load() },
  navMeeting() { place.openGeo(this.data.extra.meetingGeo, '集合点', this.data.p.meeting_point) },
  goPlace(e) { wx.navigateTo({ url: `/package-tour/pages/place/index?kind=${e.currentTarget.dataset.kind}&id=${e.currentTarget.dataset.id}` }) },
  toggleFaq(e) { const i = Number(e.currentTarget.dataset.i); this.setData({ faqOpen: this.data.faqOpen === i ? -1 : i }) },
  onSwiper(e) { this.setData({ gIdx: e.detail.current }) },
  preview(e) {
    if (this.data.illustrated) return
    wx.previewImage({ urls: this.data.gallery, current: this.data.gallery[Number(e.currentTarget.dataset.i)] })
  },
  goBooking() {
    if (!this.data.sessions.length) return wx.showToast({ title: '近期暂无可预订团期', icon: 'none' })
    wx.navigateTo({ url: '/package-tour/pages/booking/index?id=' + this.pid })
  },
  onShareAppMessage() {
    const p = this.data.p || {}
    const scene = this.myScene ? '&scene=' + this.myScene : ''
    const ex = this.data.extra || {}
    return { title: ex.shareTitle || p.title || '向往的自由 · 主题游', path: '/package-tour/pages/detail/index?id=' + this.pid + scene, imageUrl: ex.shareImage || undefined }
  },
  onShareTimeline() {
    const p = this.data.p || {}
    return { title: p.title || '向往的自由 · 主题游', query: 'id=' + this.pid + (this.myScene ? '&scene=' + this.myScene : '') }
  },
})

function weekday(dateStr) {
  const d = new Date(String(dateStr).replace(/-/g, '/'))
  return isNaN(d) ? '' : '周' + '日一二三四五六'[d.getDay()]
}

function rulesOf(d) {
  const r = d.bookingRules || {}
  return { refundRules: r.refundRules || [], payTimeoutMin: r.payTimeoutMin || 15, deductPct: Math.round((r.beanDeductMaxPct != null ? r.beanDeductMaxPct : 0.1) * 100), beanPerYuan: r.beanPerYuan || 10 }
}
