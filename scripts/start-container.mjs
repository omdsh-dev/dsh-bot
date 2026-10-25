/** Use the Docker host network while retaining native loopback-only listening and authentication. */
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { runtime, pluginPath } from './common.mjs'
const cwd = process.env.DSH_BOT_WORKDIR || '/workspace'
mkdirSync(cwd, { recursive: true })
const child = spawn(process.execPath, [join(runtime, 'apps/cli/lib/bin.js'), '--profile', 'web', '--patch', join(runtime, pluginPath, 'cordis.patch.yml'),
  '--host', '127.0.0.1', '--port', process.env.DSH_BOT_PORT || '3093', '--trusted-host', '127.0.0.1', '--trusted-host', 'localhost', '--no-open'], { cwd, env: process.env, stdio: 'inherit' })
child.once('error', error => { console.error(error.message); process.exitCode = 1 })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.once('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1) })
