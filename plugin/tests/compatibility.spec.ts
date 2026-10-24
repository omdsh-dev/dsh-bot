import { toolResultPayload } from '../src/compatibility.ts'
import { expect, it } from 'vitest'
import { checkHost, checkAgent, checkClient, checkIM, requireConnectorProtocol, CONNECTOR_PROTOCOL } from '../src/compatibility.ts'

it('reports a changed Host interface before storage is opened', () => {
  let opened = false
  expect(() => checkHost({ storageDomain: { open: () => { opened = true } } })).toThrow('sessionController.create')
  expect(opened).toBe(false)
})

it('names missing Agent, Client and IM operations rather than treating a version as proof', () => {
  expect(() => checkAgent({ followup: 'removed' })).toThrow('Agent is missing followup')
  expect(() => checkClient({ remote: null })).toThrow('remote.$mount')
  expect(() => checkIM({ credentials: { resolve: () => {} } })).toThrow('credentials.set')
})


it('reads native tool results from both public message formats', () => {
  const content = [{ type: 'text', text: 'verified result' }]
  expect(toolResultPayload({ role: 'tool', toolCallId: 'call', content })).toEqual({ callId: 'call', content })
  expect(toolResultPayload({ role: 'user', content: [{ type: 'tool-result', toolCallId: 'call', content }] })).toEqual({ callId: 'call', content })
  expect(toolResultPayload({ role: 'user', content })).toBeUndefined()
})

it('blocks older connector snapshot readers before granting access to queues', () => {
  expect(() => requireConnectorProtocol(undefined)).toThrow('Upgrade Feishu')
  expect(() => requireConnectorProtocol(1)).toThrow('Upgrade Feishu')
  expect(() => requireConnectorProtocol(CONNECTOR_PROTOCOL)).not.toThrow()
})
