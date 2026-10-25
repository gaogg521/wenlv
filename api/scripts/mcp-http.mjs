// MCP streamable-HTTP 客户端（微信开发者工具 /mcp）
// usage: node scripts/mcp-http.mjs <toolName> '<args-json>'
import { request } from 'node:http'

const TOK = 'ekuE8ra457fLz__xbHJdi0YBYVrCJn2d'
const PORT = 59470

function call(body, sid) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: PORT, path: '/mcp', method: 'POST', headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      Authorization: 'Bearer ' + TOK, ...(sid ? { 'Mcp-Session-Id': sid } : {}) } }, (res) => {
      let b = ''
      res.on('data', (c) => b += c.toString())
      res.on('end', () => resolve({ status: res.statusCode, sid: res.headers['mcp-session-id'], body: b }))
    })
    req.on('error', reject)
    req.end(JSON.stringify(body))
  })
}
function parseSSE(body) {
  const line = body.split('\n').find((l) => l.startsWith('data:'))
  return line ? JSON.parse(line.slice(5).trim()) : null
}

const [,, toolName, argsJson] = process.argv
const init = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'zc', version: '1.0' } } })
const sid = init.sid
if (!sid) { console.log('init failed:', init.body.slice(0, 200)); process.exit(1) }
await call({ jsonrpc: '2.0', method: 'notifications/initialized' }, sid)
const r = await call({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: toolName, arguments: argsJson ? JSON.parse(argsJson) : {} } }, sid)
const msg = parseSSE(r.body)
if (!msg) { console.log('raw:', r.body.slice(0, 600)) } else {
  const out = msg.result ?? msg.error
  const txt = out?.content ? out.content.map((c) => c.text).join('\n') : JSON.stringify(out)
  console.log(txt && txt.slice(0, 3500) || JSON.stringify(out).slice(0, 3500))
}
process.exit(0)
