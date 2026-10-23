/** Materialize built DSH resources and unpack the actual release archive into an isolated profile. */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { root, pin, run, workspacePackages } from './common.mjs'
import { runtime, target } from './test-runtime.mjs'

export const requireRuntime = createRequire(join(runtime, 'package.json'))
export const desktopModule = name => import(pathToFileURL(join(runtime, 'apps/desktop/lib/types', `${name}.js`)).href)
const legacyProfilePackages = () => existsSync(join(runtime, 'apps/desktop/lib/types/profile-packages.js'))
  ? desktopModule('profile-packages') : Promise.resolve({})
export const appBootModule = () => import(pathToFileURL(join(runtime, 'packages/boot/app-boot/lib/index.js')).href)

/** Use the same profile admission check as the installed CLI and Desktop Host. */
export async function profileValidator(profile, resources, descriptor) {
  const packages = await legacyProfilePackages()
  if (packages.validateDesktopPluginGraph) return () => {
    const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
    packages.validateDesktopPluginGraph(profile, resources, descriptor, manifest.dsh.profile.bundles.filter(name => name.startsWith('@zzzpyyy/')))
  }
  const { loadProfileDirectory } = await appBootModule()
  return () => {
    const loaded = loadProfileDirectory('dsh', profile, join(resources, 'node_modules/@deepseek-ai/dsh/package.json'))
    if (loaded.skippedBundles.length) throw new Error(loaded.skippedBundles.map(item => item.reason).join('\n'))
    return loaded
  }
}

/** Exchange the Host's startup token for its normal authenticated browser cookie. */
export async function hostRequest(address) {
  const url = new URL(address)
  const login = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000) })
  const cookie = login.headers.get('set-cookie')?.split(';')[0]
  await login.text()
  if (login.status !== 303 || !cookie) throw new Error(`Host authentication failed (${login.status}).`)
  return path => fetch(new URL(path, url.origin), { headers: { cookie }, signal: AbortSignal.timeout(10000) })
}

/** Use the runtime's native Desktop transport (0.1 byte pipe or 0.2 HTTP). */
export async function desktopRequest(host, ready) {
  if (typeof host.fetch === 'function') return path => host.fetch(new Request(new URL(path, 'dsh-app://app/')))
  return hostRequest(ready.url)
}

/** Copy runtime files, retaining generated declarations and excluding build/source/test trees. */
const includeRuntime = path => !['node_modules', 'src', 'tests', '.desktop-build', '.git', '.release'].includes(basename(path))
  && !/\.(?:map|tsbuildinfo)$/.test(path)

