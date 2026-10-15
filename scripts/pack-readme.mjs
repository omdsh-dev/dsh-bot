/** Package the maintained guide with repository links that also work on npm. */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { root } from './common.mjs'

/** @param source - Repository-relative Markdown path. @param destination - Output README path. */
export function writePackageReadme(source, destination) {
  const base = new URL(source, 'https://github.com/zzzpyyy/dsh-bot/blob/main/')
  const markdown = readFileSync(join(root, source), 'utf8')
  const linked = markdown.replace(/\]\(([^\s)]+)\)/g, (match, target) => {
    if (/^(?:[a-z][a-z\d+.-]*:|#|\/\/)/i.test(target)) return match
    return `](${new URL(target, base).href})`
  })
  writeFileSync(destination, linked)
}
