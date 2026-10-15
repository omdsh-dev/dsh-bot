/** Credential import accepts platform label variants and does not guess from arbitrary clipboard text. */
import { expect, it } from 'vitest'
import { parseInfoFlowCredentials } from '../src/client/infoflow-credentials.ts'
it.each([
  '应用 ID：11\nApp Key：key\nApp Secret：secret',
  'AppID = 11; AppKey = key; AppSecret = secret',
  '{"agentId":"11","appKey":"key","appSecret":"secret"}',
])('imports labeled credentials without retaining their source text', text => {
  expect(parseInfoFlowCredentials(text)).toEqual({ agentId: '11', appKey: 'key', appSecret: 'secret' })
})
it.each(['secret', 'App Key: key', 'AppID: wrong\nAppKey: key\nAppSecret: secret', 'null'])('rejects incomplete or invalid credentials', text => {
  expect(parseInfoFlowCredentials(text)).toBeNull()
})
