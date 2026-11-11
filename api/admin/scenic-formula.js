export const example = { orders: 3000, priceFen: 39900, revenueBp: 2000, variableBp: 900, equityBp: 200, fixedFen: 18000000 }
export const formulaVersion = 1
const denominator = 10000n
const ceil = (a, b) => (a + b - 1n) / b
const money = n => Number(n < 0n ? -((-n + 5000n) / denominator) : (n + 5000n) / denominator)

function integer(input, key, max) {
  const value = input?.[key]
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw new RangeError(key + ' 数值超出允许范围')
  return BigInt(value)
}

export function calculate(input) {
  const n = integer(input, 'orders', 10000000)
  const p = integer(input, 'priceFen', 100000000)
  const r = integer(input, 'revenueBp', 10000)
  const v = integer(input, 'variableBp', 10000)
  const e = integer(input, 'equityBp', 10000)
  const f = integer(input, 'fixedFen', 100000000000)
  const m = r - v - e
  const gmv = n * p
  const target = f * denominator
  const unit = p * m
  const net = gmv * m - target
  const revenue = money(gmv * r), variable = money(gmv * v), equity = money(gmv * e)
  const result = money(net)
  const breakEven = f === 0n ? 0n : unit > 0n ? ceil(target, unit) : null
  const path = (value, max, calculate) => {
    if (net >= 0n) return { status: 'satisfied' }
    if (value == null || value < 0n || value > max) return { status: 'unavailable' }
    const balance = calculate(value)
    return { status: 'available', value: Number(value), balanceFen: money(balance), exactNumerator: String(balance) }
  }
  // 招商示例按十元和百单取档，低位截到零，零中心去除重复轴。
  const axes = (center, step) => {
    const delta = ((center + step * 2n) / (step * 4n) || 1n) * step
    return [...new Set(center === 0n ? [0n] : [center > delta ? center - delta : 0n, center, center + delta])]
  }
  const prices = axes(p, 1000n)
  const orders = axes(n, 100n)
  return {
    inputs: Object.fromEntries(Object.keys(example).map(k => [k, input[k]])), formulaVersion,
    gmvFen: Number(gmv), revenueFen: revenue, variableFen: variable, equityFen: equity,
    fixedFen: Number(f), marginBp: Number(m), unitFen: money(unit), balanceFen: result,
    exactNumerator: String(net), status: net < 0n ? 'loss' : net === 0n ? 'even' : 'profit',
    roundingDifferenceFen: result - (revenue - variable - equity - Number(f)),
    breakEvenOrders: breakEven == null ? null : Number(breakEven),
    paths: {
      price: path(n * m > 0n ? ceil(target, n * m) : null, 100000000n, x => n * x * m - target),
      rate: path(gmv > 0n ? v + e + ceil(target, gmv) : null, 10000n, x => gmv * (x - v - e) - target),
      fixed: path(gmv * m >= 0n ? gmv * m / denominator : null, 100000000000n, x => gmv * m - x * denominator),
      orders: path(breakEven, 10000000n, x => x * unit - target),
    },
    sensitivity: prices.map(price => ({
      priceFen: Number(price), cells: orders.map(count => {
        const value = price * count * m - target
        return { orders: Number(count), balanceFen: money(value), status: value < 0n ? 'loss' : value === 0n ? 'even' : 'profit' }
      }),
    })),
  }
}
