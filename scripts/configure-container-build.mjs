/** Bound upstream build workers so a 4 GB Docker VM can compile without changing daemon settings. */
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { runtime } from './common.mjs'
const path = join(runtime, 'package.json'), manifest = JSON.parse(readFileSync(path, 'utf8'))
const original = manifest.scripts['build:lib:host']
if (!original.includes('--max-old-space-size=4096')) throw new Error('Pinned DSH build heap flag changed; review the container build adapter.')
manifest.scripts['build:lib:host'] = original.replace('--max-old-space-size=4096', '--max-old-space-size=2048')
writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n')
// The upstream aggregates include thousands of test files. The main CI job checks those;
// container compilation checks the production roots and all their transitive imports.
const ts = createRequire(join(runtime, 'package.json'))('typescript')
for (const name of ['tsconfig.host.json', 'tsconfig.client.json']) {
  const path = join(runtime, name)
  const { config, error } = ts.readConfigFile(path, file => readFileSync(file, 'utf8'))
  if (error) throw new Error(`Cannot parse the pinned ${name}`)
  config.exclude = [...new Set([...(config.exclude ?? []), '**/tests/**', '**/__tests__/**', 'benchmarks/**'])]
  writeFileSync(path, JSON.stringify(config, null, 2) + '\n')
}
