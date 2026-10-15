/** Run exactly the same artifacts on every qualified DSH revision, sequentially. */
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { root, run } from './common.mjs'
import { compatibility } from './compatibility.mjs'

const files = ['package', 'feishu-package', 'infoflow-package'].map(name => {
  const info = JSON.parse(readFileSync(join(root, `dist/${name}-info.json`), 'utf8'))
  return join(root, 'dist', info.file)
})
const hashes = () => files.map(file => createHash('sha256').update(readFileSync(file)).digest('hex'))
const before = hashes()
for (const { version } of compatibility.tested) {
  console.log(`Testing unchanged release archives on DSH ${version}`)
  run(process.execPath, ['--test', '--test-concurrency=1', 'scripts/compatibility.test.mjs', 'scripts/package.test.mjs',
    'scripts/install.test.mjs', 'scripts/infoflow-package.test.mjs', 'scripts/infoflow-managed-package.test.mjs',
    'scripts/feishu-package.test.mjs', 'scripts/im-isolation-package.test.mjs'], {
    cwd: root, env: { ...process.env, DSH_BOT_TEST_VERSION: version },
  })
  run(process.execPath, ['scripts/test-client-package.mjs'], { cwd: root, env: { ...process.env, DSH_BOT_TEST_VERSION: version } })
  assert.deepEqual(hashes(), before, 'Compatibility checks must not rebuild or replace an archive.')
}
