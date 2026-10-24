/** Bound upstream build workers so a 4 GB Docker VM can compile without changing daemon settings. */
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { runtime } from './common.mjs'
const path = join(runtime, 'package.json'), manifest = JSON.parse(readFileSync(path, 'utf8'))
const original = manifest.scripts['build:lib:host']
if (!original.includes('--max-old-space-size=4096')) throw new Error('Pinned DSH build heap flag changed; review the container build adapter.')
manifest.scripts['build:lib:host'] = original.replace('--max-old-space-size=4096', '--max-old-space-size=2048')
// The upstream aggregates include thousands of test files. The main CI job checks those;
// container compilation checks the production roots and all their transitive imports.
const ts = createRequire(join(runtime, 'package.json'))('typescript')
for (const face of ['host', 'client']) {
  const name = `tsconfig.${face}.json`, output = `tsconfig.container-${face}.json`
  const { config, error } = ts.readConfigFile(join(runtime, name), file => readFileSync(file, 'utf8'))
  if (error) throw new Error(`Cannot parse the pinned ${name}`)
  config.exclude = [...new Set([...(config.exclude ?? []), '**/tests/**', '**/__tests__/**', 'benchmarks/**'])]
  // Preserve the patched upstream configs so setup can still verify the integration patch.
  writeFileSync(join(runtime, output), JSON.stringify(config, null, 2) + '\n')
  const script = `build:lib:${face}`
  if (!manifest.scripts[script].includes(name)) throw new Error(`Pinned ${script} no longer checks ${name}`)
  manifest.scripts[script] = manifest.scripts[script].replace(name, output)
}
writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n')
