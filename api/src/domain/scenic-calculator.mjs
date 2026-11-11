import { BizError } from '../db.mjs'
import { calculate as calculateScenario } from '../../admin/scenic-formula.js'

export { example, formulaVersion } from '../../admin/scenic-formula.js'

export function calculate(input) {
  try {
    return calculateScenario(input)
  } catch (error) {
    if (error instanceof RangeError) throw new BizError(1001, error.message)
    throw error
  }
}
