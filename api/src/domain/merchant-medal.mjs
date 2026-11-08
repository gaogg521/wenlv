// 独立制作的金属授勋主图。材质仅影响外观，不新增经营等级、资格或门槛。
import fs from 'node:fs'
export const MERCHANT_METALS = ['bronze','silver','gold','diamond','blackgold']
const images=new Map()
export function merchantMedal(o={},owned=true) {
  const tier=Math.max(1,Math.min(5,Math.trunc(Number(o.tier)||1)))
  const metal=MERCHANT_METALS.includes(o.metal)?o.metal:MERCHANT_METALS[tier-1]
  if(!images.has(metal))images.set(metal,fs.readFileSync(new URL('../../assets/merchant-medals-20261108/'+metal+'.png',import.meta.url)).toString('base64'))
  const defs=owned?'':'<filter id="medal-unearned"><feColorMatrix type="saturate" values="0"/></filter>'
  const body=`<g data-merchant-emblem="certification" data-medal-material="${metal}" data-owned="${owned?'yes':'no'}"${owned?'':' filter="url(#medal-unearned)" opacity="0.28"'}><image x="8" y="8" width="240" height="240" href="data:image/png;base64,${images.get(metal)}"/></g>`
  return {defs,body}
}
