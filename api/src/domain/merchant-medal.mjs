// 兼容已有材质预览参数，仅选图形配色，不使用写实图片或新增经营等级。
import { merchantEmblem } from './merchant-emblem.mjs'
export const MERCHANT_METALS=['bronze','silver','gold','diamond','blackgold']
export function merchantMedal(o={},owned=true) {
  const chosen=MERCHANT_METALS.indexOf(o.metal)
  return merchantEmblem({...o,category:'mlevel',tier:chosen<0?o.tier:chosen+1},owned)
}
