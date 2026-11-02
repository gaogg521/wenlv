// 实体表单引擎（SaaS 式"字段即配置"）
//
// 一个实体 = 一份 schema：分组(sections) → 字段(fields)。后台编辑器、服务端校验、审计、完整度统计都读同一份定义。
// 字段存储位置 store：
//   'col'                 → 表的真实列（业务逻辑会读的核心字段：名称、状态、价格……）
//   { json: 列, key: 键 } → 某个 JSON 列里的键（如 tour_product.rich_desc.intro，保持小程序既有读取方式不变）
//   'profile'（默认）     → 表的 profile JSON 列（V27 新增，扩展资料：图集、证照、联系人、行程……）
// 新增字段只需要在这里加一行；不需要迁移、不需要改接口。
import { one, q, BizError } from '../db.mjs'
import { cfgArr } from '../config.mjs'
import { sanitizeRich, richTextLength } from '../infra/sanitize.mjs'
import { bizDay } from '../infra/bizdate.mjs'

/* ---------------- 共享字典 ---------------- */
export const DICT = {
  city: [['310118', '上海·青浦'], ['310000', '上海'], ['320508', '苏州·姑苏'], ['330500', '湖州'], ['330523', '湖州·安吉']],
  merchantKind: [['catering', '餐饮'], ['hotel', '住宿'], ['ticket', '门票'], ['transport', '交通'], ['experience', '体验'], ['other', '其他']],
  supplierCat: [['ticket', '门票'], ['hotel', '住宿'], ['transport', '交通'], ['ground', '地接'], ['catering', '餐饮'], ['other', '其他']],
  settleMode: [['monthly', '月结'], ['per_order', '单结'], ['prepaid', '预付']],
  productCat: [['script', '剧本闯关'], ['yoga', '瑜伽之旅'], ['sister', '姐姐系列'], ['single', '单身社交'], ['sport', '体育竞技'], ['family', '亲子主题'], ['red', '红色文旅'], ['shop', '商城 SKU']],
  weekday: [['1', '周一'], ['2', '周二'], ['3', '周三'], ['4', '周四'], ['5', '周五'], ['6', '周六'], ['7', '周日']],
}
const yesNo = [['1', '是'], ['0', '否']]

/* ---------------- 字段类型 ----------------
 text textarea rich int number money(分) percent(0~1) select multi tags lines switch date datetime time
 image gallery phone email url color geo ref(关联实体 id) repeat(子表) */

