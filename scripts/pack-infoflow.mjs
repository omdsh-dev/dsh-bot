/** Package the optional connector without adding a private SDK dependency to the base plugin. */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { copyHostEntry } from './pack-host-entry.mjs'
import { compatibility, hostPeers, releaseCompatibility } from './compatibility.mjs'
import { writePackageReadme } from './pack-readme.mjs'
import { assertReleaseBuild } from './release-build.mjs'
import { root, runtime, pin, pluginPath, run, requireNode, assertPinnedRuntime } from './common.mjs'

requireNode()
assertPinnedRuntime()
const provenance = assertReleaseBuild()
const release = JSON.parse(readFileSync(join(root, 'infoflow/release.json'), 'utf8'))
const base = JSON.parse(readFileSync(join(root, 'release.json'), 'utf8'))
const source = join(runtime, pluginPath, 'lib/infoflow.js')
if (!existsSync(source)) throw new Error('Build the optional connector with npm run build:plugin first.')
const destination = join(root, 'dist/infoflow-package')
rmSync(destination, { recursive: true, force: true })
mkdirSync(destination, { recursive: true })
const bundleFiles = copyHostEntry(source, destination)
const peers = ['@deepseek-ai/cordis', '@deepseek-ai/schemastery', '@deepseek-ai/dsh-brand', '@deepseek-ai/dsh-credentials', '@deepseek-ai/dsh-storage-domain', '@deepseek-ai/dsh']
const peerDependencies = { [base.name]: compatibility.bot, ...hostPeers(peers) }
const manifest = { ...release, type: 'module', license: 'MIT', description: 'Optional InfoFlow text connector for DSH Bot',
  engines: { node: '^22.19.0 || >=24.0.0' }, repository: { type: 'git', url: 'git+https://github.com/zzzpyyy/dsh-bot.git' },
  homepage: 'https://github.com/zzzpyyy/dsh-bot/blob/main/docs/infoflow.zh.md', bugs: 'https://github.com/zzzpyyy/dsh-bot/issues',
  keywords: ['deepseek', 'dsh', 'bot', 'infoflow'], publishConfig: { access: 'public' },
  files: [...bundleFiles, 'cordis.patch.yml', 'cordis.patch.example.yml', 'README.md', 'LICENSE', 'compatibility.json'],
  dsh: { bundle: { patch: './cordis.patch.yml' } },
  dependencies: { '@baidu/infoflow-sdk-nodejs': '2026.8.28', zod: '4.4.3' }, peerDependencies }
writeFileSync(join(destination, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
writeFileSync(join(destination, 'cordis.patch.yml'), '- insert:\n    - id: bot-infoflow\n      name: ./infoflow.js\n      config:\n        managed: true\n')
writeFileSync(join(destination, 'compatibility.json'), `${JSON.stringify(releaseCompatibility({ provenance, botMode: { name: base.name, version: compatibility.bot }, infoflow: release }), null, 2)}\n`)
writePackageReadme('docs/infoflow.zh.md', join(destination, 'README.md'))
for (const [from, to] of [['infoflow/cordis.patch.example.yml', 'cordis.patch.example.yml'], ['LICENSE', 'LICENSE']]) cpSync(join(root, from), join(destination, to))
const packed = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', join(root, 'dist')], { cwd: destination, stdio: 'pipe' }))[0]
writeFileSync(join(root, 'dist/infoflow-package-info.json'), `${JSON.stringify({ ...release, file: packed.filename, integrity: packed.integrity, dsh: pin.version }, null, 2)}\n`)
console.log(`Packed optional connector: dist/${packed.filename}; management page ready; robot connections require explicit enablement.`)
