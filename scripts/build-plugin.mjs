/** Incremental plugin build against an already installed pinned workspace, including generated Remote codecs. */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { root, runtime, pluginPath, run, runTool, requireNode, assertPinnedRuntime } from './common.mjs'

requireNode()
assertPinnedRuntime()
run(process.execPath, ['scripts/setup.mjs', '--prepare-only'], { cwd: root })
runTool('tsc', ['-b', `${pluginPath}/tsconfig.host.json`])
runTool('tsdown', ['--env.DSH_BUILD_FACE', 'host', '--filter', pluginPath, '--logLevel', 'warn'])
const { WorkspaceTypertGenerator } = await import(pathToFileURL(join(runtime, 'packages/typert/generator/lib/types/index.js')).href)
const generator = new WorkspaceTypertGenerator(runtime, { checkDiagnostics: false })
for (const artifact of generator.generate(['@deepseek-ai/dsh-experimental-bot-mode'], ['host'])) {
  const output = join(runtime, pluginPath, 'lib')
  writeFileSync(join(output, `typert.${artifact.face}.js`), artifact.js)
  writeFileSync(join(output, `typert.${artifact.face}.d.ts`), artifact.dts)
  if (artifact.remote) {
    writeFileSync(join(output, 'typert.remote-client.js'), artifact.remote.js)
    writeFileSync(join(output, 'typert.remote-client.d.ts'), artifact.remote.dts)
    writeFileSync(join(output, 'typert.remote-client.d.ts.map'), artifact.remote.dtsMap)
  }
}
runTool('tsc', ['-b', `${pluginPath}/tsconfig.client.json`])
runTool('tsdown', ['--env.DSH_BUILD_FACE', 'client', '--filter', pluginPath, '--logLevel', 'warn'])
console.log('Bot Mode and optional InfoFlow/Feishu Host plugins built; Remote codecs refreshed.')
