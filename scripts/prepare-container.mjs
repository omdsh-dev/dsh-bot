/** Export only the pinned upstream Git objects; no local profiles, credentials or working files. */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { root, runtime, pin, run, assertPinnedRuntime } from './common.mjs'
run(process.execPath, [join(root, 'scripts/setup.mjs'), '--prepare-only'])
assertPinnedRuntime()
mkdirSync(join(root, '.container'), { recursive: true })
run('git', ['bundle', 'create', join(root, '.container/runtime.bundle'), 'HEAD'], { cwd: runtime })
console.log(`Prepared pinned DSH ${pin.commit} for the container build.`)
