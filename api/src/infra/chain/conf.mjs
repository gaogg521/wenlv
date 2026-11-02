// 链配置读取：后台「链接入中心」保存的加密凭据优先，其次环境变量。
// 适配器统一写 E.XXX（替代 process.env.XXX），后台改完 15 秒内生效、保存时立即生效，无需重启。
import { secretSync } from '../secrets.mjs'
export const E = new Proxy({}, { get: (_, key) => (typeof key === 'string' ? (secretSync(key) || process.env[key] || undefined) : undefined) })