const S = {
  // ======================= 线路商品 =======================
  product: {
    label: '线路商品', table: 'tour_product', idCol: 'id', roles: ['super', 'ops'], auditModule: 'product',
    titleKey: 'title',
    sections: [
      { title: '基本信息', desc: '游客在列表与详情页首先看到的信息', fields: [
        { k: 'title', label: '线路标题', type: 'text', store: 'col', required: true, max: 60, span: 2, ph: '如：朱家角剧本游 · 江南谜案' },
        { k: 'subtitle', label: '副标题 / 卖点一句话', type: 'text', store: 'col', max: 80, span: 2, ph: '一句话说清楚为什么值得去' },
        { k: 'cat', label: '主题频道', type: 'select', store: 'col', required: true, options: DICT.productCat },
        { k: 'city_code', label: '目的地城市', type: 'select', store: 'col', required: true, options: DICT.city },
        { k: 'days_desc', label: '行程天数', type: 'text', store: 'col', max: 20, ph: '如：1天 / 2天1夜' },
        { k: 'price_from', label: '起售价', type: 'money', store: 'col', required: true, min: 1, unit: '元', help: '列表展示的"起"价；实际以团期价格为准' },
        { k: 'bean_gift', label: '完成赠送旅豆', type: 'int', store: 'col', min: 0, max: 100000, unit: '豆' },
        { k: 'tags', label: '标签', type: 'tags', max: 8, help: '回车添加，如：小团 / 含午餐 / 摄影跟拍' },
        { k: 'suitable', label: '适合人群', type: 'multi', options: [['family', '亲子'], ['couple', '情侣'], ['friends', '朋友结伴'], ['solo', '独自出行'], ['senior', '银发长辈'], ['team', '公司团建']] },
        { k: 'age_range', label: '年龄要求', type: 'text', max: 30, ph: '如：6 岁以上，70 岁以下需家属陪同' },
        { k: 'group_size', label: '团队规模', type: 'text', max: 30, ph: '如：8~16 人精品小团' },
      ] },
      { title: '图文介绍', fields: [
        { k: 'images', label: '图集', type: 'gallery', store: 'col', max: 9, span: 2, help: '第一张为封面；建议 4:3，2MB 以内' },
        { k: 'highlights', label: '玩法亮点', type: 'lines', store: { json: 'rich_desc', key: 'highlights' }, max: 8, span: 2, help: '每行一条，详情页以要点展示' },
        { k: 'intro', label: '行程介绍', type: 'rich', store: { json: 'rich_desc', key: 'intro' }, span: 2, required: true },
      ] },
      { title: '行程安排', desc: '按时间顺序排列，详情页以时间线展示', fields: [
        { k: 'itinerary', label: '行程节点', type: 'repeat', span: 2, max: 20, of: [
          { k: 'time', label: '时间/日程', type: 'text', max: 20, ph: 'D1 09:00' },
          { k: 'title', label: '安排', type: 'text', max: 40, required: true, ph: '古镇集合 · 领取剧本' },
          { k: 'desc', label: '说明', type: 'textarea', max: 300 },
          { k: 'image', label: '配图', type: 'image' },
        ] },
        { k: 'transport', label: '交通方式', type: 'text', max: 80, span: 2, ph: '如：自行前往集合点 / 含往返大巴' },
        { k: 'meeting_point', label: '集合地点', type: 'text', store: 'col', max: 120, span: 2 },
        { k: 'meeting_geo', label: '集合点坐标', type: 'geo', help: '用于导航，格式：纬度,经度' },
      ] },
      { title: '费用与须知', fields: [
        { k: 'includes', label: '费用包含', type: 'lines', store: { json: 'rich_desc', key: 'includes' }, max: 20 },
        { k: 'excludes', label: '费用不含', type: 'lines', store: { json: 'rich_desc', key: 'excludes' }, max: 20 },
        { k: 'notice', label: '补充预订须知', type: 'rich', span: 2, help: '退改规则由参数中心统一下发，这里写线路特有的注意事项' },
        { k: 'safety_note', label: '安全告知', type: 'textarea', store: 'col', max: 500, span: 2 },
        { k: 'insurance_note', label: '保险说明', type: 'textarea', store: 'col', max: 300, span: 2 },
      ] },
      { title: '履约与资源', fields: [
        { k: 'merchant_id', label: '履约商户', type: 'ref', ref: 'merchant', store: 'col', required: true, help: '仅已审核商户可选' },
        { k: 'supplier_id', label: '关联供应商', type: 'ref', ref: 'supplier', store: 'col' },
        { k: 'scenic_id', label: '关联景区', type: 'ref', ref: 'scenic', store: 'col' },
      ] },
      { title: '分享与推广', fields: [
        { k: 'share_title', label: '分享标题', type: 'text', max: 40, ph: '留空则用线路标题' },
        { k: 'share_image', label: '分享图', type: 'image', help: '5:4，微信分享卡片使用' },
        { k: 'keywords', label: '搜索关键词', type: 'tags', max: 10 },
      ] },
    ],
    async validate(v, ctx) {
      if (v.merchant_id && !(await one('SELECT id FROM merchant WHERE id = ? AND status = 1', [v.merchant_id]))) return { merchant_id: '请选择已审核的履约商户' }
    },
    async create(c, v) {
      return c.ins(`INSERT INTO tour_product (channel, city_code, cat, title, price_from, merchant_id, status, rich_desc)
        VALUES ('main', ?, ?, ?, ?, ?, 0, '{}')`, [v.city_code, v.cat, v.title, v.price_from, v.merchant_id])
    },
  },

  // ======================= 团期 =======================
  session: {
    label: '团期', table: 'tour_session', idCol: 'id', roles: ['super', 'ops'], auditModule: 'session', parent: 'product_id',
    titleKey: 'depart_date',
    sections: [
      { title: '日期与名额', fields: [
        { k: 'depart_date', label: '出发日期', type: 'date', store: 'col', required: true },
        { k: 'status', label: '团期状态', type: 'select', store: 'col', options: [['1', '报名中'], ['2', '已成团'], ['3', '已截止'], ['4', '已取消']], dflt: '1' },
        { k: 'quota', label: '名额', type: 'int', store: 'col', required: true, min: 1, max: 999, unit: '人' },
        { k: 'min_go', label: '成团人数', type: 'int', store: 'col', min: 1, max: 999, unit: '人', dflt: 10 },
        { k: 'sign_deadline', label: '报名截止', type: 'datetime', help: '展示用，到点请将状态改为"已截止"' },
      ] },
      { title: '价格', fields: [
        { k: 'price_adult', label: '成人价', type: 'money', store: 'col', required: true, min: 1, unit: '元' },
        { k: 'early_price', label: '早鸟价', type: 'money', store: 'col', min: 1, unit: '元', help: '须低于成人价；留空=无早鸟' },
        { k: 'early_days', label: '早鸟提前天数', type: 'int', store: 'col', min: 1, max: 365, unit: '天' },
      ] },
      { title: '出行安排', fields: [
        { k: 'gather_time', label: '集合时间', type: 'time' },
        { k: 'end_time', label: '预计结束', type: 'time' },
        { k: 'leader_name', label: '领队/导游', type: 'text', max: 20 },
        { k: 'leader_phone', label: '领队电话', type: 'phone' },
        { k: 'vehicle', label: '车辆/交通安排', type: 'text', max: 60, span: 2 },
        { k: 'note', label: '游客可见备注', type: 'textarea', max: 300, span: 2 },
        { k: 'internal_note', label: '内部备注', type: 'textarea', max: 500, span: 2, help: '仅后台可见' },
      ] },
    ],
    async validate(v, ctx) {
      if (v.early_price != null && v.price_adult != null && v.early_price >= v.price_adult) return { early_price: '早鸟价须低于成人价' }
      if (ctx.creating && v.depart_date && v.depart_date < bizDay()) return { depart_date: '出发日期不可早于今天' }
      if (!ctx.creating && v.quota != null && ctx.row && v.quota < Number(ctx.row.booked)) return { quota: `已报名 ${ctx.row.booked} 人，名额不能少于已报名人数` }
    },
    async create(c, v, ctx) {
      if (!(await one('SELECT id FROM tour_product WHERE id = ?', [ctx.parentId]))) throw new BizError(1004, '商品不存在')
      return c.ins('INSERT INTO tour_session (product_id, depart_date, quota, min_go, price_adult, status) VALUES (?,?,?,?,?,1)',
        [ctx.parentId, v.depart_date, v.quota, v.min_go || 10, v.price_adult])
    },
  },

  // ======================= 商户 =======================
  merchant: {
    label: '商户', table: 'merchant', idCol: 'id', roles: ['super', 'ops'], createRoles: ['super'], auditModule: 'merchant',
    titleKey: 'name',
    sections: [
      { title: '品牌与门店', fields: [
        { k: 'name', label: '商户名称', type: 'text', store: 'col', required: true, max: 64, span: 2 },
        { k: 'short_name', label: '简称', type: 'text', max: 20 },
        { k: 'kind', label: '经营类目', type: 'select', store: 'col', required: true, options: DICT.merchantKind },
        { k: 'city_code', label: '所在城市', type: 'select', store: 'col', required: true, options: DICT.city },
        { k: 'tags', label: '标签', type: 'tags', max: 8 },
        { k: 'logo', label: 'Logo', type: 'image', help: '1:1，用于商户端与订单展示' },
        { k: 'storefront', label: '门店照片', type: 'gallery', max: 9, span: 2 },
        { k: 'intro', label: '商户介绍', type: 'rich', span: 2 },
      ] },
      { title: '营业信息', fields: [
        { k: 'address', label: '详细地址', type: 'text', max: 120, span: 2 },
        { k: 'geo', label: '门店坐标', type: 'geo' },
        { k: 'service_phone', label: '客服电话', type: 'phone' },
        { k: 'business_hours', label: '营业时间', type: 'repeat', span: 2, max: 7, of: [
          { k: 'days', label: '适用', type: 'text', max: 20, ph: '周一至周五' },
          { k: 'open', label: '开门', type: 'time', required: true },
          { k: 'close', label: '打烊', type: 'time', required: true },
        ] },
        { k: 'capacity', label: '单场接待上限', type: 'int', min: 0, max: 100000, unit: '人' },
        { k: 'facilities', label: '设施服务', type: 'multi', options: [['parking', '停车场'], ['wifi', 'Wi-Fi'], ['accessible', '无障碍'], ['nursing', '母婴室'], ['locker', '寄存'], ['charging', '充电'], ['pet', '可携宠']] },
      ] },
      { title: '资质证照', fields: [
        { k: 'biz_license', label: '统一社会信用代码', type: 'text', store: 'col', max: 18, pattern: '^[0-9A-HJ-NPQRTUWXY]{18}$', patternMsg: '应为 18 位统一社会信用代码' },
        { k: 'legal_person', label: '法定代表人', type: 'text', max: 20 },
        { k: 'license_img', label: '营业执照', type: 'image' },
        { k: 'permits', label: '其他许可', type: 'repeat', span: 2, max: 10, of: [
          { k: 'name', label: '许可名称', type: 'text', required: true, max: 30, ph: '食品经营许可证' },
          { k: 'no', label: '编号', type: 'text', max: 40 },
          { k: 'expire', label: '有效期至', type: 'date' },
          { k: 'image', label: '扫描件', type: 'image' },
        ] },
      ] },
      { title: '结算账户', desc: '结算回单登记时核对使用', fields: [
        { k: 'wxpay_sub_mchid', label: '收付通子商户号', type: 'text', store: 'col', max: 32 },
        { k: 'settle_cycle', label: '结算周期', type: 'select', options: [['weekly', '周结'], ['monthly', '月结']] },
        { k: 'account_name', label: '开户名', type: 'text', max: 60 },
        { k: 'bank_name', label: '开户行', type: 'text', max: 60 },
        { k: 'account_no', label: '银行账号', type: 'text', max: 32, pattern: '^[0-9 ]{8,32}$', patternMsg: '只能包含数字', sensitive: true },
        { k: 'invoice_title', label: '发票抬头', type: 'text', max: 60 },
      ] },
      { title: '联系人与合作', fields: [
        { k: 'contacts', label: '联系人', type: 'repeat', span: 2, max: 6, of: [
          { k: 'name', label: '姓名', type: 'text', required: true, max: 20 },
          { k: 'role', label: '职务', type: 'text', max: 20, ph: '店长/财务' },
          { k: 'phone', label: '手机', type: 'phone' },
          { k: 'email', label: '邮箱', type: 'email' },
        ] },
        { k: 'contract_no', label: '合同编号', type: 'text', max: 40 },
        { k: 'contract_end', label: '合同到期', type: 'date' },
        { k: 'bd_owner', label: '商务负责人', type: 'text', max: 20 },
        { k: 'remark', label: '内部备注', type: 'textarea', max: 1000, span: 2 },
      ] },
    ],
    async create(c, v) {
      const mno = 'M' + bizDay().replaceAll('-', '') + String(Math.floor(Math.random() * 900) + 100)
      return c.ins('INSERT INTO merchant (city_code, name, kind, merchant_no, status) VALUES (?,?,?,?,0)', [v.city_code, v.name, v.kind, mno])
    },
  },

  // ======================= 景区 =======================
  scenic: {
    label: '景区', table: 'scenic_spot', idCol: 'id', roles: ['super', 'ops'], createRoles: ['super'], auditModule: 'scenic',
    titleKey: 'name',
    sections: [
      { title: '基本信息', fields: [
        { k: 'name', label: '景区名称', type: 'text', store: 'col', required: true, max: 40, span: 2 },
        { k: 'alias', label: '别名', type: 'tags', max: 5 },
        { k: 'city_code', label: '所在城市', type: 'select', store: 'col', required: true, options: DICT.city },
        { k: 'scenic_level', label: '景区等级', type: 'select', store: 'col', options: [['5A', '5A'], ['4A', '4A'], ['3A', '3A'], ['非A', '非A']] },
        { k: 'status', label: '合作状态', type: 'select', store: 'col', options: [['1', '合作中'], ['0', '已停用']], dflt: '1' },
        { k: 'cover', label: '封面', type: 'image' },
        { k: 'gallery', label: '景区图集', type: 'gallery', max: 9, span: 2 },
        { k: 'intro', label: '景区介绍', type: 'rich', span: 2 },
      ] },
      { title: '开放与票务', fields: [
        { k: 'address', label: '地址', type: 'text', max: 120, span: 2 },
        { k: 'geo', label: '坐标', type: 'geo' },
        { k: 'open_hours', label: '开放时间', type: 'text', max: 60, ph: '08:30-17:00（16:30 停止入园）' },
        { k: 'tickets', label: '票种价格', type: 'repeat', span: 2, max: 12, of: [
          { k: 'name', label: '票种', type: 'text', required: true, max: 20, ph: '成人票' },
          { k: 'price', label: '门市价', type: 'money', unit: '元' },
          { k: 'settle', label: '结算价', type: 'money', unit: '元' },
          { k: 'note', label: '适用说明', type: 'text', max: 40 },
        ] },
        { k: 'ticket_interface', label: '票务对接方式', type: 'text', store: 'col', max: 60, ph: '二维码核销直连' },
        { k: 'traffic', label: '交通指引', type: 'textarea', max: 500, span: 2 },
      ] },
      { title: '合作条款', fields: [
        { k: 'coop_mode', label: '合作模式', type: 'select', store: 'col', options: [['票务分成', '票务分成'], ['联合运营', '联合运营'], ['引流合作', '引流合作']] },
        { k: 'profit_terms', label: '分成条款摘要', type: 'text', store: 'col', max: 120, span: 2 },
        { k: 'contract_end', label: '合同到期', type: 'date' },
        { k: 'contract_file', label: '合同扫描件', type: 'image' },
        { k: 'contact_name', label: '对接人', type: 'text', store: 'col', max: 20 },
        { k: 'contact_phone', label: '对接电话', type: 'phone', store: 'col' },
        { k: 'remark', label: '内部备注', type: 'textarea', max: 1000, span: 2 },
      ] },
    ],
    async create(c, v) {
      return c.ins('INSERT INTO scenic_spot (city_code, name, scenic_level, coop_mode, status) VALUES (?,?,?,?,1)', [v.city_code, v.name, v.scenic_level || '', v.coop_mode || ''])
    },
  },

  // ======================= 供应商 =======================
  supplier: {
    label: '供应商', table: 'supplier', idCol: 'id', roles: ['super', 'ops'], createRoles: ['super'], auditModule: 'supplier',
    titleKey: 'name',
    sections: [
      { title: '基本信息', fields: [
        { k: 'name', label: '供应商名称', type: 'text', store: 'col', required: true, max: 60, span: 2 },
        { k: 'category', label: '资源类目', type: 'select', store: 'col', required: true, options: DICT.supplierCat },
        { k: 'city_code', label: '所在城市', type: 'select', store: 'col', required: true, options: DICT.city },
        { k: 'service_area', label: '服务区域', type: 'tags', max: 10, help: '如：青浦 / 嘉善 / 吴江' },
        { k: 'rating', label: '合作评级', type: 'select', options: [['A', 'A 优选'], ['B', 'B 合格'], ['C', 'C 观察']] },
        { k: 'status', label: '状态', type: 'select', store: 'col', options: [['1', '合作中'], ['0', '已停用']], dflt: '1' },
        { k: 'logo', label: 'Logo', type: 'image' },
        { k: 'intro', label: '供应商介绍', type: 'rich', span: 2 },
      ] },
      { title: '资质与结算', fields: [
        { k: 'license_no', label: '统一社会信用代码', type: 'text', store: 'col', max: 18, pattern: '^[0-9A-HJ-NPQRTUWXY]{18}$', patternMsg: '应为 18 位统一社会信用代码' },
        { k: 'license_img', label: '营业执照', type: 'image' },
        { k: 'settle_mode', label: '结算方式', type: 'select', store: 'col', options: DICT.settleMode, dflt: 'monthly' },
        { k: 'credit_days', label: '账期', type: 'int', min: 0, max: 180, unit: '天' },
        { k: 'account_name', label: '开户名', type: 'text', max: 60 },
        { k: 'bank_name', label: '开户行', type: 'text', max: 60 },
        { k: 'account_no', label: '银行账号', type: 'text', max: 32, pattern: '^[0-9 ]{8,32}$', patternMsg: '只能包含数字', sensitive: true },
        { k: 'contract_end', label: '合同到期', type: 'date' },
      ] },
      { title: '联系人', fields: [
        { k: 'contact_name', label: '主联系人', type: 'text', store: 'col', max: 20 },
        { k: 'contact_phone', label: '主联系电话', type: 'phone', store: 'col' },
        { k: 'contacts', label: '其他联系人', type: 'repeat', span: 2, max: 6, of: [
          { k: 'name', label: '姓名', type: 'text', required: true, max: 20 },
          { k: 'role', label: '职责', type: 'text', max: 20, ph: '调度/财务' },
          { k: 'phone', label: '电话', type: 'phone' },
        ] },
        { k: 'note', label: '备注', type: 'textarea', store: 'col', max: 1000, span: 2 },
      ] },
    ],
    async create(c, v) {
      return c.ins('INSERT INTO supplier (city_code, name, category, settle_mode, status) VALUES (?,?,?,?,1)', [v.city_code, v.name, v.category, v.settle_mode || 'monthly'])
    },
  },

  // ======================= 常见问题 =======================
  faq: {
    label: '常见问题', table: 'faq', idCol: 'id', roles: ['super', 'ops'], auditModule: 'faq', titleKey: 'question',
    sections: [
      { title: '问答内容', fields: [
        { k: 'question', label: '问题', type: 'text', store: 'col', required: true, max: 120, span: 2 },
        { k: 'answer', label: '答案', type: 'rich', store: 'col', required: true, span: 2, help: '支持加粗、列表、链接与图片' },
        { k: 'keywords', label: '同义问法/关键词', type: 'tags', max: 10, help: '用于搜索命中，如：退票、取消订单' },
      ] },
      { title: '展示设置', fields: [
        { k: 'category', label: '分类', type: 'select', store: 'col', required: true, options: [['预订', '预订'], ['出行', '出行'], ['旅豆', '旅豆'], ['退款', '退款'], ['会员', '会员'], ['通用', '通用'], ['其他', '其他']], dflt: '通用' },
        { k: 'is_hot', label: '热门问题', type: 'switch', store: 'col' },
        { k: 'sort', label: '排序', type: 'int', store: 'col', min: 0, max: 9999, help: '越小越靠前' },
        { k: 'status', label: '状态', type: 'select', store: 'col', options: [['1', '展示'], ['0', '隐藏']], dflt: '1' },
        { k: 'related_products', label: '关联线路', type: 'ref', ref: 'product', multiple: true, span: 2, help: '在这些线路详情页底部同时展示' },
      ] },
    ],
    async create(c, v) { return c.ins('INSERT INTO faq (question, answer) VALUES (?, ?)', [v.question, v.answer]) },
  },

  // ======================= 轮播 =======================
  banner: {
    label: '轮播', table: 'banner', idCol: 'id', roles: ['super', 'ops'], auditModule: 'banner', titleKey: 'title',
    sections: [
      { title: '素材', fields: [
        { k: 'title', label: '标题', type: 'text', store: 'col', required: true, max: 40 },
        { k: 'sub_title', label: '副标题/角标', type: 'text', store: 'col', max: 60 },
        { k: 'image', label: '轮播图', type: 'image', store: 'col', required: true, span: 2, help: '750×300，2MB 以内' },
        { k: 'bg_color', label: '背景主色', type: 'color', help: '图片加载前的占位色' },
      ] },
      { title: '跳转', fields: [
        { k: 'link_type', label: '跳转类型', type: 'select', options: [['none', '不跳转'], ['product', '线路详情'], ['page', '小程序页面']], dflt: 'none' },
        { k: 'link_product', label: '目标线路', type: 'ref', ref: 'product', showIf: ['link_type', 'product'] },
        { k: 'link', label: '页面路径', type: 'text', store: 'col', max: 200, showIf: ['link_type', 'page'], pattern: '^/(pages|package-[a-z]+)/', patternMsg: '应为小程序页面路径，如 /pages/faq/index' },
      ] },
      { title: '投放', fields: [
        { k: 'start_at', label: '开始时间', type: 'datetime', store: 'col' },
        { k: 'end_at', label: '结束时间', type: 'datetime', store: 'col' },
        { k: 'cities', label: '投放城市', type: 'multi', options: DICT.city, help: '留空=全部城市' },
        { k: 'sort', label: '排序', type: 'int', store: 'col', min: 0, max: 9999 },
        { k: 'status', label: '状态', type: 'select', store: 'col', options: [['1', '上线'], ['0', '下线']], dflt: '1' },
        { k: 'track_code', label: '投放追踪码', type: 'text', max: 32 },
      ] },
    ],
    // 选择"线路详情"时由服务端生成路径，后台不用手写
    beforeSave(v) {
      if (v.link_type === 'product' && v.link_product) v.link = '/package-tour/pages/detail/index?id=' + v.link_product
      if (v.link_type === 'none') v.link = null
    },
    async validate(v) {
      if (v.start_at && v.end_at && v.start_at > v.end_at) return { end_at: '结束时间不能早于开始时间' }
      if (v.link_type === 'product' && !v.link_product) return { link_product: '请选择目标线路' }
    },
    async create(c, v) { return c.ins('INSERT INTO banner (title, image) VALUES (?, ?)', [v.title, v.image]) },
  },

  // ======================= 勋章 =======================
  badge: {
    label: '勋章', table: 'badge', idCol: 'id', roles: ['super', 'ops'], auditModule: 'badge', titleKey: 'name',
    sections: [
      { title: '外观', fields: [
        { k: 'name', label: '勋章名称', type: 'text', store: 'col', required: true, max: 20 },
        { k: 'icon_key', label: '图标键', type: 'text', store: 'col', required: true, max: 32, pattern: '^[a-z0-9_-]+$', patternMsg: '小写字母、数字、下划线', help: '小程序内置图标的键名' },
        { k: 'icon_img', label: '勋章图', type: 'image', help: '透明底 PNG，256×256' },
        { k: 'rarity', label: '稀有度', type: 'select', options: [['common', '普通'], ['rare', '稀有'], ['epic', '史诗'], ['legend', '传说']], dflt: 'common' },
        { k: 'color', label: '主题色', type: 'color' },
        { k: 'description', label: '勋章故事', type: 'rich', span: 2 },
      ] },
      { title: '获得规则', fields: [
        { k: 'rule_type', label: '规则类型', type: 'select', store: 'col', options: [['manual', '人工授予'], ['order_count', '完成订单数'], ['city_count', '打卡城市数'], ['review', '发表评价']], dflt: 'manual' },
        { k: 'rule_desc', label: '规则说明（游客可见）', type: 'text', store: 'col', max: 120, span: 2 },
        { k: 'threshold', label: '达成阈值', type: 'int', min: 1, max: 10000, help: '自动规则使用' },
        { k: 'max_issue', label: '发行上限', type: 'int', min: 0, max: 10000000, help: '0=不限' },
        { k: 'valid_days', label: '有效期', type: 'int', min: 0, max: 3650, unit: '天', help: '0=永久' },
        { k: 'display_order', label: '展示顺序', type: 'int', min: 0, max: 9999 },
      ] },
    ],
    async create(c, v) { return c.ins('INSERT INTO badge (name, icon_key, rule_desc, rule_type) VALUES (?,?,?,?)', [v.name, v.icon_key, v.rule_desc || '', v.rule_type || 'manual']) },
  },

  // ======================= 推广服务商 =======================
  promoter: {
    label: '推广服务商', table: 'promoter', idCol: 'user_id', roles: ['super', 'ops'], auditModule: 'promoter', titleKey: 'real_name', noCreate: true,
    sections: [
      { title: '身份与渠道', fields: [
        { k: 'real_name', label: '姓名/机构名', type: 'text', required: true, max: 40 },
        { k: 'mobile', label: '联系手机', type: 'phone', required: true },
        { k: 'channel_type', label: '渠道类型', type: 'select', options: [['guide', '导游/领队'], ['kol', '达人/博主'], ['agency', '旅行社'], ['community', '社群团长'], ['corp', '企业客户'], ['other', '其他']] },
        { k: 'org_name', label: '所属机构', type: 'text', max: 60 },
        { k: 'city_code', label: '所在城市', type: 'select', options: DICT.city },
        { k: 'social', label: '主要阵地', type: 'repeat', span: 2, max: 6, of: [
          { k: 'platform', label: '平台', type: 'text', required: true, max: 20, ph: '小红书' },
          { k: 'account', label: '账号', type: 'text', max: 40 },
          { k: 'fans', label: '粉丝数', type: 'int', min: 0 },
        ] },
      ] },
      { title: '合作与佣金', fields: [
        { k: 'tier', label: '佣金档位', type: 'select', store: 'col', required: true, options: [['1', '基础档'], ['2', '优选档'], ['3', '金牌档']], help: '费率按参数中心 promoter.rate_bp 自动同步' },
        { k: 'status', label: '资格状态', type: 'select', store: 'col', options: [['1', '有效'], ['0', '暂停']] },
        { k: 'contract_ref', label: '协议编号', type: 'text', store: 'col', max: 40 },
        { k: 'contract_end', label: '协议到期', type: 'date' },
        { k: 'payout_method', label: '收款方式', type: 'select', options: [['wechat', '微信零钱'], ['bank', '银行卡']] },
        { k: 'payout_account', label: '收款账号', type: 'text', max: 40, sensitive: true },
        { k: 'remark', label: '内部备注', type: 'textarea', max: 1000, span: 2 },
      ] },
    ],
    // 档位变更时同步费率：费率来自参数中心，不允许在这里手填
    async afterSave(c, v, ctx) {
      if (ctx.changed.includes('tier')) {
        const rates = await cfgArr('promoter.rate_bp')
        const t = Math.max(1, Math.min(Number(v.tier), rates.length))
        await c.q('UPDATE promoter SET rate_bp = ? WHERE user_id = ?', [rates[t - 1], ctx.id])
      }
    },
  },
}

