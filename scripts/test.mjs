/** Run the plugin's source tests and real built-profile restart smoke in its owning workspace. */
import { runTool, pluginPath, requireNode, assertPinnedRuntime } from './common.mjs'
requireNode()
assertPinnedRuntime()
runTool('vitest', ['run', `${pluginPath}/tests`])
