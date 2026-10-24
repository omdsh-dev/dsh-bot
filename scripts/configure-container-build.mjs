/** Bound upstream build workers so a 4 GB Docker VM can compile without changing daemon settings. */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { runtime } from './common.mjs'
const path = join(runtime, 'package.json'), manifest = JSON.parse(readFileSync(path, 'utf8'))
const original = manifest.scripts['build:lib:host']
if (!original.includes('--max-old-space-size=4096')) throw new Error('Pinned DSH build heap flag changed; review the container build adapter.')
manifest.scripts['build:lib:host'] = original.replace('--max-old-space-size=4096', '--max-old-space-size=2048')
writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n')
