/** Exercise the real native Electron window, UI mutation, restart and sandbox settings. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { root, runtime, pluginPath, run } from './common.mjs'
const home = mkdtempSync(join(tmpdir(), 'dsh-bot-electron-'))
const build = join(root, '.runtime/bot-desktop', createHash('sha256').update(home).digest('hex').slice(0, 16))
const require = createRequire(join(runtime, pluginPath, 'package.json'))
const { _electron } = createRequire(require.resolve('@playwright/mcp/package.json'))('playwright')
const environment = { ...process.env, DSH_HOME: home }; delete environment.ELECTRON_RUN_AS_NODE
try {
  run(process.execPath, [join(root, 'scripts/start-desktop.mjs'), '--prepare-only'], { env: environment })
  const config = JSON.parse(readFileSync(join(build, 'launch.json'), 'utf8'))
  for (const phase of ['create', 'restart']) {
    const app = await _electron.launch({ executablePath: config.electron, args: [config.app], env: environment, timeout: 60000 })
    const child = app.process()
    try {
      let page
      const deadline = Date.now() + 60000
      while (Date.now() < deadline) {
        const welcome = app.windows().find(window => window.url().includes('welcome.html'))
        if (welcome) {
          await welcome.locator('#api-key').click({ timeout: 30000 })
          await welcome.locator('#skip-key').click()
          page = app.windows().find(window => window.url() === 'dsh-app://app/')
          break
        }
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      assert.ok(page, 'The native welcome flow must enter its real workspace')
      await page.getByText('DSH Bots', { exact: true }).click({ timeout: 60000 })
      const settings = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => window.webContents.getLastWebPreferences()))
      for (const item of settings) {
        assert.equal(item.contextIsolation, true); assert.equal(item.nodeIntegration, false); assert.equal(item.sandbox, true)
      }
      assert.equal(await app.evaluate(() => process.env.DSH_HOME), home)
      if (phase === 'create') {
        await page.getByRole('button', { name: /^(Create Bot|创建 Bot)$/ }).first().click()
        const dialog = page.getByRole('dialog')
        await dialog.getByLabel(/Display name|显示名称/).fill('Desktop persistence')
        await dialog.getByLabel(/Bot handle|Bot 标识/).fill('desktop-check')
        await dialog.getByLabel(/Identity and responsibilities|身份与职责/).fill('Local native-window acceptance; no model request is needed.')
        await dialog.getByRole('button', { name: /^(Create|创建)$/ }).click()
        await dialog.waitFor({ state: 'hidden' })
      }
      await page.getByRole('button', { name: 'Desktop persistence @desktop-check', exact: true }).waitFor({ timeout: 15000 })
      await page.getByRole('button', { name: /^(Usage|用量)$/ }).click()
      await page.getByText(/Call ledger|调用账本/, { exact: true }).waitFor({ timeout: 15000 })
      assert.equal(await page.getByRole('alert').count(), 0)
      mkdirSync(join(root, '.runtime/acceptance'), { recursive: true })
      await page.screenshot({ path: join(root, `.runtime/acceptance/desktop-${phase}.png`) })
    } finally { await app.close() }
    assert.equal(child.exitCode, 0, 'Native Desktop must stop its Host cleanly')
  }
  console.log('Native Electron onboarding, sandboxed UI, Bot creation, usage page and restart persistence passed.')
} finally {
  rmSync(home, { recursive: true, force: true })
  rmSync(build, { recursive: true, force: true })
}
