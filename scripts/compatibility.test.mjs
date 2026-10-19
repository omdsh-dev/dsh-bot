/** Check actual shipped peer ranges against the selected runtime and later releases. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { root, run, workspacePackages } from './common.mjs'
import { runtime, target } from './test-runtime.mjs'
import { compatibility } from './compatibility.mjs'

const { satisfies } = createRequire(join(runtime, 'apps/desktop/package.json'))('semver')
test(`all three archives accept DSH ${target.version} without exact host pins`, () => {
  const packages = workspacePackages(runtime)
  for (const name of ['package', 'feishu-package', 'infoflow-package']) {
    const info = JSON.parse(readFileSync(join(root, `dist/${name}-info.json`), 'utf8'))
    const manifest = JSON.parse(run('tar', ['-xOf', join(root, 'dist', info.file), 'package/package.json'], { stdio: 'pipe' }))
    for (const [peer, range] of Object.entries(manifest.peerDependencies)) {
      if (peer.startsWith('@zzzpyyy/')) continue
      const actual = packages.get(peer)?.version
      assert.ok(actual, `Missing runtime peer ${peer}`)
      assert.ok(satisfies(actual, range), `${name}: ${peer}@${actual} must satisfy ${range}`)
    }
    assert.equal(manifest.peerDependencies['@deepseek-ai/dsh'], compatibility.dsh)
    for (const version of ['0.1.6', '0.2.1', '0.3.0-rc.1', '1.0.0', '2.0.0']) {
      // Newer DSH's admission check includes prereleases; acceptance is not qualification.
      assert.ok(satisfies(version, manifest.peerDependencies['@deepseek-ai/dsh'], { includePrerelease: true }))
    }
    assert.ok(!satisfies('0.1.4', manifest.peerDependencies['@deepseek-ai/dsh'], { includePrerelease: true }))
    if (name !== 'package') {
      assert.ok(satisfies('0.8.1', manifest.peerDependencies['@zzzpyyy/dsh-bot']))
      assert.ok(!satisfies('0.7.1', manifest.peerDependencies['@zzzpyyy/dsh-bot']), 'Group handoffs require the 0.8 Host contract')
      assert.ok(!satisfies('1.0.0', manifest.peerDependencies['@zzzpyyy/dsh-bot']))
    }
  }
})
