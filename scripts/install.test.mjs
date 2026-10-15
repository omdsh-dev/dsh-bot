/** Qualify the release archives with DSH's actual plugin installer before publication. */
import { test } from 'node:test'
import { desktopModule } from './package-fixture.mjs'
import { verifyInstallation } from './install-fixture.mjs'

test('base and Feishu archives install through the plugin manager and run in Desktop', { timeout: 240000 }, async t => {
  const { DesktopProjectManager } = await desktopModule('project-manager')
  if (DesktopProjectManager.prototype.mutate) {
    t.skip('DSH 0.1 Desktop accepts registry versions only; use test:registry after publication. Archive loading is checked by test:package.')
    return
  }
  await verifyInstallation()
})
