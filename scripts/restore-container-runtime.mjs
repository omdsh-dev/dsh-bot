/** Restore the verified upstream commit from the source-only bundle before the normal build. */
import { join } from 'node:path'
import { root, runtime, pin, run, assertPinnedRuntime } from './common.mjs'
run('git', ['clone', '--no-checkout', join(root, '.container/runtime.bundle'), runtime])
run('git', ['remote', 'set-url', 'origin', pin.repository], { cwd: runtime })
run('git', ['checkout', '--detach', pin.commit], { cwd: runtime })
assertPinnedRuntime()
