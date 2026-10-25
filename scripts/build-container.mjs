/** Dependencies are already installed in the cached image layer; build the prepared source. */
import { join } from 'node:path'
import { root, runtime, run, assertPinnedRuntime, requireNode } from './common.mjs'
requireNode()
assertPinnedRuntime()
if (process.env.DSH_BOT_CONTAINER_BUILD !== '1') throw new Error('Use this entry through the Docker build stage.')
run('pnpm', ['run', 'build'], { cwd: runtime })
run(process.execPath, [join(root, 'scripts/build-plugin.mjs')], { cwd: root })
