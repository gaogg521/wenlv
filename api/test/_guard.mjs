// 破坏性测试守卫：清库类脚本只能指向隔离库。
// 规则：必须显式设置 DB_NAME，且不能是演示库 wanderlust（除非 ALLOW_DESTRUCTIVE=1 明确放行，例如 CI 的一次性容器）。
// 历史事故：README 记录过"部分历史测试会清空数据，只能对隔离库运行"——靠口头约定不可靠，这里改成代码闸门。
export const PROTECTED = ['wanderlust']

export function assertIsolatedDb(scriptName) {
  const db = process.env.DB_NAME
  if (process.env.ALLOW_DESTRUCTIVE === '1') return db || 'wanderlust'
  if (!db || PROTECTED.includes(db)) {
    console.error(`\n[拒绝运行] ${scriptName} 会清空/改写数据，只能对隔离库运行。
  当前 DB_NAME=${db || '(未设置，默认 wanderlust 演示库)'}
  用法：DB_NAME=wanderlust_qa node ${scriptName}
  一次性容器内可设 ALLOW_DESTRUCTIVE=1 放行。\n`)
    process.exit(2)
  }
  return db
}
