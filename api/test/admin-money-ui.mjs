// 验证运营输入“元”到API整数“分”的边界，避免100倍误差和浮点损失。
import fs from 'node:fs'
import vm from 'node:vm'
import assert from 'node:assert/strict'
const fields={},sent=[]
const empty={budgets:[],templates:[],rights:[],batches:[],rows:[],payments:[],events:[],page:1,pageSize:20,total:0}
const ctx=vm.createContext({window:{},ME:{role:'super'},$:s=>fields[s]||{},esc:s=>String(s??''),fen:s=>String(s),closeModal(){},toast(){},api:async(m,p,b)=>{if(m==='POST')sent.push({p,b});return structuredClone(empty)}})
vm.runInContext(fs.readFileSync(new URL('../admin/pages/phase2.js',import.meta.url),'utf8'),ctx)
const input=(key,value)=>fields['#p2_'+key]={value:String(value)}
const evaluate=s=>vm.runInContext(s,ctx)
for(const [value,fen]of [['100',10000],['50',5000],['0.01',1],['0.29',29],['1.01',101],['199.99',19999],['100000000.00',10000000000]]){
 input('amount',value);assert.equal(evaluate("p2MoneyToFen('amount')"),fen)
}
for(const value of ['','0','-1','0.001','1e2','100000000.01','x']){input('amount',value);assert.throws(()=>evaluate("p2MoneyToFen('amount')"),/金额|按元/)}
assert.match(evaluate("p2MoneyField('amount','金额（元）',5001)"),/value="50.01"/)
for(const[k,v]of Object.entries({name:'单位测试',budget:1,threshold:'100.01',discount:'50.01',from:'2026-11-10T00:00',to:'2026-12-31T23:59',products:'1',cities:'',channels:'',dates:'',perUser:'1',daily:'1',reason:'单位换算验证'}))input(k,v)
await evaluate('freedomTemplateSave()');assert.equal(sent.at(-1).p,'/admin/freedom/templates');assert.equal(sent.at(-1).b.threshold,10001);assert.equal(sent.at(-1).b.discount,5001)
input('total','7.89');await evaluate('freedomBudgetSave()');assert.equal(sent.at(-1).b.total,789)
ctx.window.__p2FreedomPay={orderNo:'test-only',direction:-1};input('amount','0.29');input('ref','TEST-ONLY');evaluate("p2ReceiptUpload=async()=>'/receipts/test-only.pdf'")
await evaluate('freedomPaySave()');assert.equal(sent.at(-1).p,'/admin/freedom/pay');assert.equal(sent.at(-1).b.amount,29)
console.log('后台金额：元输入/编辑回显、100与50、最小分位、0.29精度、超限/非法输入、模板/预算/付款提交契约通过')
