/** A real browser/MCP probe run inside the unprivileged container, using only a local test page. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
const root = '/opt/dsh-bot'
const pin = JSON.parse(readFileSync(join(root, 'dsh-version.json'), 'utf8'))
const require = createRequire(join(root, '.runtime', `deepseek-harness-${pin.version}`, 'packages/experimental/bot-mode/package.json'))
const cli = join(dirname(require.resolve('@playwright/mcp/package.json')), 'cli.js')
const server = createServer((_request, response) => { response.end('<html><title>Container browser check</title><body>LOCAL_BROWSER_ACCEPTANCE</body></html>') })
server.listen(0, '127.0.0.1'); await once(server, 'listening')
const child = spawn(process.execPath, [cli, '--browser', 'chromium', '--isolated', '--headless', '--executable-path', '/usr/bin/chromium'], { stdio: ['pipe', 'pipe', 'pipe'] })
const closed = new Promise(resolve => child.once('close', resolve))
let diagnostics = '', next = 0
child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk).slice(-4000) })
const calls = new Map()
const lines = createInterface({ input: child.stdout })
lines.on('line', line => {
  let result
  try { result = JSON.parse(line) } catch { return }
  const pending = calls.get(result.id)
  if (!pending) return
  clearTimeout(pending.timer); calls.delete(result.id)
  if (result.error) pending.reject(new Error(JSON.stringify(result.error)))
  else pending.resolve(result.result)
})
child.on('error', error => { for (const pending of calls.values()) pending.reject(error) })
const call = (method, params) => new Promise((resolve, reject) => {
  const id = ++next, timer = setTimeout(() => { calls.delete(id); reject(new Error(`MCP ${method} timed out: ${diagnostics}`)) }, 45000)
  calls.set(id, { resolve, reject, timer }); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
})
try {
  await call('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'container-check', version: '1.0.0' } })
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
  const result = await call('tools/call', { name: 'browser_navigate', arguments: { url: `http://127.0.0.1:${server.address().port}/` } })
  assert.ok(!result.isError, JSON.stringify(result))
  assert.match(JSON.stringify(result), /LOCAL_BROWSER_ACCEPTANCE/)
  console.log('The container Chromium completed a real isolated MCP navigation.')
} finally {
  for (const pending of calls.values()) clearTimeout(pending.timer)
  lines.close(); child.kill('SIGTERM')
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5000)
  await closed; clearTimeout(timeout)
  await new Promise(resolve => server.close(resolve))
}
