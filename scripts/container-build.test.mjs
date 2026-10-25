/** Exercise generated container configs against the actual pinned upstream project graph. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { root, runtime, run } from './common.mjs'

test('container type checks retain project references and exclude test entrypoints without changing upstream configs', () => {
  const files = ['package.json', 'tsconfig.host.json', 'tsconfig.client.json', 'tsconfig.container-host.json', 'tsconfig.container-client.json']
  const saved = new Map(files.map(name => [name, existsSync(join(runtime, name)) ? readFileSync(join(runtime, name)) : undefined]))
  const ts = createRequire(join(runtime, 'package.json'))('typescript')
  const config = name => ts.readConfigFile(join(runtime, name), ts.sys.readFile).config
  try {
    run(process.execPath, [join(root, 'scripts/configure-container-build.mjs')])
    for (const face of ['host', 'client']) {
      const original = `tsconfig.${face}.json`, generated = `tsconfig.container-${face}.json`
      assert.deepEqual(readFileSync(join(runtime, original)), saved.get(original), 'Setup must still be able to verify the upstream integration patch')
      assert.deepEqual(config(generated).references, config(original).references, 'Every production project must still be built')
      const roots = ts.parseJsonConfigFileContent(config(generated), ts.sys, runtime).fileNames.map(file => file.replaceAll('\\', '/'))
      assert.ok(!roots.some(file => file.endsWith('/apps/web/stress-tests/reasoning-chunks.stress.ts')), 'A stress test must not import excluded Web test helpers')
      assert.ok(!roots.some(file => file.endsWith('/scripts/python-snapshot-workflow-order.spec.ts')), 'Script tests must not import excluded Agent test helpers')
      if (face === 'host') assert.ok(roots.some(file => file.endsWith('/apps/web/product-isolation.ts')), 'Production surface checks must remain included')
    }
    run('git', ['apply', '--reverse', '--check', join(root, 'integration/dsh-workspace.patch')], { cwd: runtime, stdio: 'pipe' })
  } finally {
    for (const [name, content] of saved) {
      if (content) writeFileSync(join(runtime, name), content)
      else rmSync(join(runtime, name), { force: true })
    }
  }
})
