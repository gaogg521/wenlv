// 复用项目自有原型插画，不将示意插画冒充商品实拍。
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { Resvg } from '@resvg/resvg-js'
const root = path.resolve(import.meta.dirname, '../..')
const input = path.join(root, '向往的自由-DOME设计原型源码/src/p4b.html')
const source = fs.readFileSync(input, 'utf8').replace(/<\/?script[^>]*>/g, '')
const sceneSVG = vm.runInNewContext(source + '\nsceneSVG', {}, { timeout: 5000 })
const output = path.join(root, 'mini-a/assets/scenes')
fs.mkdirSync(output, { recursive: true })
for (const kind of ['bamboo','redhall','garden','camp','lake','watertown','mountain','autumn','island','jinggang','city','tea','stage']) {
  const png = new Resvg(sceneSVG(kind, 137), { fitTo: { mode: 'width', value: 640 } }).render().asPng()
  fs.writeFileSync(path.join(output, kind + '.png'), png)
}
console.log('Rendered 13 prototype illustrations')
