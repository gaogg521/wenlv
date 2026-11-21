// 商品新增/档案修改(退回项4):与 PC 同状态机同白名单——保存草稿 → 提交审核 → 平台确认 → 生效。
// 字段只含主体白名单(标题/副标题/品类/天数/起售价/介绍/图集);归属与上架由平台管理,表单不出现。
const api = require('../../utils/api')

const CATS = [['script', '剧本闯关'], ['yoga', '瑜伽之旅'], ['sister', '姐姐系列'], ['single', '单身社交'], ['sport', '体育竞技'], ['family', '亲子主题'], ['shop', '商城好物']]

Page({
  data: { mode: 'create', cats: CATS, catNames: CATS.map(c => c[1]), catIndex: 0, title: '', subtitle: '', daysDesc: '', priceYuan: '', intro: '', images: [], submitting: false, loaded: false, error: '' },
  onLoad(options) {
    this.setData({ mode: options.id ? 'edit' : 'create' })
    if (options.id) this.load(Number(options.id))
    else {
      // 新增默认品类:剧本闯关
      this.setData({ loaded: true, catIndex: 0 })
    }
  },
  onShow() { api.refreshPerms(true) },
  load(id) {
    api.request('/m/products/' + id).then((d) => {
      const v = d.values || {}
      const catIndex = Math.max(0, CATS.findIndex((c) => c[0] === (d.cat || 'script')))
      this.setData({
        loaded: true, id: d.id, version: d.version, title: v.title || '', subtitle: v.subtitle || '',
        daysDesc: v.days_desc || '', priceYuan: v.price_from != null ? String(v.price_from) : '',
        intro: this.stripRich(v.intro), images: Array.isArray(v.images) ? v.images : [], catIndex,
      })
    }).catch((e) => this.setData({ error: e.msg || '商品加载失败', loaded: true }))
  },
  // rich 展示口径转纯文本(详情页富文本只保留可见文字)
  stripRich(html) {
    if (!html) return ''
    return String(html).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
  },
  onInput(e) { const k = e.currentTarget.dataset.k; const d = {}; d[k] = e.detail.value; this.setData(d) },
  onCat(e) { this.setData({ catIndex: Number(e.detail.value) }) },
  addImage() {
    const perms = api.permsFor()
    if (!(perms.product && perms.product.update && perms.product.update.allowed !== false) && this.data.mode === 'edit') {
      // 字段级收紧在服务端逐键校验;这里只做入口提示
    }
    wx.chooseMedia({ count: 9 - this.data.images.length, mediaType: ['image'], success: (r) => {
      const files = (r.tempFiles || []).slice(0, 9 - this.data.images.length)
      let done = 0, failed = 0
      const next = () => { if (done + failed >= files.length) this.setData({ images: this.data.images }); }
      files.forEach((f) => {
        wx.getFileSystemManager().readFile({ filePath: f.tempFilePath, base64: true, success: (b) => {
          api.request('/m/upload/image', 'POST', { data: b.data, ext: f.tempFilePath.split('.').pop().toLowerCase() }).then((u) => {
            this.data.images.push(u.url); done += 1; next()
          }).catch((e) => { failed += 1; wx.showToast({ title: e.msg || '图片上传失败', icon: 'none' }); next() })
        }, fail: () => { failed += 1; next() } })
      })
    } })
  },
  removeImage(e) {
    const i = Number(e.currentTarget.dataset.i)
    const images = this.data.images.slice(); images.splice(i, 1)
    this.setData({ images })
  },
  buildPayload() {
    const cat = CATS[this.data.catIndex] || CATS[0]
    const price = Number(this.data.priceYuan)
    const payload = {
      title: String(this.data.title || '').trim(),
      subtitle: String(this.data.subtitle || '').trim(),
      days_desc: String(this.data.daysDesc || '').trim(),
      price_from: price > 0 ? price : null,
      intro: this.data.intro ? '<p>' + String(this.data.intro).replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])) + '</p>' : '',
      images: this.data.images,
    }
    // 品类(cat)仅新增可提交;修改申请不触类目(白名单口径,类目变更走平台侧)
    if (this.data.mode === 'create') payload.cat = cat[0]
    return payload
  },
  validate(payload) {
    if (!payload.title) return '请填写商品标题'
    if (!(payload.price_from > 0)) return '请填写有效的起售价(元)'
    if (!payload.intro || payload.intro === '<p></p>') return '请填写商品介绍'
    return ''
  },
  save(submit) {
    if (this.data.submitting) return
    const payload = this.buildPayload()
    const err = this.validate(payload)
    if (err) return wx.showToast({ title: err, icon: 'none' })
    this.setData({ submitting: true })
    const impactNote = this.data.mode === 'create' ? '新增商品申请,批准后按草稿上架流程办理' : '商品档案修改,已下单游客按原约定履约'
    const body = { kind: 'product', action: this.data.mode === 'create' ? 'create' : 'update',
      resourceId: this.data.mode === 'edit' ? this.data.id : null,
      payload, expectedVersion: this.data.mode === 'edit' ? this.data.version : undefined,
      note: submit ? '小程序端' + (this.data.mode === 'create' ? '新增' : '档案修改') : '',
      impactNote, submit }
    const call = this.data.mode === 'edit' && !submit
      ? api.request('/m/subject-requests/' + this.data.draftId, 'PUT', body)
      : api.request('/m/subject-requests', 'POST', body)
    call.then((r) => {
      this.setData({ submitting: false })
      if (submit) {
        wx.showToast({ title: '已提交审核' + (r.reqNo ? ':' + r.reqNo : ''), icon: 'none', duration: 2500 })
        setTimeout(() => wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/supply/index' }) }), 1200)
      } else {
        this.setData({ draftId: r.id })
        wx.showToast({ title: '草稿已保存,可在「我的变更申请」续编提交', icon: 'none', duration: 2500 })
      }
    }).catch((e) => {
      this.setData({ submitting: false })
      wx.showToast({ title: e.msg || '提交失败', icon: 'none', duration: 3000 })
    })
  },
  saveDraft() { this.save(false) },
  submitReview() { this.save(true) },
})
