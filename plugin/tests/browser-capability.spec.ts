import { expect, it, vi } from 'vitest'
import { isolatedBrowser } from '../src/browser-capability.ts'

it('pins isolated launch flags and clears inherited profile and CDP environment overrides', () => {
  vi.stubEnv('PLAYWRIGHT_MCP_CDP_ENDPOINT', 'http://127.0.0.1:1')
  vi.stubEnv('PLAYWRIGHT_MCP_USER_DATA_DIR', '/unrelated/profile')
  try {
    const config = isolatedBrowser({ name: 'browser', revision: 1, description: '', kind: 'browser', botIds: [] })
    expect(config.command).toBe(process.execPath)
    expect(config.args.slice(1)).toEqual(['--browser', 'chromium', '--isolated', '--headless'])
    expect(config.env).toMatchObject({ PLAYWRIGHT_MCP_CDP_ENDPOINT: '', PLAYWRIGHT_MCP_USER_DATA_DIR: '' })
  } finally { vi.unstubAllEnvs() }
})
