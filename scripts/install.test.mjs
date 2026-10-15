/** Qualify the release archives with DSH's actual plugin installer before publication. */
import { test } from 'node:test'
import { verifyInstallation } from './install-fixture.mjs'

test('base and Feishu archives install through the plugin manager and run in Desktop', { timeout: 240000 }, () => verifyInstallation())
