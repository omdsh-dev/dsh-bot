/** Managed wiring uses real managers/queues; only the platform transport is replaced. */
import { expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { applyManaged } from '../src/infoflow/managed.ts'
import type { Config } from '../src/infoflow.ts'
import type { BridgeState } from '../src/infoflow/domain.ts'
import type { Incoming } from '../src/infoflow/messages.ts'
import type { RobotApi } from '../src/infoflow/sdk.ts'
import type { InfoFlowManager } from '../src/infoflow/manager.ts'
import type { BotId, Room } from '../src/types.ts'
const fixture = vi.hoisted(() => ({ api: vi.fn<() => Partial<RobotApi>>(() => ({})), transports: [] as { receive(input: Incoming, mentions: string[]): Promise<unknown>; config: { robotIds(): string[] }; send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }[] }))
vi.mock('../src/infoflow/sdk.ts', () => ({
  loadSdk: () => ({}), robotApi: () => fixture.api(),
  InfoFlowTransport: class {
    send = vi.fn(async (_delivery: unknown) => {})
    close = vi.fn(async () => {})
    start() {}
    constructor(_sdk: unknown, readonly config: { robotIds(): string[] }, readonly receive: (input: Incoming, mentions: string[]) => Promise<unknown>) { fixture.transports.push(this) }
  },
}))

it('filters all bound robot identities, isolates a disabled sender, and closes every opened domain', async () => {
  fixture.transports.length = 0
  const bindings = ['alpha', 'beta'].map((botId, index) => ({ botId, agentId: `${index + 11}`, robotId: `${index + 111}`, robotName: botId,
    enabled: index === 0, appKeyRef: `${botId}_key`, appSecretRef: `${botId}_secret`, allowUsers: ['alice'], allowGroups: [], admins: [] }))
  const settings = { bindings, groups: [] }
  let queue: BridgeState = { receipts: [], pending: [], notices: [], outbox: ['beta', 'alpha'].map(botId => ({
    id: botId, botId: botId as never, user: 'alice', text: 'reply', attempts: 0, nextAt: 0,
    conversation: { provider: 'infoflow', accountId: '11', kind: 'group', id: 'group' },
  })) }
  const closes: ReturnType<typeof vi.fn>[] = [], cleanups: (() => Promise<void>)[] = []
  const detach = vi.fn()
  const ctx = {
    logger: { warn: vi.fn() },
    storageDomain: { open: async (domain: { name: string }) => {
      const close = vi.fn(async () => {}); closes.push(close)
      return { close, global: domain.name === 'bot_infoflow_settings' ? { get: () => settings, set: async () => {} }
        : { get: () => queue, set: async (value: BridgeState) => { queue = structuredClone(value) } } }
    } },
    credentials: { resolve: async () => ({ value: 'fixture-secret' }), set: async () => {}, unset: async () => {} },
    botMode: {
      snapshot: () => ({ bots: bindings.map(binding => ({ id: binding.botId })), rooms: [] }),
      attachInfoFlow: () => detach,
      attachQueueDiscovery: () => () => {},
      attachQueue: () => () => {},
      async *follow(signal: AbortSignal) { yield {}; if (!signal.aborted) await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })) },
    },
    effect: (effect: () => () => Promise<void>) => { cleanups.push(effect()) }, on: () => () => {},
  }
  const config = { maxPending: 20, maxQueuePerRoom: 5, maxConcurrentRooms: 2, maxReceipts: 100, maxOutbox: 100, chunkSize: 3000,
    retryMs: 100, maxRetryMs: 1000, endpointTimeoutMs: 100, pollMs: 100000 } as Config
  await applyManaged(ctx as unknown as Context, config)
  try {
    await vi.waitFor(() => expect(queue.outbox).toHaveLength(0))
    expect(fixture.transports[0]!.config.robotIds()).toEqual(['111', '11', '112', '12'])
    expect(queue.failed).toHaveLength(1)
    expect(queue.failed![0]!.reason).toBe('permanent')
    expect(fixture.transports[0]!.send).toHaveBeenCalledOnce()
  } finally { for (const cleanup of cleanups) await cleanup() }
  expect(detach).toHaveBeenCalledOnce()
  expect(fixture.transports[0]!.close).toHaveBeenCalledOnce()
  expect(closes).toHaveLength(2)
  for (const close of closes) expect(close).toHaveBeenCalledOnce()
})

