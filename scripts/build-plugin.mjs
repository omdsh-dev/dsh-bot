/** Incremental plugin build against an already installed pinned workspace, including generated Remote codecs. */
import { readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { root, runtime, pluginPath, run, runTool, requireNode, assertPinnedRuntime } from './common.mjs'
import { provenance } from './release-build.mjs'

requireNode()
assertPinnedRuntime()
run(process.execPath, ['scripts/setup.mjs', '--prepare-only'], { cwd: root })
// Delete only this plugin's generated output, including incremental build metadata.
rmSync(join(runtime, pluginPath, 'lib'), { recursive: true, force: true })
runTool('tsc', ['-b', `${pluginPath}/tsconfig.host.json`])
// tsdown compares its filter with path.relative(), which uses native separators.
runTool('tsdown', ['--env.DSH_BUILD_FACE', 'host', '--filter', join(...pluginPath.split('/')), '--logLevel', 'warn'])
const { WorkspaceTypertGenerator } = await import(pathToFileURL(join(runtime, 'packages/typert/generator/lib/types/index.js')).href)
const generator = new WorkspaceTypertGenerator(runtime, { checkDiagnostics: false })
// DSH 0.1 reads codec.schema; DSH 0.2 uses codec.create(). Share the generated,
// memoized schema factory so both runtimes validate the same boundary values.
const compatibleCodecs = code => code.replace(/^([\t ]*)create: ([\w$]+),$/gm,
  '$1create: $2,\n$1get schema() { return $2() },')
for (const artifact of generator.generate(['@deepseek-ai/dsh-experimental-bot-mode'], ['host'])) {
  const output = join(runtime, pluginPath, 'lib')
  writeFileSync(join(output, `typert.${artifact.face}.js`), compatibleCodecs(artifact.js))
  writeFileSync(join(output, `typert.${artifact.face}.d.ts`), artifact.dts)
  if (artifact.remote) {
    writeFileSync(join(output, 'typert.remote-client.js'), compatibleCodecs(artifact.remote.js))
    writeFileSync(join(output, 'typert.remote-client.d.ts'), artifact.remote.dts)
    writeFileSync(join(output, 'typert.remote-client.d.ts.map'), artifact.remote.dtsMap)
  }
}
runTool('tsc', ['-b', `${pluginPath}/tsconfig.client.json`])
runTool('tsdown', ['--env.DSH_BUILD_FACE', 'client', '--filter', join(...pluginPath.split('/')), '--logLevel', 'warn'])
// Full setup also type-checks tests. Keep incremental local builds on the same gate.
runTool('tsc', ['-b', 'tsconfig.host.json', 'tsconfig.client.json'])
// Bundler region comments can include absolute virtual CSS module paths.
const clean = folder => {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name)
    if (entry.isDirectory()) clean(path)
    else if (/\.(?:js|d\.ts)$/.test(path)) {
      const code = readFileSync(path, 'utf8').replace(/^\s*\/\/#(?:region|endregion).*$/gm, '')
      if (code.includes(root) || /\/Users\/|\/home\/|[A-Z]:\\Users\\/i.test(code)) throw new Error(`Non-portable path in ${entry.name}`)
      writeFileSync(path, code)
    }
  }
}
clean(join(runtime, pluginPath, 'lib'))
writeFileSync(join(runtime, pluginPath, 'lib/build-info.json'), JSON.stringify(provenance(), null, 2))
console.log('Bot Mode and optional InfoFlow/Feishu Host plugins built; Remote codecs refreshed.')
