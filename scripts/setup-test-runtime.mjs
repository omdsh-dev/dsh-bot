/** Build an unmodified upstream runtime for testing the already-built release archives. */
import { existsSync, mkdirSync, lstatSync } from 'node:fs'
import { join } from 'node:path'
import { root, pin, run, requireNode } from './common.mjs'
import { compatibility } from './compatibility.mjs'

requireNode()
const target = compatibility.tested.find(item => item.version === process.argv[2])
if (!target) throw new Error('Usage: node scripts/setup-test-runtime.mjs <version from compatibility.json>')
if (target.version === pin.version) {
  run(process.execPath, ['scripts/setup.mjs'], { cwd: root })
} else {
  const runtime = join(root, '.runtime', `deepseek-harness-${target.version}`)
  if (!existsSync(runtime)) {
    mkdirSync(runtime, { recursive: true })
    run('git', ['init', '--quiet'], { cwd: runtime })
    run('git', ['remote', 'add', 'origin', pin.repository], { cwd: runtime })
    run('git', ['fetch', '--depth', '1', 'origin', target.commit], { cwd: runtime })
    run('git', ['checkout', '--detach', target.commit], { cwd: runtime })
  }
  if (lstatSync(runtime).isSymbolicLink()) throw new Error('The test runtime cannot be a symlink.')
  if (run('git', ['rev-parse', 'HEAD'], { cwd: runtime, stdio: 'pipe' }) !== target.commit) throw new Error('Unexpected test runtime revision.')
  if (run('pnpm', ['--version'], { stdio: 'pipe' }) !== pin.pnpm) throw new Error(`Use pnpm ${pin.pnpm}.`)
  run('pnpm', ['install', '--frozen-lockfile'], { cwd: runtime })
  run('pnpm', ['run', 'build'], { cwd: runtime })
}