export async function materializePackage(home) {
  const resources = join(home, 'resources')
  const modules = join(resources, 'node_modules')
  const pool = join(runtime, 'node_modules/.pnpm/node_modules')
  mkdirSync(modules, { recursive: true })
  writeFileSync(join(resources, 'package.json'), '{"private":true,"type":"module"}\n')
  const entries = new Map()
  const add = (name, path) => {
    // pnpm retains some links for optional platform binaries that were not installed.
    if (existsSync(path)) entries.set(name, realpathSync(path))
  }
  for (const origin of [pool, join(runtime, 'node_modules')]) {
    for (const item of readdirSync(origin, { withFileTypes: true })) {
      if (item.name.startsWith('.')) continue
      if (item.name.startsWith('@')) {
        for (const scoped of readdirSync(join(origin, item.name))) add(`${item.name}/${scoped}`, join(origin, item.name, scoped))
      } else add(item.name, join(origin, item.name))
    }
  }
  entries.set('@deepseek-ai/dsh', join(runtime, 'apps/cli'))
  entries.set('@deepseek-ai/dsh-desktop-host', join(runtime, 'apps/desktop-host'))
  for (const [name, item] of workspacePackages(runtime)) entries.set(name, item.path)
  entries.delete('@deepseek-ai/dsh-experimental-bot-mode')
  // Use Desktop's own production closure selector so development-only packages cannot hide missing peers.
  const { selectDesktopPackageClosure } = await import(pathToFileURL(join(runtime, 'apps/desktop/scripts/prepare-package-set.ts')).href)
  const available = new Map([...entries].filter(([name]) => name.startsWith('@deepseek-ai/')).map(([name, path]) => [name, {
    tarball: '', manifest: JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')),
  }]))
  const production = new Set(selectDesktopPackageClosure(available).map(item => item.manifest.name))
  const sharedPackages = []
  for (const [name, path] of entries) {
    if (name.startsWith('@deepseek-ai/') && !production.has(name)) continue
    const target = join(modules, name)
    mkdirSync(join(target, '..'), { recursive: true })
    if (name.startsWith('@deepseek-ai/')) {
      cpSync(path, target, { recursive: true, filter: includeRuntime })
      const manifest = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
      sharedPackages.push({ name, version: manifest.version, path: `node_modules/${name}` })
    } else symlinkSync(path, target, process.platform === 'win32' ? 'junction' : 'dir')
  }
  const { DESKTOP_HOST_PROTOCOL_VERSION } = await desktopModule('host-protocol')
  const descriptor = {
    schemaVersion: 1, platform: process.platform, arch: process.arch, files: [], sharedPackages,
    release: { schemaVersion: 1, version: target.version, hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION, nodeVersion: process.versions.node, pnpmVersion: pin.pnpm },
  }
  // DSH 0.2 Desktop requires its Office skill assets and a standalone Node before announcing readiness.
  const office = join(runtime, 'packages/skill/skill-office/assets')
  if (existsSync(office)) cpSync(office, join(home, 'runtime/office-skills'), { recursive: true })
  const nodeBin = join(home, 'runtime/primary-runtime/dependencies/node/bin')
  mkdirSync(nodeBin, { recursive: true })
  if (process.platform === 'win32') cpSync(process.execPath, join(nodeBin, 'node.exe'))
  else symlinkSync(process.execPath, join(nodeBin, 'node'), 'file')
  const profile = join(home, 'profiles/desktop')
  const { createPluginProfile } = await desktopModule('project-manager')
  createPluginProfile(profile)
  const { linkDesktopHostPackages } = await legacyProfilePackages()
  if (linkDesktopHostPackages) linkDesktopHostPackages(profile, resources, descriptor)
  const info = JSON.parse(readFileSync(join(root, 'dist/package-info.json'), 'utf8'))
  const plugin = join(profile, 'node_modules', info.name)
  mkdirSync(plugin, { recursive: true })
  run('tar', ['-xzf', join(root, 'dist', info.file), '--strip-components=1', '-C', plugin])
  const dependencyManifest = JSON.parse(readFileSync(join(plugin, 'package.json'), 'utf8')).dependencies ?? {}
  const cache = join(root, '.runtime/package-fixture-dependencies')
  const matches = (name, version) => {
    const file = join(cache, 'node_modules', name, 'package.json')
    return existsSync(file) && JSON.parse(readFileSync(file, 'utf8')).version === version
  }
  if (!Object.entries(dependencyManifest).every(([name, version]) => matches(name, version))) {
    mkdirSync(cache, { recursive: true })
    writeFileSync(join(cache, 'package.json'), JSON.stringify({ private: true, dependencies: dependencyManifest }))
    run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--no-package-lock'], { cwd: cache, stdio: 'pipe' })
  }
  for (const [name, version] of Object.entries(dependencyManifest)) {
    if (!matches(name, version)) throw new Error(`Release dependency version mismatch: ${name}@${version}`)
  }
  // An installed profile owns its private dependency closure. DSH 0.1 deliberately rejects
  // external symlinks; copy npm's complete local tree, including transitive dependencies.
  cpSync(join(cache, 'node_modules'), join(profile, 'node_modules'), {
    recursive: true, dereference: true,
    filter: path => !path.split(/[\\/]/).includes('.bin'),
  })
  const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
  manifest.type = 'module'
  manifest.dependencies[info.name] = info.version
  manifest.dsh.profile.bundles.push(info.name)
  writeFileSync(join(profile, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  const validate = await profileValidator(profile, resources, descriptor)
  validate()
  const ts = requireRuntime('typescript')
  const driver = ts.transpileModule(readFileSync(join(root, 'plugin/tests/profile-fixture.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
  writeFileSync(join(profile, 'driver.js'), driver)
  writeFileSync(join(profile, 'cordis.patch.yml'), '- id: agent-default-model\n  config:\n    provider: bot-fixture\n    model: fixture\n- insert:\n    - id: bot-test-driver\n      name: ./driver.js\n')
  return { resources, profile, plugin, descriptor, info, validate, environment: { ...process.env, DSH_CLIENT_VERSION: target.version } }
}

export async function readReport(file, milliseconds = 45000) {
  const deadline = Date.now() + milliseconds
  while (Date.now() < deadline) {
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'))
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('The real-profile driver did not produce its result.')
}
