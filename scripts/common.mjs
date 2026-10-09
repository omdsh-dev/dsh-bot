/** Shared paths and shell-free process invocation for the source distribution. */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = dirname(dirname(fileURLToPath(import.meta.url)))
export const runtime = join(root, '.runtime', 'deepseek-harness')
export const pin = JSON.parse(readFileSync(join(root, 'dsh-version.json'), 'utf8'))
export const pluginPath = 'packages/experimental/bot-mode'

/** Return the pinned workspace package paths and versions, including non-hoisted peers. */
export function workspacePackages() {
  const packages = new Map()
  for (const container of ['vendor', 'apps', 'packages']) {
    for (const group of readdirSync(join(runtime, container), { withFileTypes: true })) {
      if (!group.isDirectory()) continue
      const first = join(runtime, container, group.name)
      const candidates = container === 'packages'
        ? readdirSync(first, { withFileTypes: true }).filter(item => item.isDirectory()).map(item => join(first, item.name))
        : [first]
      for (const path of candidates) {
        if (!existsSync(join(path, 'package.json'))) continue
        const manifest = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'))
        packages.set(manifest.name, { path, version: manifest.version })
      }
    }
  }
  return packages
}

/** Throw on command failure instead of proceeding with a partial installation. */
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args[0] ?? ''} failed (${result.signal ?? result.status})`)
  return result.stdout?.toString().trim()
}

export function requireNode() {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Use Node.js 24 or newer.')
}

export function assertPinnedRuntime() {
  const actual = run('git', ['rev-parse', 'HEAD'], { cwd: runtime, stdio: 'pipe' })
  if (actual !== pin.commit) throw new Error(`The managed DSH checkout must stay at ${pin.commit}; found ${actual}.`)
}

/** Use the managed workspace's executable directly, without pnpm auto-install. */
export function runTool(name, args) {
  return run(join(runtime, 'node_modules', '.bin', name), args, { cwd: runtime })
}
