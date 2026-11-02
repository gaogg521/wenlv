// 位置与联系方式：后台录入的坐标为腾讯地图取点（GCJ-02），可直接用于 wx.openLocation
function openGeo(geo, name, address) {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(String(geo || ''))
  if (!m) return wx.showToast({ title: '暂未提供导航坐标', icon: 'none' })
  wx.openLocation({ latitude: Number(m[1]), longitude: Number(m[2]), name: name || '', address: address || '', scale: 16 })
}
function call(phone) {
  if (!phone) return wx.showToast({ title: '暂未提供联系电话', icon: 'none' })
  wx.makePhoneCall({ phoneNumber: String(phone).replace(/[^\d-]/g, ''), fail: () => {} })
}
const FACILITY = { parking: '停车场', wifi: 'Wi-Fi', accessible: '无障碍', nursing: '母婴室', locker: '寄存', charging: '充电', pet: '可携宠' }
module.exports = { openGeo, call, FACILITY }
