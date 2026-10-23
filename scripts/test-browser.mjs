/** Real browser cookie-isolation checks through the shipped Host archive on loopback pages. */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { root, run } from './common.mjs'
const candidates = [process.env.DSH_BOT_BROWSER_EXECUTABLE, process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ...['PROGRAMFILES', 'PROGRAMFILES(X86)', 'LOCALAPPDATA'].flatMap(name => process.env[name] ? [join(process.env[name], 'Google/Chrome/Application/chrome.exe'), join(process.env[name], 'Microsoft/Edge/Application/msedge.exe')] : []),
]
const executable = candidates.find(path => path && existsSync(path))
if (!executable) throw new Error('Set DSH_BOT_BROWSER_EXECUTABLE to an installed Chromium/Chrome/Edge executable for this integration check.')
run(process.execPath, ['--test', 'scripts/package.test.mjs'], { cwd: root, env: { ...process.env, DSH_BOT_BROWSER_EXECUTABLE: executable } })
