import { expect, it } from 'vitest'
import { accessFingerprint, credentialNames, credentialRequest, removeAccess, saveCapability, secretRedactor } from '../src/access-state.ts'
import { botDomain } from '../src/domain.ts'

const state = () => botDomain.global.schema.parse({ bots: [{ id: 'a', name: 'A', instructions: '', preset: 'standard' }, { id: 'b', name: 'B', instructions: '', preset: 'standard' }], rooms: [], access: {
  capabilities: [], credentials: [{ name: 'API_TOKEN', revision: 1, description: '', botIds: ['a'], shellBotIds: [], key: 'bot-mode/key-11111111-1111-4111-8111-111111111111' }],
} })
it('requires explicit per-Bot grants, checks revisions and keeps credential transport out of argv and URLs', () => {
  const s = state(), request = { name: 'private-api', kind: 'mcp' as const, transport: 'streamable-http' as const, description: '', botIds: ['a'], url: 'https://example.com/mcp', headers: { Authorization: 'Bearer $DSH_SECRET_API_TOKEN' } }
  expect(saveCapability(s, request)).toMatchObject({ revision: 1, botIds: ['a'] })
  expect(() => saveCapability(s, request)).toThrow('changed')
  expect(() => saveCapability(s, { ...request, revision: 1, botIds: ['b'] })).toThrow('every selected Bot')
  expect(() => saveCapability(s, { ...request, revision: 1, url: 'http://example.com/mcp' })).toThrow('HTTPS')
  expect(() => saveCapability(s, { ...request, revision: 1, url: 'https://example.com/mcp?token=plaintext' })).toThrow('embedded')
  expect(() => saveCapability(s, { ...request, revision: 1, headers: { Authorization: 'Bearer plaintext-value' } })).toThrow('saved credential')
  expect(() => saveCapability(s, { ...request, revision: 1, transport: 'stdio', command: 'node', args: ['$DSH_SECRET_API_TOKEN'] })).toThrow('process arguments')
  const oldB = accessFingerprint(s, 'b'), oldA = accessFingerprint(s, 'a')
  removeAccess(s, { name: 'API_TOKEN', kind: 'credential', revision: 1 })
  expect(accessFingerprint(s, 'b')).toBe(oldB); expect(accessFingerprint(s, 'a')).not.toBe(oldA)
  expect(() => saveCapability(s, { ...request, revision: 1 })).toThrow('every selected Bot')
})
it('separates shell grants, preserves an existing value only for an exact revision and defaults to no grants', () => {
  const s = state()
  expect(credentialRequest(s, { name: 'NEW_TOKEN', description: '', value: 'fixture-secret-value', botIds: [], shellBotIds: [] })).toMatchObject({ botIds: [], shellBotIds: [], revision: 1 })
  expect(() => credentialRequest(s, { name: 'NEW_TOKEN', description: '', botIds: [], shellBotIds: [] })).toThrow('value is required')
  expect(() => credentialRequest(s, { name: 'API_TOKEN', description: '', revision: 1, botIds: ['a'], shellBotIds: ['b'] })).toThrow('subset')
  expect(() => credentialRequest(s, { name: 'API_TOKEN', description: '', botIds: ['a'], shellBotIds: [] })).toThrow('changed')
  expect(credentialRequest(s, { name: 'API_TOKEN', description: '', revision: 1, botIds: ['a'], shellBotIds: ['a'], value: '' }).revision).toBe(2)
})
it('stores isolated-browser grants without accepting user profile, attachment or arbitrary MCP settings', () => {
  const s = state()
  const saved = saveCapability(s, { name: 'browser', kind: 'browser', description: '', botIds: ['a'], command: 'unsafe', args: ['--cdp-endpoint', 'http://localhost:1'], env: { PLAYWRIGHT_MCP_EXTENSION: 'true' } })
  expect(saved).toEqual({ name: 'browser', kind: 'browser', description: '', botIds: ['a'], revision: 1 })
  expect(() => saveCapability(s, { name: 'relative', kind: 'browser', description: '', botIds: [], executablePath: './browser' })).toThrow('absolute')
})
it('recognizes POSIX and PowerShell references and redacts nested content and common encoded forms in one pass', () => {
  expect(credentialNames('$DSH_SECRET_ONE ${DSH_SECRET_TWO} $env:DSH_SECRET_THREE')).toEqual(['ONE', 'TWO', 'THREE'])
  const secret = 'credential/"LONG_SECRET', clean = secretRedactor([['TOKEN', secret], ['OTHER', 'credential']])
  const source = { content: [{ text: secret }], additionalContexts: [{ text: encodeURIComponent(secret) }], value: Buffer.from(secret).toString('base64'), meta: { nested: secret } }
  const result = clean(source)
  expect(JSON.stringify(result)).not.toContain(secret)
  expect(JSON.stringify(result)).not.toContain(encodeURIComponent(secret))
  expect(result.content[0]!.text).toContain('[hidden ')
  expect(clean(result)).toEqual(result)
  expect(source.content[0]!.text).toBe(secret)
})
