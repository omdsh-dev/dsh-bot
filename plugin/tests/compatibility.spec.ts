import { expect, it } from 'vitest'
import { checkHost, checkAgent, checkClient, checkIM } from '../src/compatibility.ts'

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
