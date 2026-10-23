/** Pack a registry bundle while preserving the implementation's generated module identity. */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { root, runtime, pin, pluginPath, run, requireNode, assertPinnedRuntime } from './common.mjs'
import { hostPeers, releaseCompatibility } from './compatibility.mjs'
import { writePackageReadme } from './pack-readme.mjs'
import { assertReleaseBuild } from './release-build.mjs'

requireNode()
assertPinnedRuntime()
const provenance = assertReleaseBuild()
const release = JSON.parse(readFileSync(join(root, 'release.json'), 'utf8'))
if (!/^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(release.name)) throw new Error('release.json must name a scoped npm package.')
if (release.version !== JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version) throw new Error('Release and source versions must match.')
const source = join(runtime, pluginPath)
const internal = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
const destination = join(root, 'dist/package')
for (const entry of ['index.js', 'client.js', 'typert.host.js', 'typert.remote-client.js']) {
  if (!existsSync(join(source, 'lib', entry))) throw new Error(`Missing ${entry}; run npm run setup first.`)
}

// ui-slots is declaration-only. Store/primitives are browser platform modules, not Host peers.
const runtimePeers = Object.keys(internal.peerDependencies).filter(name => name !== '@deepseek-ai/dsh-client-ui-slots')
const shared = new Set([...runtimePeers, ...Object.keys(internal.dependencies).filter(name => name.startsWith('@deepseek-ai/')), '@deepseek-ai/dsh'])
const peerDependencies = hostPeers([...shared])
rmSync(destination, { recursive: true, force: true })
mkdirSync(join(destination, 'implementation/lib'), { recursive: true })
cpSync(join(source, 'lib'), join(destination, 'implementation/lib'), {
  recursive: true,
  filter: path => !/\.(?:map|tsbuildinfo)$/.test(path),
})
const implementation = {
  name: internal.name, version: internal.version, private: true, type: 'module',
  main: internal.main, types: internal.types,
  exports: Object.fromEntries(Object.entries(internal.exports).filter(([name]) => name !== './src/*')),
  dsh: internal.dsh, license: 'MIT',
}
writeFileSync(join(destination, 'implementation/package.json'), `${JSON.stringify(implementation, null, 2)}\n`)
const manifest = {
  ...release, description: 'Native multi-Bot chats for DeepSeek Harness Web and Desktop', type: 'module', license: 'MIT',
  repository: { type: 'git', url: 'git+https://github.com/zzzpyyy/dsh-bot.git' },
  homepage: 'https://github.com/zzzpyyy/dsh-bot#readme', bugs: 'https://github.com/zzzpyyy/dsh-bot/issues',
  keywords: ['deepseek', 'dsh', 'bot', 'multi-agent', 'desktop', 'feishu', 'infoflow'],
  engines: { node: '^22.19.0 || >=24.0.0' }, publishConfig: { access: 'public' },
  files: ['implementation/', 'cordis.patch.yml', 'LICENSE', 'NOTICE', 'README.md', 'compatibility.json'],
  dsh: { bundle: { patch: './cordis.patch.yml' } },
  dependencies: { zod: '4.4.3', '@playwright/mcp': '0.0.80' }, peerDependencies,
}
writeFileSync(join(destination, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
writeFileSync(join(destination, 'cordis.patch.yml'), '- insert:\n    - id: bot-mode\n      name: ./implementation/lib/index.js\n')
writeFileSync(join(destination, 'compatibility.json'), `${JSON.stringify(releaseCompatibility({ package: release, provenance }), null, 2)}\n`)
writePackageReadme('README.md', join(destination, 'README.md'))
for (const file of ['LICENSE', 'NOTICE']) cpSync(join(root, file), join(destination, file))
const packed = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', join(root, 'dist')], { cwd: destination, stdio: 'pipe' }))[0]
const file = join(root, 'dist', packed.filename)
const sha256 = createHash('sha256').update(readFileSync(file)).digest('hex')
writeFileSync(join(root, 'dist/package-info.json'), `${JSON.stringify({ ...release, file: packed.filename, sha256, integrity: packed.integrity, dsh: pin.version }, null, 2)}\n`)
writeFileSync(join(root, 'dist/SHA256SUMS'), `${sha256}  ${packed.filename}\n`)
console.log(`Packed ${release.name}@${release.version}: dist/${packed.filename} (${packed.size} bytes)`)
