/** Authenticate to a disposable container, exercise native RPC, and verify a real restart. */
import assert from 'node:assert/strict'
import { randomInt, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { root, run } from './common.mjs'
const image = process.env.DSH_BOT_TEST_IMAGE || 'dsh-bot:parity-test'
const name = 'dsh-bot-check-' + randomUUID(), volume = name + '-data'
const port = randomInt(20000, 60000), internal = process.env.DSH_BOT_TEST_CONTAINER_INTERNAL === '1'
const docker = args => run('docker', args, { stdio: 'pipe' })
const logs = () => {
  const result = spawnSync('docker', ['logs', name], { encoding: 'utf8' })
  if (result.error) throw result.error
  return result.stdout + result.stderr
}
// Docker Desktop without host networking can verify the service inside its Linux VM.
// Default/CI mode always probes from the host so deployment reachability is also checked.
const http = internal ? async (url, { signal, ...options } = {}) => {
  const result = JSON.parse(run('docker', ['exec', '-i', name, 'node', '--input-type=module'], { stdio: 'pipe',
    input: `const r = await fetch(${JSON.stringify(url)}, { ...${JSON.stringify(options)}, signal: AbortSignal.timeout(10000) }); console.log(JSON.stringify({ status: r.status, headers: Object.fromEntries(r.headers), body: await r.text() }))` }))
  return { status: result.status, headers: new Headers(result.headers), text: async () => result.body, json: async () => JSON.parse(result.body) }
} : fetch
let started = false
try {
  docker(['run', '--detach', '--name', name, '--network', 'host', '--env', `DSH_BOT_PORT=${port}`, '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
    '--mount', `type=volume,source=${volume},target=/data`, image])
  started = true
  const origin = `http://127.0.0.1:${port}`
  let cookie
  const authenticate = async () => {
    const deadline = Date.now() + 120000
    while (Date.now() < deadline) {
      const output = logs()
      const token = [...output.matchAll(/dsh web: http:\/\/[^/\s]+\/\?token=([^\s)]+)/g)].at(-1)?.[1]
      if (token) try {
        const response = await http(`${origin}/?token=${token}`, { redirect: 'manual', signal: AbortSignal.timeout(3000) })
        await response.text()
        if (response.status === 303) { cookie = response.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie); return }
      } catch { /* Wait for the native Host listener. */ }
      if (docker(['inspect', '--format', '{{.State.Running}}', name]) !== 'true') throw new Error(output.replace(/(\?token=)[A-Za-z0-9_-]+/g, '$1[redacted]'))
      await new Promise(resolve => setTimeout(resolve, 500))
    }
    throw new Error('Container authentication did not become ready')
  }
  const rpc = async (method, args = {}) => {
    const response = await http(`${origin}/api/bots/${method}`, { method: 'POST', headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'client-request', rpcId: randomUUID(), method: `bots/${method}`, payload: { args } }), signal: AbortSignal.timeout(10000) })
    assert.equal(response.status, 200)
    const value = await response.json(); assert.equal(value.result.ok, true, JSON.stringify(value)); return value.result.value
  }
  await authenticate()
  const anonymous = await http(origin, { signal: AbortSignal.timeout(5000) }); assert.equal(anonymous.status, 401); await anonymous.text()
  assert.equal(docker(['exec', name, 'id', '-u']), '1000', 'The service must run as the unprivileged node user')
  await rpc('createBot', { request: { id: 'container-check', name: 'Container restart check', instructions: 'No model invocation is needed.' } })
  await rpc('saveMemory', { request: { scope: 'global', ownerId: '*', kind: 'preference', subject: 'container', topic: 'persistence', body: 'CONTAINER_PERSISTENCE_FIXTURE', evidence: '' } })
  const before = await rpc('snapshot')
  assert.equal(before.bots.length, 1)
  assert.equal((await rpc('accessCatalog')).credentials.length, 0)
  assert.equal((await rpc('teamView')).settings.botId, null)
  await rpc('usageReport')
  docker(['restart', '--time', '20', name])
  await authenticate()
  const after = await rpc('snapshot')
  assert.deepEqual(after.bots, before.bots)
  assert.deepEqual(after.rooms.map(room => room.id), before.rooms.map(room => room.id))
  assert.ok((await rpc('listMemories', { request: {} })).some(item => item.body === 'CONTAINER_PERSISTENCE_FIXTURE'))
  docker(['exec', name, 'node', '/opt/dsh-bot/scripts/container-health.mjs'])
  run('docker', ['exec', '-i', name, 'node', '--input-type=module'], { input: readFileSync(join(root, 'scripts/container-browser-check.mjs')), stdio: ['pipe', 'inherit', 'inherit'] })
  console.log(`Container authentication, unprivileged execution, native RPC and persistent restart passed (${internal ? 'inside the Docker VM; host reachability not checked' : 'from the host loopback'}).`)
} finally {
  if (started) docker(['rm', '--force', '--volumes', name])
  try { docker(['volume', 'rm', volume]) } catch { /* No volume was created if image startup failed. */ }
}
