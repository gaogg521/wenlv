// 生产环境启动护栏（A-22，全量检查 20261106）
// 旧实现：auth.mjs / pass.mjs / secrets.mjs 在环境变量缺失时回退到代码里的固定字符串，
// index.mjs 只对 SECRETS_KEY 打一条警告 —— 生产漏配就能伪造任意令牌和核销码。
// 现在的行为：NODE_ENV=production 下缺失或使用公开默认值 → 拒绝启动（进程退出前抛错）。
// 非生产环境不拦（开发/演示保持零配置可跑）；演示环境的密钥配置不受影响。

const DEFAULT_JWT_SECRETS = new Set([
  'wanderlust-dev-jwt-secret-change-me',
  'dev',
])
const DEFAULT_PASS_SECRETS = new Set([
  'wanderlust-pass-code-secret',
  'dev',
])

export function assertProductionSecrets(env = process.env) {
  if (env.NODE_ENV !== 'production') return
  const missing = []
  const jwt = String(env.JWT_SECRET || '')
  if (!jwt) missing.push('JWT_SECRET')
  else if (DEFAULT_JWT_SECRETS.has(jwt)) throw new Error('生产环境不能使用公开默认 JWT_SECRET（可伪造任意令牌）。请换随机长密钥后重启')
  const pass = String(env.PASS_SECRET || '')
  if (!pass) missing.push('PASS_SECRET')
  else if (DEFAULT_PASS_SECRETS.has(pass)) throw new Error('生产环境不能使用公开默认 PASS_SECRET（可伪造核销码）。请换随机长密钥后重启')
  const sk = String(env.SECRETS_KEY || '')
  if (!sk) missing.push('SECRETS_KEY')
  else if (!/^[0-9a-fA-F]{64}$/.test(sk)) throw new Error('SECRETS_KEY 必须是 64 位十六进制（32 字节）。生成：node scripts/secrets-key.mjs new')
  if (missing.length) {
    throw new Error(`生产环境缺少必需密钥：${missing.join('、')}。启动拒绝。`
      + ' 生成方式：JWT_SECRET/PASS_SECRET 用随机长字符串；SECRETS_KEY 用 node scripts/secrets-key.mjs new（或用与服务相同 JWT_SECRET 运行 scripts/secrets-key.mjs current）')
  }
}
