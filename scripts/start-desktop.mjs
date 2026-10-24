/** Launch native Desktop without the upstream development launcher's inspector ports. */
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { root, runtime, run, requireNode } from './common.mjs'
requireNode()
if (!['darwin', 'win32'].includes(process.platform)) throw new Error('Native Desktop supports macOS and Windows. Use npm start or Docker on Linux.')
if (process.argv.slice(2).some(arg => arg !== '--prepare-only')) throw new Error('Usage: npm run desktop [-- --prepare-only]')
const require = createRequire(join(runtime, 'apps/desktop/package.json'))
const manifest = require.resolve('electron/package.json')
try { require('electron') } catch {
  run(process.execPath, [join(resolve(manifest, '..'), 'install.js')])
}
run(process.execPath, ['--import', pathToFileURL(require.resolve('tsx/esm')).href, join(root, 'scripts/desktop-prepare.mjs')])
if (!process.argv.includes('--prepare-only')) {
  const home = resolve(process.env.DSH_HOME || join(root, '.data/desktop'))
  const build = join(root, '.runtime/bot-desktop', createHash('sha256').update(home).digest('hex').slice(0, 16))
  const config = JSON.parse(readFileSync(join(build, 'launch.json'), 'utf8'))
  const environment = { ...process.env }; delete environment.ELECTRON_RUN_AS_NODE
  const child = spawn(config.electron, [config.app], { cwd: root, env: environment, stdio: 'inherit' })
  child.on('error', error => { console.error(error.message); process.exitCode = 1 })
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
  child.once('exit', code => { process.exitCode = code ?? 1 })
}
