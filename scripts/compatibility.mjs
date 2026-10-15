/** Installation policy is independent of the reproducible build revision. */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { root, pin, workspacePackages } from './common.mjs'

export const compatibility = JSON.parse(readFileSync(join(root, 'compatibility.json'), 'utf8'))

export function hostPeers(names) {
  const packages = workspacePackages()
  return Object.fromEntries([...new Set(names)].sort().map(name => {
    if (!packages.has(name)) throw new Error(`Build runtime has no shared package ${name}`)
    const range = name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-')
      ? compatibility.dsh : compatibility.peers[name]
    if (!range) throw new Error(`Declare a compatibility range for ${name}`)
    return [name, range]
  }))
}

export function releaseCompatibility(packages) {
  return { dsh: compatibility.dsh, tested: compatibility.tested, builtWith: pin, ...packages }
}
