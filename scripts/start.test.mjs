/** Exercise the distribution launcher without credentials or a model request. */
import { test } from 'node:test'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { root } from './common.mjs'

test('the launcher serves Bot Mode through native authenticated DSH', {
  timeout: 80000,
  skip: process.platform === 'win32' && 'The source launcher currently supports POSIX process cleanup only.',
}, async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-bot-distribution-'))
  const child = spawn(process.execPath, ['scripts/start.mjs', '--port', '0', '--no-open'], {
    cwd: root, env: { ...process.env, DSH_HOME: home, DSH_BOT_WORKDIR: '' },
    stdio: ['ignore', 'pipe', 'pipe'], detached: true,
  })
  let output = ''
  let spawnError
  child.stdout.on('data', data => { output += data })
  child.stderr.on('data', data => { output += data })
  child.on('error', error => { spawnError = error })
  const closed = new Promise(resolve => child.once('close', resolve))
  const diagnostic = () => output.replace(/token=[^\s)]+/g, 'token=[redacted]')
  try {
    let url
    const deadline = Date.now() + 45000
    while (Date.now() < deadline) {
      const match = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s)]+)/)
      if (match) { url = new URL(match[1]); break }
      if (spawnError) throw spawnError
      if (child.exitCode !== null) throw new Error(diagnostic())
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    assert.ok(url, `The launcher must print an authenticated Web URL. ${diagnostic()}`)
    const unauthenticated = await fetch(url.origin, { signal: AbortSignal.timeout(5000) })
    assert.equal(unauthenticated.status, 401)
    await unauthenticated.text()
    const login = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000) })
    assert.equal(login.status, 303)
    const cookie = login.headers.get('set-cookie')?.split(';')[0]
    assert.ok(cookie)
    await login.text()
    const page = await fetch(url.origin, { headers: { cookie }, signal: AbortSignal.timeout(5000) })
    assert.equal(page.status, 200)
    const html = await page.text()
    assert.ok(html.includes('dsh-experimental-bot-mode'), 'Native index must include the plugin.')
  } finally {
    child.kill('SIGTERM')
    const kill = setTimeout(() => {
      if (child.pid === undefined) return
      try { process.kill(-child.pid, 'SIGKILL') } catch (error) {
        if (error.code !== 'ESRCH') throw error
      }
    }, 5000)
    await closed
    clearTimeout(kill)
    await rm(home, { recursive: true, force: true })
  }
})
