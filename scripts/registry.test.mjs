/** Opt-in post-publication check through Desktop's real registry installer. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, copyFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { runtime } from './common.mjs'
import { desktopModule, materializePackage, readReport } from './package-fixture.mjs'

test('the published package installs through Desktop and runs in a fresh profile', { timeout: 180000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-bot-registry-'))
  let host
  try {
    const fixture = await materializePackage(home)
    await writeFile(join(fixture.resources, 'desktop-runtime.json'), JSON.stringify(fixture.descriptor))
    const { DesktopProjectManager } = await desktopModule('project-manager')
    const { resolveDesktopPaths } = await desktopModule('paths')
    const { DesktopHostProcess } = await desktopModule('host-process')
    const pnpmManifestFile = join(runtime, 'apps/desktop/node_modules/pnpm/package.json')
    const pnpmManifest = JSON.parse(await readFile(pnpmManifestFile, 'utf8'))
    const data = join(home, 'registry-home')
    const paths = resolveDesktopPaths(data)
    const manager = new DesktopProjectManager(paths, {
      node: process.execPath, dsh: fixture.resources,
      pnpm: join(dirname(pnpmManifestFile), pnpmManifest.bin.pnpm),
    })
    await manager.applyRelease()
    assert.deepEqual(manager.listPlugins(), [])
    await manager.mutate({ type: 'plugin-add', spec: `${fixture.info.name}@${fixture.info.version}` }, {
      beforeChange: async () => {}, afterChange: async () => {},
    })
    assert.deepEqual(manager.listPlugins(), [{ name: fixture.info.name, version: fixture.info.version, enabled: true }])
    manager.assertProfileRuntime(paths.profile)
    // Add only the external model substitute after the real registry installation has completed.
    for (const file of ['driver.js', 'cordis.patch.yml']) await copyFile(join(fixture.profile, file), join(paths.profile, file))
    const manifestFile = join(paths.profile, 'package.json')
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
    await writeFile(manifestFile, JSON.stringify({ ...manifest, type: 'module' }))
    const result = join(home, 'registry-result.json')
    host = new DesktopHostProcess(process.execPath, fixture.resources, paths.profile, undefined, {
      ...process.env, DSH_HOME: data, BOT_TEST_PHASE: 'first', BOT_TEST_RESULT: result,
    })
    let timer
    try {
      await Promise.race([host.start(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Registry-installed Host startup timed out.')), 45000)
      })])
    } finally { clearTimeout(timer) }
    const report = await readReport(result)
    assert.equal(report.ok, true, report.error)
    const response = await host.fetch(new Request('dsh-app://app/index.html', { signal: AbortSignal.timeout(10000) }))
    assert.equal(response.status, 200)
    assert.ok((await response.text()).includes('@deepseek-ai/dsh-experimental-bot-mode'))
  } finally {
    if (host) await host.stop()
    await rm(home, { recursive: true, force: true })
  }
})