/* ---------------- 工具 ---------------- */
const allFields = (sc) => sc.sections.flatMap((s) => s.fields)
const storeOf = (f) => f.store || 'profile'
const isEmpty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)
const parseJson = (v, d) => { if (v == null) return d; if (typeof v !== 'string') return v; try { return JSON.parse(v) } catch { return d } }
const URL_RE = /^(https?:\/\/[^\s"'<>]+|\/uploads\/[\w.-]+)$/

export function get(kind) {
  const sc = S[kind]
  if (!sc) throw new BizError(1004, '未知实体：' + kind)
  return sc
}
export const kinds = () => Object.keys(S)

/** 下发给前端的 schema（去掉服务端钩子；ref 选项由路由层填充） */
export function publicSchema(kind) {
  const sc = get(kind)
  return { kind, label: sc.label, titleKey: sc.titleKey, noCreate: !!sc.noCreate, parent: sc.parent || null,
    sections: sc.sections.map((s) => ({ title: s.title, desc: s.desc || '', fields: s.fields.map(strip) })) }
}
function strip(f) {
  const { store, ...rest } = f
  return { ...rest, of: f.of ? f.of.map(strip) : undefined, isCol: storeOf(f) === 'col' }
}

/** 单字段规范化：返回 [值, 错误] */
function normalize(f, raw) {
  if (raw === undefined) return [undefined, null]
  let v = raw
  const t = f.type
  if (t === 'rich') {
    v = sanitizeRich(v, 100000)
    if (f.required && !richTextLength(v) && !/<img/i.test(v)) return [v, '不能为空']
    return [v || null, null]
  }
  if (['text', 'textarea', 'phone', 'email', 'url', 'color', 'date', 'datetime', 'time', 'image'].includes(t)) {
    v = v == null ? '' : String(v).trim()
    if (!v) return [null, f.required ? '不能为空' : null]
    if (f.max && v.length > f.max) return [v, `不能超过 ${f.max} 个字`]
    if (t === 'phone' && !/^(1[3-9]\d{9}|0\d{2,3}-?\d{7,8}|400-?\d{3}-?\d{4})$/.test(v)) return [v, '请填写有效的手机或座机号']
    if (t === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return [v, '邮箱格式不正确']
    if (t === 'url' && !/^https?:\/\//.test(v)) return [v, '应以 http:// 或 https:// 开头']
    if (t === 'color' && !/^#[0-9a-fA-F]{6}$/.test(v)) return [v, '颜色格式应为 #RRGGBB']
    if (t === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return [v, '日期格式应为 YYYY-MM-DD']
    if (t === 'datetime') { v = v.replace('T', ' ').slice(0, 16); if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(v)) return [v, '时间格式不正确']; v += ':00' }
    if (t === 'time' && !/^\d{2}:\d{2}$/.test(v)) return [v, '时间格式应为 HH:MM']
    if (t === 'image' && !URL_RE.test(v)) return [v, '图片地址无效，请重新上传']
    if (f.pattern && !new RegExp(f.pattern).test(v)) return [v, f.patternMsg || '格式不正确']
    return [v, null]
  }
  if (['int', 'number', 'money'].includes(t)) {
    if (v === '' || v == null) return [null, f.required ? '不能为空' : null]
    const n = Number(v)
    if (!Number.isFinite(n)) return [v, '请输入数字']
    const val = t === 'money' ? Math.round(n * 100) : (t === 'int' ? Math.trunc(n) : n)
    const disp = t === 'money' ? n : val
    if (t === 'int' && !Number.isInteger(n)) return [v, '请输入整数']
    if (f.min != null && disp < f.min) return [v, `不能小于 ${f.min}`]
    if (f.max != null && disp > f.max) return [v, `不能大于 ${f.max}`]
    return [val, null]
  }
  if (t === 'switch') return [v === true || v === 1 || v === '1' ? 1 : 0, null]
  if (t === 'select') {
    if (v === '' || v == null) return [null, f.required ? '请选择' : null]
    if (!f.options.some(([o]) => String(o) === String(v))) return [v, '选项无效']
    return [String(v), null]
  }
  if (t === 'multi') {
    const arr = Array.isArray(v) ? v.map(String) : []
    if (arr.some((x) => !f.options.some(([o]) => String(o) === x))) return [arr, '包含无效选项']
    return [arr.length ? arr : null, f.required && !arr.length ? '至少选择一项' : null]
  }
  if (t === 'tags' || t === 'lines') {
    const arr = (Array.isArray(v) ? v : String(v || '').split('\n')).map((s) => String(s).trim()).filter(Boolean)
    if (f.max && arr.length > f.max) return [arr, `最多 ${f.max} 条`]
    if (arr.some((s) => s.length > 200)) return [arr, '单条不能超过 200 字']
    return [arr.length ? [...new Set(arr)] : null, f.required && !arr.length ? '不能为空' : null]
  }
  if (t === 'gallery') {
    const arr = (Array.isArray(v) ? v : []).map((s) => String(s).trim()).filter(Boolean)
    if (arr.some((u) => !URL_RE.test(u))) return [arr, '包含无效图片地址']
    if (f.max && arr.length > f.max) return [arr, `最多 ${f.max} 张`]
    return [arr.length ? arr : (storeOf(f) === 'col' ? [] : null), f.required && !arr.length ? '至少上传一张' : null]
  }
  if (t === 'geo') {
    if (v == null || v === '') return [null, null]
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,，]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(String(v))
    if (!m || Math.abs(+m[1]) > 90 || Math.abs(+m[2]) > 180) return [v, '格式应为 纬度,经度，如 31.11,121.05']
    return [`${(+m[1]).toFixed(6)},${(+m[2]).toFixed(6)}`, null]
  }
  if (t === 'ref') {
    if (f.multiple) {
      const arr = (Array.isArray(v) ? v : []).map(Number).filter((x) => Number.isInteger(x) && x > 0)
      return [arr.length ? [...new Set(arr)] : null, null]
    }
    if (v === '' || v == null) return [null, f.required ? '请选择' : null]
    const n = Number(v)
    return Number.isInteger(n) && n > 0 ? [n, null] : [v, '选项无效']
  }
  if (t === 'repeat') {
    const rows = Array.isArray(v) ? v : []
    if (f.max && rows.length > f.max) return [rows, `最多 ${f.max} 行`]
    const out = []
    for (let i = 0; i < rows.length; i++) {
      const r = {}
      let empty = true
      for (const sf of f.of) {
        const [nv, err] = normalize(sf, rows[i]?.[sf.k])
        if (err && !(err === '不能为空' || err === '请选择')) return [rows, `第 ${i + 1} 行「${sf.label}」${err}`]
        if (!isEmpty(nv)) { r[sf.k] = nv; empty = false }
      }
      if (empty) continue
      const miss = f.of.find((sf) => sf.required && isEmpty(r[sf.k]))
      if (miss) return [rows, `第 ${i + 1} 行「${miss.label}」不能为空`]
      out.push(r)
    }
    return [out.length ? out : null, f.required && !out.length ? '至少填写一行' : null]
  }
  return [v, null]
}

/** 从数据库行读出表单值（金额转元） */
export function readValues(kind, row) {
  const sc = get(kind)
  const profile = parseJson(row.profile, {}) || {}
  const out = {}
  for (const f of allFields(sc)) {
    const st = storeOf(f)
    let v = st === 'col' ? row[f.k] : (st === 'profile' ? profile[f.k] : (parseJson(row[st.json], {}) || {})[st.key])
    if (f.type === 'gallery' && st === 'col') v = parseJson(v, [])
    if (f.type === 'money' && v != null) v = Number(v) / 100
    if (f.type === 'datetime' && v) v = String(v).slice(0, 16)
    if (f.type === 'date' && v) v = String(v).slice(0, 10)
    if (f.type === 'select' && v != null) v = String(v)
    if (f.type === 'repeat' && Array.isArray(v)) v = v.map((r) => Object.fromEntries(Object.entries(r).map(([k, x]) => [k, (f.of.find((s) => s.k === k)?.type === 'money' && x != null) ? Number(x) / 100 : x])))
    out[f.k] = v ?? null
  }
  return out
}

/** 完整度：非空字段 / 全部字段（开关不计） */
export function completeness(kind, values) {
  const fs = allFields(get(kind)).filter((f) => f.type !== 'switch')
  const filled = fs.filter((f) => !isEmpty(values[f.k])).length
  return Math.round((filled / fs.length) * 100)
}

const brief = (v) => {
  if (v == null) return null
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > 80 ? s.slice(0, 80) + '…' : s
}

/**
 * 保存（新建或更新）
 * @param ctx {admin, id?, parentId?, audit(c, ...)}
 */
export async function save(kind, input, ctx, tx) {
  const sc = get(kind)
  const creating = !ctx.id
  if (creating && sc.noCreate) throw new BizError(1003, `${sc.label}不支持在此新建`)
  const roles = creating ? (sc.createRoles || sc.roles) : sc.roles
  if (ctx.admin.role !== 'super' && !roles.includes(ctx.admin.role)) throw new BizError(1003, '当前账号没有权限')

  const row = creating ? null : await one(`SELECT * FROM ${sc.table} WHERE ${sc.idCol} = ?`, [ctx.id])
  if (!creating && !row) throw new BizError(1004, `${sc.label}不存在`)
  const before = row ? readValues(kind, row) : {}

  // 1) 逐字段规范化；新建时缺省值生效
  const vals = {}
  const errors = {}
  for (const f of allFields(sc)) {
    let raw = input[f.k]
    if (creating && (raw === undefined || raw === '') && f.dflt !== undefined) raw = f.dflt
    if (raw === undefined && !creating) continue
    const [v, err] = normalize(f, raw === undefined ? null : raw)
    if (err) errors[f.k] = err
    vals[f.k] = v
  }
  if (sc.beforeSave) sc.beforeSave(vals)
  // showIf 隐藏的字段不校验
  for (const f of allFields(sc)) if (f.showIf && vals[f.showIf[0]] !== undefined && String(vals[f.showIf[0]] ?? '') !== f.showIf[1]) delete errors[f.k]
  if (sc.validate) Object.assign(errors, (await sc.validate({ ...before, ...vals }, { creating, row, id: ctx.id })) || {})
  if (Object.keys(errors).length) {
    const first = Object.entries(errors)[0]
    const lab = allFields(sc).find((f) => f.k === first[0])?.label || first[0]
    const e = new BizError(1001, `「${lab}」${first[1]}`)
    e.data = { fieldErrors: errors }
    throw e
  }

  // 2) 计算变化，按存储位置分组
  const changed = Object.keys(vals).filter((k) => JSON.stringify(vals[k] ?? null) !== JSON.stringify(creating ? null : toStore(allFields(sc).find((f) => f.k === k), before[k])))
  const cols = {}, jsonCols = {}, profile = {}
  for (const k of changed) {
    const f = allFields(sc).find((x) => x.k === k)
    const st = storeOf(f)
    if (st === 'col') cols[k] = f.type === 'gallery' ? JSON.stringify(vals[k] || []) : vals[k]
    else if (st === 'profile') profile[k] = vals[k]
    else (jsonCols[st.json] ||= {})[st.key] = vals[k]
  }

  return await tx(async (c) => {
    let id = ctx.id
    if (creating) id = await sc.create(c, vals, { parentId: ctx.parentId })
    const cur = await c.one(`SELECT * FROM ${sc.table} WHERE ${sc.idCol} = ? FOR UPDATE`, [id])
    const sets = [], args = []
    for (const [k, v] of Object.entries(cols)) { sets.push(`\`${k}\` = ?`); args.push(v) }
    for (const [col, kv] of Object.entries(jsonCols)) { sets.push(`\`${col}\` = ?`); args.push(JSON.stringify({ ...(parseJson(cur[col], {}) || {}), ...kv })) }
    if (Object.keys(profile).length) {
      const merged = { ...(parseJson(cur.profile, {}) || {}), ...profile }
      for (const k of Object.keys(merged)) if (merged[k] == null) delete merged[k]
      sets.push('profile = ?'); args.push(JSON.stringify(merged))
    }
    if (sets.length) await c.upd(`UPDATE ${sc.table} SET ${sets.join(', ')} WHERE ${sc.idCol} = ?`, [...args, id])
    if (sc.afterSave) await sc.afterSave(c, { ...before, ...vals }, { id, changed, creating })
    // 审计只记变化的字段；敏感字段打码
    const mask = (k, v) => allFields(sc).find((f) => f.k === k)?.sensitive && v ? '***' + String(v).slice(-4) : brief(v)
    if (changed.length) {
      await ctx.audit(c, sc.auditModule, creating ? 'create' : 'update', `${kind}-${id}`,
        creating ? null : Object.fromEntries(changed.map((k) => [k, mask(k, before[k])])),
        Object.fromEntries(changed.map((k) => [k, mask(k, vals[k])])))
    }
    return { id, changed }
  })
}

// readValues 出来的是展示值（元），比较变化前要转回存储值
function toStore(f, v) {
  if (v == null) return null
  if (f.type === 'money') return Math.round(Number(v) * 100)
  if (f.type === 'datetime') return String(v).replace('T', ' ').slice(0, 16) + ':00'
  if (f.type === 'repeat' && Array.isArray(v)) return v.map((r) => Object.fromEntries(Object.entries(r).map(([k, x]) => [k, f.of.find((s) => s.k === k)?.type === 'money' && x != null ? Math.round(Number(x) * 100) : x])))
  return v
}

/** ref 字段的候选项 */
export async function refOptions(ref, admin) {
  if (ref === 'merchant') return (await q('SELECT id, name, status FROM merchant ORDER BY status DESC, id')).map((r) => [String(r.id), r.name + (Number(r.status) === 1 ? '' : '（未审核）')])
  if (ref === 'supplier') return (await q('SELECT id, name FROM supplier WHERE status = 1 ORDER BY id')).map((r) => [String(r.id), r.name])
  if (ref === 'scenic') return (await q('SELECT id, name FROM scenic_spot WHERE status = 1 ORDER BY id')).map((r) => [String(r.id), r.name])
  if (ref === 'product') return (await q('SELECT id, title FROM tour_product ORDER BY id DESC LIMIT 500')).map((r) => [String(r.id), r.title])
  return []
}
