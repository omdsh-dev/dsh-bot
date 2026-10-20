/** Prepare the pinned DSH workspace, install the plugin, and build its native profile. */
import { cpSync, existsSync, lstatSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { root, runtime, pin, pluginPath, run, requireNode, assertPinnedRuntime } from './common.mjs'

requireNode()
const args = process.argv.slice(2)
if (args.some(arg => arg !== '--prepare-only')) throw new Error('Usage: npm run setup [-- --prepare-only]')
const prepareOnly = args.includes('--prepare-only')
if (!prepareOnly) {
  const version = run('pnpm', ['--version'], { cwd: root, stdio: 'pipe' })
  if (version !== pin.pnpm) throw new Error(`Install pnpm ${pin.pnpm}: npm install --global pnpm@${pin.pnpm}`)
}
mkdirSync(join(root, '.runtime'), { recursive: true })
if (!existsSync(runtime)) {
  mkdirSync(runtime)
  run('git', ['init', '--quiet'], { cwd: runtime })
  run('git', ['remote', 'add', 'origin', pin.repository], { cwd: runtime })
}
if (lstatSync(runtime).isSymbolicLink()) throw new Error('The managed runtime cannot be a symlink to another checkout.')
const hasHead = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: runtime, stdio: 'ignore' }).status === 0
if (!hasHead) {
  run('git', ['fetch', '--depth', '1', 'origin', pin.commit], { cwd: runtime })
  run('git', ['checkout', '--detach', pin.commit], { cwd: runtime })
}
assertPinnedRuntime()
const patch = join(root, 'integration', 'dsh-workspace.patch')
const alreadyApplied = spawnSync('git', ['apply', '--reverse', '--check', patch], { cwd: runtime, stdio: 'ignore' }).status === 0
if (!alreadyApplied) {
  run('git', ['apply', '--check', patch], { cwd: runtime })
  run('git', ['apply', patch], { cwd: runtime })
}
cpSync(join(root, 'plugin'), join(runtime, pluginPath), { recursive: true })
console.log(`Prepared DSH ${pin.version} (${pin.commit.slice(0, 12)}).`)
if (!prepareOnly) {
  run('pnpm', ['install', '--frozen-lockfile'], { cwd: runtime })
  run('pnpm', ['run', 'build'], { cwd: runtime })
  run(process.execPath, ['scripts/build-plugin.mjs'], { cwd: root })
  console.log('\nDSH Bot is ready. Run: npm start')
}
