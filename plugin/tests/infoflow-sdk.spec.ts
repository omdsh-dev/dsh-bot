/** SDK adapter contract, connection retries, and callback shutdown without live credentials. */
import { EventEmitter } from 'node:events'
import { afterEach, expect, it, vi } from 'vitest'
import { InfoFlowTransport, robotApi, type TransportConfig } from '../src/infoflow/sdk.ts'
import type { Delivery } from '../src/infoflow/domain.ts'

afterEach(() => { vi.useRealTimers() })
const config: TransportConfig = { accountId: 'app', robotId: 'robot', appKey: 'fixture-key', appSecret: 'fixture-secret',
  baseUrl: '', wsGateway: '', wsConnectDomain: '', endpointTimeoutMs: 100, sendTimeoutMs: 100, connectRetryMs: 10, maxConnectRetryMs: 20 }
function bench(receive = vi.fn(async (_input: unknown) => {})) {
  const user = vi.fn(async (..._args: unknown[]) => ({}))
  const group = vi.fn(async (..._args: unknown[]) => ({}))
  const connect = vi.fn(async () => {})
  const disconnect = vi.fn()
  const handlers = new Map<string, (event: unknown) => void>()
  const emitter = new EventEmitter()
  const sdk = {
    Client: class { im = { message: { sendToUser: user, sendToGroupWithOptions: group } } },
    WSClient: class { eventDispatcher = emitter; connect = connect; disconnect = disconnect; on(event: string, callback: (event: unknown) => void) { handlers.set(event, callback) } },
  }
  const report = vi.fn()
  const status = vi.fn()
  return { sdk, transport: new InfoFlowTransport(sdk, config, receive, report, status), user, group, connect, disconnect, handlers, emitter, receive, report, status }
}
function delivery(kind: 'private' | 'group'): Delivery {
  return { id: 'chunk-1', conversation: { provider: 'infoflow', accountId: 'app', kind, id: '9223372036854775807' }, user: 'alice', text: 'hello', attempts: 0, nextAt: 0 }
}

it('uses distinct private/group Markdown formats and preserves recipient IDs', async () => {
  const b = bench()
  await b.transport.send(delivery('private')); await b.transport.send(delivery('group'))
  expect(b.user).toHaveBeenCalledWith('9223372036854775807', 'hello', 'md')
  expect(b.group).toHaveBeenCalledWith({ groupId: '9223372036854775807', msgtype: 'MD', body: [{ type: 'AT', atall: false, atuserids: ['alice'] }, { type: 'MD', content: 'hello' }] })
  await b.transport.close()
})

it('retries initial connection failure and stops retries when disposed', async () => {
  vi.useFakeTimers()
  const b = bench(); b.connect.mockRejectedValueOnce(new Error('endpoint unavailable'))
  b.transport.start(); await vi.advanceTimersByTimeAsync(10)
  expect(b.connect).toHaveBeenCalledTimes(2)
  expect(b.status).toHaveBeenCalledWith('error')
  await b.transport.close(); await vi.advanceTimersByTimeAsync(200)
  expect(b.connect).toHaveBeenCalledTimes(2)
  expect(b.disconnect).toHaveBeenCalled()
  expect(() => b.emitter.emit('error', new Error('late close'))).not.toThrow()
})

it('contains ingress failures and drains accepted callbacks before close', async () => {
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  const receive = vi.fn(async (_input: unknown) => { await pending; throw new Error('secret payload must not be logged') })
  const b = bench(receive)
  b.handlers.get('private.text')!({ data: { raw: { FromUserId: 'alice', MsgId: '1', Content: 'hello' } } })
  let closed = false
  const closing = b.transport.close().then(() => { closed = true })
  await Promise.resolve(); expect(closed).toBe(false)
  release(); await closing
  expect(b.report.mock.calls.flat().join(' ')).not.toContain('secret payload')
  b.handlers.get('private.text')!({ data: { raw: { FromUserId: 'alice', MsgId: '2', Content: 'late' } } })
  expect(receive).toHaveBeenCalledTimes(1)
})

it('treats an unconfirmed send as uncertain delivery after a bounded wait', async () => {
  vi.useFakeTimers()
  const b = bench(); b.user.mockImplementation(() => new Promise(() => {}))
  const failure = expect(b.transport.send(delivery('private'))).rejects.toThrow('confirmation timed out')
  await vi.advanceTimersByTimeAsync(100); await failure
  await b.transport.close()
})

it('sends a fixed test and translates visibility errors without exposing SDK details', async () => {
  const b = bench()
  const api = robotApi(b.sdk, { appKey: 'fixture-key', appSecret: 'fixture-secret', agentId: '11', timeout: 100 })
  await api.testMessage('alice')
  expect(b.user).toHaveBeenCalledWith('alice', expect.stringContaining('DSH 如流连接测试'), 'text')
  b.user.mockRejectedValueOnce(new Error('InfoFlow API Error: private-secret (errcode: 40070)'))
  await expect(api.testMessage('alice')).rejects.toThrow('可见范围或未关注')
  b.user.mockRejectedValueOnce(new Error('private-secret expired'))
  await expect(api.testMessage('alice')).rejects.toThrow('测试消息未确认送达')
  await b.transport.close()
})
