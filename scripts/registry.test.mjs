/** Opt-in post-publication check against the public npm registry. */
import { test } from 'node:test'
import { verifyInstallation } from './install-fixture.mjs'

test('published base and Feishu packages install through the plugin manager and run in Desktop', { timeout: 240000 }, () => verifyInstallation(true))
