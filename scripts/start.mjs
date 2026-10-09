/** Launch the actual DSH Web profile with Bot Mode and a separate default data directory. */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { root, runtime, pluginPath, requireNode, assertPinnedRuntime } from './common.mjs'

requireNode()
const cli = join(runtime, 'apps/cli/lib/bin.js')
if (!existsSync(cli) || !existsSync(join(runtime, pluginPath, 'lib/client.js'))) {
  throw new Error('DSH Bot is not built. Run npm run setup first.')
}
assertPinnedRuntime()
const data = resolve(process.env.DSH_HOME || join(root, '.data'))
const cwd = resolve(process.env.DSH_BOT_WORKDIR || join(data, 'workspace'))
if (process.env.DSH_BOT_WORKDIR && !existsSync(cwd)) throw new Error(`Working directory does not exist: ${cwd}`)
mkdirSync(cwd, { recursive: true })
const args = process.argv.slice(2)
const hasPort = args.some(arg => arg === '--port' || arg.startsWith('--port='))
const child = spawn(process.execPath, [cli, '--profile', 'web', '--patch', join(runtime, pluginPath, 'cordis.patch.yml'),
  ...args, ...(!hasPort ? ['--port', '3093'] : [])], {
  cwd, env: { ...process.env, DSH_HOME: data }, stdio: 'inherit',
})
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1) })
