/** Materialize built DSH resources and unpack the actual release archive into an isolated profile. */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { root, runtime, pin, pluginPath, run, workspacePackages } from './common.mjs'

export const requireRuntime = createRequire(join(runtime, 'package.json'))
export const desktopModule = name => import(pathToFileURL(join(runtime, 'apps/desktop/lib/types', `${name}.js`)).href)

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
  for (const [name, item] of workspacePackages()) entries.set(name, item.path)
  entries.delete('@deepseek-ai/dsh-experimental-bot-mode')
  const sharedPackages = []
  for (const [name, path] of entries) {
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
    release: { schemaVersion: 1, version: pin.version, hostProtocolVersion: DESKTOP_HOST_PROTOCOL_VERSION, nodeVersion: process.versions.node, pnpmVersion: pin.pnpm },
  }
  const profile = join(home, 'profiles/desktop')
  const { createPluginProfile } = await desktopModule('project-manager')
  const { linkDesktopHostPackages, validateDesktopPluginGraph } = await desktopModule('profile-packages')
  createPluginProfile(profile)
  linkDesktopHostPackages(profile, resources, descriptor)
  const info = JSON.parse(readFileSync(join(root, 'dist/package-info.json'), 'utf8'))
  const plugin = join(profile, 'node_modules', info.name)
  mkdirSync(plugin, { recursive: true })
  run('tar', ['-xzf', join(root, 'dist', info.file), '--strip-components=1', '-C', plugin])
  cpSync(realpathSync(join(pool, 'zod')), join(profile, 'node_modules/zod'), { recursive: true })
  const manifest = JSON.parse(readFileSync(join(profile, 'package.json'), 'utf8'))
  manifest.type = 'module'
  manifest.dependencies[info.name] = info.version
  manifest.dsh.profile.bundles.push(info.name)
  writeFileSync(join(profile, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  validateDesktopPluginGraph(profile, resources, descriptor, [info.name])
  const ts = requireRuntime('typescript')
  const driver = ts.transpileModule(readFileSync(join(runtime, pluginPath, 'tests/profile-fixture.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText
  writeFileSync(join(profile, 'driver.js'), driver)
  writeFileSync(join(profile, 'cordis.patch.yml'), '- id: agent-default-model\n  config:\n    provider: bot-fixture\n    model: fixture\n- insert:\n    - id: bot-test-driver\n      name: ./driver.js\n')
  return { resources, profile, plugin, descriptor, info, validate: () => validateDesktopPluginGraph(profile, resources, descriptor, [info.name]) }
}

export async function readReport(file, milliseconds = 45000) {
  const deadline = Date.now() + milliseconds
  while (Date.now() < deadline) {
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'))
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('The real-profile driver did not produce its result.')
}
