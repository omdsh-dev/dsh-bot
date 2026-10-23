import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import type { BotCapability } from './access-types.ts'

/** A fresh in-memory profile per delivery; cannot attach to an existing browser. */
export function isolatedBrowser(item: BotCapability): { transport: 'stdio'; command: string; args: string[]; env: Record<string, string> } {
  const cli = join(dirname(createRequire(import.meta.url).resolve('@playwright/mcp/package.json')), 'cli.js')
  const args = [cli, '--browser', 'chromium', '--isolated', '--headless']
  if (item.executablePath) args.push('--executable-path', item.executablePath)
  // Clear upstream environment overrides that could select CDP, extensions or a stored profile.
  const env = Object.fromEntries(Object.keys(process.env).filter(key => key.toUpperCase().startsWith('PLAYWRIGHT_MCP_')).map(key => [key, '']))
  return { transport: 'stdio', command: process.execPath, args, env }
}
