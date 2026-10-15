/** Package the optional connector without adding a private SDK dependency to the base plugin. */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { copyHostEntry } from './pack-host-entry.mjs'
import { root, runtime, pin, pluginPath, run, requireNode, assertPinnedRuntime, workspacePackages } from './common.mjs'

requireNode()
assertPinnedRuntime()
const release = JSON.parse(readFileSync(join(root, 'feishu/release.json'), 'utf8'))
const base = JSON.parse(readFileSync(join(root, 'release.json'), 'utf8'))
const source = join(runtime, pluginPath, 'lib/feishu.js')
if (!existsSync(source)) throw new Error('Build the optional connector with npm run build:plugin first.')
const destination = join(root, 'dist/feishu-package')
rmSync(destination, { recursive: true, force: true })
mkdirSync(destination, { recursive: true })
const bundleFiles = copyHostEntry(source, destination)
const workspaces = workspacePackages()
const peers = ['@deepseek-ai/cordis', '@deepseek-ai/schemastery', '@deepseek-ai/dsh-brand', '@deepseek-ai/dsh-credentials', '@deepseek-ai/dsh-storage-domain', '@deepseek-ai/dsh']
const peerDependencies = { [base.name]: base.version, ...Object.fromEntries(peers.map(name => {
  const version = workspaces.get(name)?.version
  if (!version) throw new Error(`Missing pinned peer ${name}`)
  return [name, version]
})) }
const manifest = { ...release, type: 'module', license: 'MIT', description: 'Optional Feishu text connector for DSH Bot',
  engines: { node: '^22.19.0 || >=24.0.0' }, repository: { type: 'git', url: 'git+https://github.com/zzzpyyy/dsh-bot.git' },
  files: [...bundleFiles, 'cordis.patch.yml', 'cordis.patch.example.yml', 'README.md', 'LICENSE', 'compatibility.json'],
  dsh: { bundle: { patch: './cordis.patch.yml' } },
  dependencies: { '@larksuiteoapi/node-sdk': '1.75.0', qrcode: '1.5.4', zod: '4.4.3' }, peerDependencies }
writeFileSync(join(destination, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
writeFileSync(join(destination, 'cordis.patch.yml'), '- insert:\n    - id: bot-feishu\n      name: ./feishu.js\n')
writeFileSync(join(destination, 'compatibility.json'), `${JSON.stringify({ dsh: pin.version, commit: pin.commit, botMode: base, feishu: release }, null, 2)}\n`)
for (const [from, to] of [['docs/feishu.zh.md', 'README.md'], ['feishu/cordis.patch.example.yml', 'cordis.patch.example.yml'], ['LICENSE', 'LICENSE']]) cpSync(join(root, from), join(destination, to))
const packed = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', join(root, 'dist')], { cwd: destination, stdio: 'pipe' }))[0]
writeFileSync(join(root, 'dist/feishu-package-info.json'), `${JSON.stringify({ ...release, file: packed.filename, integrity: packed.integrity, dsh: pin.version }, null, 2)}\n`)
console.log(`Packed optional connector: dist/${packed.filename}; management page ready; robot connections require explicit enablement.`)
