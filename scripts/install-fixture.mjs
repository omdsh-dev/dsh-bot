/** Install local or published archives through DSH's shared plugin manager and start Desktop. */
import assert from 'node:assert/strict'
import { appendFile, mkdtemp, readFile, writeFile, copyFile, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { root } from './common.mjs'
import { runtime } from './test-runtime.mjs'
import { desktopModule, desktopRequest, materializePackage, profileValidator, readReport } from './package-fixture.mjs'

export async function verifyInstallation(registry = false) {
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
    const manager = new DesktopProjectManager(paths, { dsh: fixture.resources, node: process.execPath, pnpm: join(dirname(pnpmManifestFile), pnpmManifest.bin.pnpm) })
    await manager.applyRelease()
    // Match the documented profile setting: protobufjs's optional version warning needs no install script.
    if (!manager.mutate) await appendFile(join(paths.profile, 'pnpm-workspace.yaml'), '\nallowBuilds:\n  protobufjs: false\n')
    const runProfilePnpm = manager.mutate ? undefined : (await import(pathToFileURL(join(runtime, 'packages/boot/plugin-manager/lib/types/operations.js')).href)).runProfilePnpm
    const validate = await profileValidator(paths.profile, fixture.resources, fixture.descriptor)
    const feishu = JSON.parse(await readFile(join(root, 'dist/feishu-package-info.json'), 'utf8'))
    for (const info of [fixture.info, feishu]) {
      const spec = registry ? `${info.name}@${info.version}` : join(root, 'dist', info.file)
      // This is an isolated profile with one writer, using the same admission and reconciliation as Desktop.
      if (manager.mutate) {
        await manager.mutate({ type: 'plugin-add', spec }, { beforeChange: async () => {}, afterChange: async () => {} })
      } else {
        const installed = await runProfilePnpm({
          profile: 'desktop', dir: paths.profile, home: data, cwd: root,
          installAnchor: join(fixture.resources, 'node_modules/@deepseek-ai/dsh/package.json'),
        }, ['add', spec, '--registry=https://registry.npmjs.org'], {
          command: process.execPath, args: [join(dirname(pnpmManifestFile), pnpmManifest.bin.pnpm)],
          execution: 'service', outputBytes: 65536, idleTimeoutMs: 60000,
          env: { PATH: process.env.PATH },
        })
        assert.equal(installed.exitCode, 0, installed.output)
      }
      const installedManifest = JSON.parse(await readFile(join(paths.profile, 'node_modules', info.name, 'package.json'), 'utf8'))
      assert.equal(installedManifest.version, info.version)
      const loaded = validate()
      if (loaded) assert.ok(loaded.layers.some(layer => layer.packageName === info.name))
      else assert.ok(manager.listPlugins().some(item => item.name === info.name && item.enabled))
    }
    // Add the deterministic test driver only after the real package installation has completed.
    for (const file of ['driver.js', 'cordis.patch.yml']) await copyFile(join(fixture.profile, file), join(paths.profile, file))
    const manifestFile = join(paths.profile, 'package.json')
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
    await writeFile(manifestFile, JSON.stringify({ ...manifest, type: 'module' }))
    const result = join(home, 'registry-result.json')
    host = new DesktopHostProcess(process.execPath, fixture.resources, paths.profile, undefined, {
      ...fixture.environment, DSH_HOME: data, BOT_TEST_PHASE: 'first', BOT_TEST_RESULT: result, BOT_TEST_INSTALLED_FEISHU: '1',
    })
    let timer
    let ready
    try {
      ready = await Promise.race([host.start(), new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Registry-installed Host startup timed out.')), 45000)
      })])
    } finally { clearTimeout(timer) }
    const report = await readReport(result)
    assert.equal(report.ok, true, report.error)
    const request = await desktopRequest(host, ready)
    const response = await request('index.html')
    assert.equal(response.status, 200)
    assert.ok((await response.text()).includes('@deepseek-ai/dsh-experimental-bot-mode'))
  } finally {
    if (host) await host.stop()
    await rm(home, { recursive: true, force: true })
  }
}
