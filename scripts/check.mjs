/** Check portable metadata, distribution contents, and relative Markdown links. */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { root, pin } from './common.mjs'

const metadata = JSON.parse(readFileSync(join(root, 'plugin/package.json'), 'utf8'))
assert.equal(metadata.version, pin.version)
assert.equal(metadata.private, true, 'The internal workspace package is not an npm release.')
assert.match(pin.commit, /^[a-f0-9]{40}$/)
for (const directory of ['scripts', 'plugin', 'docs', 'integration', 'infoflow', 'feishu']) {
  const visit = folder => {
    for (const item of readdirSync(folder, { withFileTypes: true })) {
      const file = join(folder, item.name)
      assert.ok(!item.isSymbolicLink(), `Unexpected symlink: ${file}`)
      if (item.isDirectory()) { visit(file); continue }
      const content = readFileSync(file, 'utf8')
      assert.ok(!content.includes('/Users/'), `Local user path in ${file}`)
      assert.ok(!content.includes('BEGIN PRIVATE KEY'), `Private key in ${file}`)
    }
  }
  // This checker names the patterns above; inspect only its distributed peers.
  if (directory !== 'scripts') visit(join(root, directory))
}
for (const relative of ['README.md', 'README.zh.md', ...readdirSync(join(root, 'docs')).filter(p => p.endsWith('.md')).map(p => `docs/${p}`)]) {
  const file = join(root, relative)
  const text = readFileSync(file, 'utf8')
  for (const match of text.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
    if (/^(https?:|mailto:)/.test(match[1])) continue
    assert.ok(existsSync(resolve(dirname(file), match[1])), `Broken link in ${relative}: ${match[1]}`)
  }
}
console.log('Distribution metadata and local documentation links pass.')