it('extends a managed group without closing its source connection or replacing its durable shared queue', async () => {
  fixture.transports.length = 0
  fixture.api.mockReturnValue({ groupInfo: async () => ({ groupId: '123', masterUserId: 'alice', agentIds: ['11', '12'] }), addRobots: vi.fn() })
  const bindings = ['alpha', 'beta'].map((botId, index) => ({ botId: botId as BotId, agentId: `${index + 11}`, robotId: `${index + 111}`, robotName: botId,
    enabled: true, appKeyRef: `${botId}_key`, appSecretRef: `${botId}_secret`, allowUsers: ['alice'], allowGroups: index ? [] : ['123'], admins: ['alice'] }))
  let settings = { bindings, groups: [{ requestId: 'created-group', title: 'Group', groupId: '123', roomId: 'room', botIds: [bindings[0]!.botId], defaultBot: bindings[0]!.botId, owner: 'alice', members: [], status: 'ready', warning: null }] }
  const domains = new Map<string, BridgeState>(), cleanups: (() => Promise<void>)[] = []
  const attachQueue = vi.fn(() => () => {})
  let manager!: InfoFlowManager, room: Room | undefined
  const ctx = {
    logger: { warn: vi.fn() },
    storageDomain: { open: async (domain: { name: string }) => ({ close: async () => {}, global: domain.name === 'bot_infoflow_settings'
      ? { get: () => settings, set: async (value: typeof settings) => { settings = structuredClone(value) } }
      : { get: () => domains.get(domain.name) ?? { receipts: [], pending: [], notices: [], outbox: [] }, set: async (value: BridgeState) => { domains.set(domain.name, structuredClone(value)) } } }) },
    credentials: { resolve: async () => ({ value: 'fixture-secret' }), set: async () => {}, unset: async () => {} },
    botMode: {
      snapshot: () => ({ bots: bindings.map(binding => ({ id: binding.botId, name: binding.botId })), rooms: room ? [room] : [] }),
      ensureExternalRoom: vi.fn(async (request: { title: string; botIds: BotId[]; defaultBot: BotId; conversation: Room['external'] }) => {
        room = { id: 'room' as Room['id'], title: request.title, kind: 'group', defaultBot: request.defaultBot, external: request.conversation,
          members: request.botIds.map(botId => ({ botId, sessionId: `${botId}-session` as Room['members'][number]['sessionId'], cursor: 0 })), messages: [] }
        return room
      }),
      attachInfoFlow: (value: InfoFlowManager) => { manager = value; return () => {} }, attachQueueDiscovery: () => () => {}, attachQueue,
      async *follow(signal: AbortSignal) { yield {}; if (!signal.aborted) await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })) },
    },
    effect: (effect: () => () => Promise<void>) => { cleanups.push(effect()) }, on: () => () => {},
  }
  const config = { maxPending: 20, maxQueuePerRoom: 5, maxConcurrentRooms: 2, maxReceipts: 100, maxOutbox: 100, chunkSize: 3000,
    retryMs: 100, maxRetryMs: 1000, endpointTimeoutMs: 100, pollMs: 100000 } as Config
  await applyManaged(ctx as unknown as Context, config)
  try {
    const source = fixture.transports[0]!, groupQueues = () => attachQueue.mock.calls.filter(call => (call as unknown[])[1] === 'group:123').length
    const input: Incoming = { conversation: { provider: 'infoflow', accountId: '11', kind: 'group', id: '123' }, message: { id: 'one', sender: { id: 'alice', name: 'Alice' } }, text: '/bots' }
    await source.receive(input, ['111'])
    await vi.waitFor(() => expect(source.send).toHaveBeenCalledOnce())
    const queueCount = groupQueues()
    await manager.inviteBots({ requestId: 'invite-new-peer', groupId: '123', title: 'Group', botIds: bindings.map(binding => binding.botId), defaultBot: bindings[0]!.botId })
    expect(source.close).not.toHaveBeenCalled()
    expect(groupQueues()).toBe(queueCount)
    expect(queueCount).toBe(1)
    await source.receive(input, ['111'])
    await source.receive({ ...input, message: { ...input.message, id: 'two' } }, ['111'])
    await vi.waitFor(() => expect(source.send).toHaveBeenCalledTimes(2))
    expect(source.send.mock.calls[1]?.[0]).toMatchObject({ text: '@alpha alpha\n@beta beta' })
  } finally { for (const cleanup of cleanups) await cleanup(); fixture.api.mockReturnValue({}) }
})
