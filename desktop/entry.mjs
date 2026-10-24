/** Small entry into the unmodified native DSH Electron shell. No renderer bridge is added. */
import { app } from 'electron'
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
const config = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'launcher.json'), 'utf8'))
app.setName('DSH Bots')
app.setAppPath(config.nativeApp)
mkdirSync(join(config.home, 'electron'), { recursive: true })
app.setPath('userData', join(config.home, 'electron'))
process.env.DSH_HOME = config.home
process.env.DSH_DESKTOP_DSH_DIR = config.project
process.env.DSH_DESKTOP_PRIMARY_RUNTIME_DIR = config.primaryRuntime
process.env.DSH_DESKTOP_PNPM_ENTRY = config.pnpm
process.env.DSH_DESKTOP_OPEN_DEVTOOLS = '0'
delete process.env.DSH_DESKTOP_HOST_INSPECT_PORT
await import(pathToFileURL(join(config.nativeApp, 'lib/main.js')).href)
