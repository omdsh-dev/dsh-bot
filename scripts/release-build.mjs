/** Verify the source snapshot and generated codecs before admitting any archive. */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { root, runtime, pluginPath, run } from './common.mjs'

export function sourceDigest() {
  const hash = createHash('sha256')
  const visit = (path, name) => {
    hash.update(name)
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const next = join(path, entry.name), relative = `${name}/${entry.name}`
      if (entry.isDirectory()) visit(next, relative)
      else { hash.update(relative); hash.update(readFileSync(next)) }
    }
  }
  visit(join(root, 'plugin/src'), 'src')
  for (const name of ['package.json', 'tsconfig.host.json', 'tsconfig.client.json', 'tsdown.config.ts']) hash.update(readFileSync(join(root, 'plugin', name)))
  for (const name of ['scripts/build-plugin.mjs', 'scripts/setup.mjs', 'scripts/release-build.mjs', 'dsh-version.json', 'integration/dsh-workspace.patch']) {
    hash.update(name); hash.update(readFileSync(join(root, name)))
  }
  return hash.digest('hex')
}

export function provenance() {
  // Source archives and container contexts have no Git metadata. Never present them as clean releases.
  if (!existsSync(join(root, '.git'))) return { commit: null, dirty: true, sourceSha256: sourceDigest() }
  return { commit: run('git', ['rev-parse', 'HEAD'], { cwd: root, stdio: 'pipe' }),
    dirty: !!run('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, stdio: 'pipe' }), sourceSha256: sourceDigest() }
}

export function assertReleaseBuild() {
  const args = process.argv.slice(2)
  if (args.some(arg => arg !== '--allow-dirty')) throw new Error('Only --allow-dirty is supported for local test archives.')
  const source = provenance(), lib = join(runtime, pluginPath, 'lib')
  if (source.dirty && !args.includes('--allow-dirty')) throw new Error('Release requires a clean committed checkout. Use --allow-dirty only for local test archives.')
  const build = JSON.parse(readFileSync(join(lib, 'build-info.json'), 'utf8'))
  if (build.sourceSha256 !== source.sourceSha256) throw new Error('Stale build; run npm run build:plugin.')
  for (const entry of ['typert.host.js', 'typert.remote-client.js']) {
    const code = readFileSync(join(lib, entry), 'utf8')
    const factories = [...code.matchAll(/^\s*create: [\w$]+,$/gm)].length
    if (!factories || [...code.matchAll(/get schema\(\)/g)].length !== factories) throw new Error(`${entry} lacks DSH 0.1 schema getters; run npm run build:plugin.`)
  }
  return source
}
