/** Only the test driver is copied into the runtime; the Client comes from the release archive. */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { root, run } from './common.mjs'
import { runtime } from './test-runtime.mjs'

const scratch = mkdtempSync(join(tmpdir(), 'dsh-bot-client-'))
const fixture = join(runtime, 'packages/experimental/bot-archive-test')
try {
  const info = JSON.parse(readFileSync(join(root, 'dist/package-info.json'), 'utf8'))
  run('tar', ['-xzf', join(root, 'dist', info.file), '-C', scratch])
  mkdirSync(join(fixture, 'tests'), { recursive: true })
  symlinkSync(join(runtime, 'packages/client/ui-primitives/node_modules'), join(fixture, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')
  cpSync(join(root, 'scripts/client-package.fixture.tsx'), join(fixture, 'tests/archive.client.spec.tsx'))
  run(join(runtime, 'node_modules/.bin/vitest'), ['run', 'packages/experimental/bot-archive-test/tests/archive.client.spec.tsx'], {
    cwd: runtime, env: { ...process.env, BOT_CLIENT_FILE: join(scratch, 'package/implementation/lib/client.js') },
  })
} finally {
  rmSync(scratch, { recursive: true, force: true })
  rmSync(fixture, { recursive: true, force: true })
}
