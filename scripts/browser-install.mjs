/** Install the Chromium revision matching the shipped, pinned Playwright MCP dependency. */
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { root, runtime, pluginPath, run } from './common.mjs'
const require = createRequire(join(runtime, pluginPath, 'package.json'))
const mcp = require.resolve('@playwright/mcp/package.json')
const playwright = createRequire(mcp).resolve('playwright/package.json')
run(process.execPath, [join(dirname(playwright), 'cli.js'), 'install', 'chromium', ...process.argv.slice(2)], { cwd: root })
