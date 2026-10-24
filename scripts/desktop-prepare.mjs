/** Run through the pinned workspace's tsx loader, reusing native preparation and profile APIs. */
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { root, runtime, pin, pluginPath, run, assertPinnedRuntime } from './common.mjs'
assertPinnedRuntime()
const nativeApp = join(runtime, 'apps/desktop')
const require = createRequire(join(nativeApp, 'package.json'))
const electron = require('electron')
const load = name => import(pathToFileURL(join(nativeApp, name)).href)
const { prepareDevelopmentProject } = await load('scripts/development-project.ts')
const { resolveDesktopBuildTarget, developmentRuntimeDirectory } = await load('scripts/desktop-build-paths.mjs')
const { preparePrimaryRuntime } = await load('scripts/prepare-primary-runtime.ts')
const { createPluginProfile } = await load('lib/types/project-manager.js')
const { DESKTOP_HOST_PROTOCOL_VERSION } = await load('lib/types/host-protocol.js')
const home = resolve(process.env.DSH_HOME || join(root, '.data/desktop'))
const build = join(root, '.runtime/bot-desktop', createHash('sha256').update(home).digest('hex').slice(0, 16))
const project = join(build, 'project'), app = join(build, 'app')
const release = { schemaVersion: 1, version: pin.version, hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
  nodeVersion: run(electron, ['-p', 'process.versions.node'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'pipe' }), pnpmVersion: pin.pnpm }
if (!existsSync(join(project, 'desktop-runtime.json'))) prepareDevelopmentProject({ projectDir: project, cliDir: join(runtime, 'apps/cli'), hostDir: join(runtime, 'apps/desktop-host'),
  dependencyDir: join(runtime, 'node_modules/.pnpm/node_modules'), release, target: resolveDesktopBuildTarget() })
const primaryRuntime = developmentRuntimeDirectory()
if (!existsSync(join(primaryRuntime, 'runtime.json'))) await preparePrimaryRuntime()
const profile = join(home, 'profiles/desktop')
createPluginProfile(profile)
const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
if (!manifest.dsh.profile.bundles.includes('@zzzpyyy/dsh-bot')) {
  const yaml = require('js-yaml'), patchFile = join(profile, 'cordis.patch.yml')
  const patch = existsSync(patchFile) ? yaml.load(readFileSync(patchFile, 'utf8')) ?? [] : []
  if (!Array.isArray(patch)) throw new Error('The desktop profile patch must be an array.')
  if (!patch.some(item => item.id === 'bot-mode' || item.insert?.some?.(entry => entry.id === 'bot-mode'))) {
    patch.push({ insert: [{ id: 'bot-mode', name: join(runtime, pluginPath, 'lib/index.js') }] })
    writeFileSync(patchFile, yaml.dump(patch), { mode: 0o600 })
  }
}
mkdirSync(app, { recursive: true })
cpSync(join(root, 'desktop/entry.mjs'), join(app, 'entry.mjs'))
writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'dsh-bots-desktop', version: pin.version, private: true, type: 'module', main: 'entry.mjs' }))
const config = { home, nativeApp, project, primaryRuntime, pnpm: join(dirname(require.resolve('pnpm')), 'bin/pnpm.mjs'), electron, app }
writeFileSync(join(app, 'launcher.json'), JSON.stringify(config), { mode: 0o600 })
writeFileSync(join(build, 'launch.json'), JSON.stringify(config), { mode: 0o600 })
console.log(`Native desktop prepared: ${app}`)
