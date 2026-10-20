/** Managed wiring uses real managers/queues; only the platform transport is replaced. */
import { expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { applyManaged } from '../src/infoflow/managed.ts'
import type { Config } from '../src/infoflow.ts'
import type { BridgeState } from '../src/infoflow/domain.ts'
const fixture = vi.hoisted(() => ({ transports: [] as { config: { robotIds(): string[] }; send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> }[] }))
vi.mock('../src/infoflow/sdk.ts', () => ({
  loadSdk: () => ({}), robotApi: () => ({}),
  InfoFlowTransport: class {
    send = vi.fn(async () => {})
    close = vi.fn(async () => {})
    start() {}
    constructor(_sdk: unknown, readonly config: { robotIds(): string[] }) { fixture.transports.push(this) }
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
