// 微信开发者工具 MCP 客户端（stdio JSON-RPC）：usage: node mcp-wx.mjs <command> [args-json]
// command: tools | call <toolName> <argsJson>
import { spawn } from 'node:child_process'

const TOKEN = 'ekuE8ra457fLz__xbHJdi0YBYVrCJn2d'
const proc = spawn('wechatide.cmd', ['mcp', '--token=' + TOKEN], { shell: true })
let buf = ''
const pending = new Map()
let nextId = 1

proc.stdout.on('data', (d) => {
  buf += d.toString()
  let idx
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim(); buf = buf.slice(idx + 1)
    if (!line) continue
    let msg; try { msg = JSON.parse(line) } catch { continue }
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  }
})
proc.stderr.on('data', (d) => console.error('[mcp-stderr]', d.toString().slice(0, 300)))

const rpc = (method, params) => new Promise((resolve) => {
  const id = nextId++
  pending.set(id, resolve)
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
})

const main = async () => {
  await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'zcode-bridge', version: '1.0' } })
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
  const [,, cmd, toolName, argsJson] = process.argv
  if (cmd === 'tools') {
    const r = await rpc('tools/list', {})
    for (const t of r.result.tools) console.log('##', t.name, '\n ', (t.description || '').slice(0, 200), '\n  args:', JSON.stringify(t.inputSchema?.properties ? Object.keys(t.inputSchema.properties) : []))
  } else if (cmd === 'call') {
    const r = await rpc('tools/call', { name: toolName, arguments: argsJson ? JSON.parse(argsJson) : {} })
    console.log(JSON.stringify(r, null, 1).slice(0, 4000))
  }
  setTimeout(() => { proc.kill(); process.exit(0) }, 500)
}
main().catch((e) => { console.error('FATAL', e.message); process.exit(1) })
