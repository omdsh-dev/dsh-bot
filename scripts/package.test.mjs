/** Exercise the shipped tarball through Desktop's real Host, profile admission, and authenticated Web transport. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { target } from './test-runtime.mjs'
import { desktopModule, desktopRequest, hostRequest, materializePackage, readReport } from './package-fixture.mjs'

async function within(promise, milliseconds) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Host startup timed out.')), milliseconds)
    })])
  } finally { clearTimeout(timer) }
}

async function verifyBotAssets(request) {
  const response = await request('index.html')
  assert.equal(response.status, 200)
  const html = await response.text()
  const encoded = html.match(/globalThis\["__DSH_BOOT__"\]\s*=\s*([^<]*?)<\/script>/)?.[1]
  assert.ok(encoded, 'DSH must provide its native client boot graph.')
  const graph = JSON.parse(encoded.trim().replace(/;$/, ''))
  const bot = graph.entries.find(entry => entry.id === '@deepseek-ai/dsh-experimental-bot-mode')
  assert.ok(bot, 'The embedded implementation must retain its generated module identity.')
  const asset = await request(bot.url)
  assert.equal(asset.status, 200)
  assert.ok((await asset.text()).includes('DSH Bots'), 'DSH must serve the compiled Bot UI.')
}

test('the npm archive loads in Desktop, renders its bundle, and resumes separate Bot Sessions', { timeout: 180000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-bot-desktop-package-'))
  try {
    const fixture = await materializePackage(home)
    const { DesktopHostProcess } = await desktopModule('host-process')
    assert.equal(fixture.descriptor.release.version, target.version)
    const manifestFile = join(fixture.plugin, 'package.json')
    const manifestText = await readFile(manifestFile, 'utf8')
    const manifest = JSON.parse(manifestText)
    assert.ok(manifest.dsh.bundle.patch)
    assert.ok(!manifest.scripts, 'Installation must not require lifecycle scripts.')
    assert.ok(!manifestText.includes('workspace:'))
    const incompatible = structuredClone(manifest)
    incompatible.peerDependencies['@deepseek-ai/dsh'] = '>=999.0.0'
    try {
      await writeFile(manifestFile, JSON.stringify(incompatible))
      assert.throws(fixture.validate, /(?:incompatible|requires).*999\.0\.0/)
    } finally { await writeFile(manifestFile, manifestText) }
    assert.doesNotThrow(fixture.validate)
    let first
    for (const phase of ['first', 'resume']) {
      const result = join(home, `${phase}.json`)
      const host = new DesktopHostProcess(process.execPath, fixture.resources, fixture.profile, undefined, {
        ...fixture.environment, DSH_HOME: home, BOT_TEST_PHASE: phase, BOT_TEST_RESULT: result,
      })
      try {
        const ready = await within(host.start(), 45000)
        const report = await readReport(result)
        assert.equal(report.ok, true, report.error)
        await verifyBotAssets(await desktopRequest(host, ready))
        const group = report.state.rooms.find(room => room.kind === 'group')
        if (phase === 'first') first = group
        else {
          assert.deepEqual(group.members.map(member => member.sessionId), first.members.map(member => member.sessionId))
          assert.ok(group.messages.length > first.messages.length)
        }
      } catch (error) {
        // Include child diagnostics when the Host exits before announcing readiness.
        throw new Error(`${error.message}\n${host.stderr ?? ''}`, { cause: error })
      } finally { await host.stop() }
    }
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('the same npm archive loads through the authenticated Web transport', { timeout: 120000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-bot-web-package-'))
  let child
  let closed
  let output = ''
  try {
    const fixture = await materializePackage(home)
    const profile = join(home, 'profiles/web')
    await cp(fixture.profile, profile, { recursive: true })
    const result = join(home, 'web.json')
    child = spawn(process.execPath, ['--expose-internals', join(fixture.resources, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
      '--profile', 'web', '--port', '0', '--no-open'], {
      cwd: profile, env: { ...fixture.environment, DSH_HOME: home, BOT_TEST_PHASE: 'first', BOT_TEST_RESULT: result },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let spawnError
    child.stdout.on('data', data => { output += data })
    child.stderr.on('data', data => { output += data })
    child.on('error', error => { spawnError = error })
    closed = new Promise(resolve => child.once('close', resolve))
    let url
    const deadline = Date.now() + 45000
    while (Date.now() < deadline) {
      const match = output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s)]+)/)
      if (match) { url = new URL(match[1]); break }
      if (spawnError) throw spawnError
      if (child.exitCode !== null) throw new Error('Web Host exited before startup.')
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    assert.ok(url, 'Web Host must print an authenticated URL.')
    const report = await readReport(result)
    assert.equal(report.ok, true, report.error)
    const unauthenticated = await fetch(url.origin, { signal: AbortSignal.timeout(5000) })
    assert.equal(unauthenticated.status, 401)
    await unauthenticated.text()
    await verifyBotAssets(await hostRequest(url))
  } catch (error) {
    throw new Error(`${error.message}\n${output.replace(/token=[^\s)]+/g, 'token=[redacted]')}`, { cause: error })
  } finally {
    if (child) {
      child.kill('SIGTERM')
      const kill = setTimeout(() => child.kill('SIGKILL'), 5000)
      await closed
      clearTimeout(kill)
    }
    await rm(home, { recursive: true, force: true })
  }
})
