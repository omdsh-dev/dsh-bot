/** Select a qualified runtime without changing or rebuilding the release archives. */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { root, pin, run } from './common.mjs'
import { compatibility } from './compatibility.mjs'

export const target = compatibility.tested.find(item => item.version === (process.env.DSH_BOT_TEST_VERSION ?? pin.version))
if (!target) throw new Error('Select a version from compatibility.json with DSH_BOT_TEST_VERSION.')
const versioned = join(root, '.runtime', `deepseek-harness-${target.version}`)
const legacy = join(root, '.runtime/deepseek-harness')
export const runtime = existsSync(versioned) ? versioned : legacy
if (run('git', ['rev-parse', 'HEAD'], { cwd: runtime, stdio: 'pipe' }) !== target.commit) {
  throw new Error(`Prepare DSH ${target.version}: node scripts/setup-test-runtime.mjs ${target.version}`)
}
