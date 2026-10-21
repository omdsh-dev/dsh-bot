import { expect, it } from 'vitest'
import { nextCalendar, validateCalendar } from '../src/scheduling.ts'
import { resetPeriod, reserveBudget } from '../src/budgets.ts'
import { HistoryStore } from '../src/history-store.ts'
import { botDomain } from '../src/domain.ts'
import type { BotState, Budget } from '../src/types.ts'

it('uses local weekdays and skips DST gaps and repeated wall times', () => {
  const rule = validateCalendar({ timeZone: 'America/New_York', time: '02:30', weekdays: [7] })
  expect(new Date(nextCalendar(rule, Date.parse('2026-03-01T07:30:00Z'))).toISOString()).toBe('2026-03-15T06:30:00.000Z')
  expect(new Date(nextCalendar(rule, Date.parse('2026-03-08T06:00:00Z'))).toISOString()).toBe('2026-03-15T06:30:00.000Z')
  expect(new Date(nextCalendar({ ...rule, time: '01:30' }, Date.parse('2026-11-01T05:30:00Z'))).toISOString()).toBe('2026-11-08T06:30:00.000Z')
  expect(new Date(nextCalendar({ timeZone: 'Asia/Shanghai', time: '09:00', weekdays: [1, 2, 3, 4, 5] }, Date.parse('2026-10-23T02:00:00Z'))).toISOString()).toBe('2026-10-26T01:00:00.000Z')
  expect(() => validateCalendar({ ...rule, timeZone: 'not-a-zone' })).toThrow('time zone')
})

it('counts concurrent reservations and resets daily or monthly UTC usage', () => {
  const budget: Budget = { tokenLimit: 100, costLimit: 1, currency: 'USD', used: { input: 30, output: 10, cost: 0.2 }, since: Date.parse('2026-10-20T23:59Z'), period: 'day', reservationTokens: 40, reservationCost: 0.4 }
  expect(reserveBudget(budget, { tokens: 0, cost: 0 })).toEqual({ tokens: 40, cost: 0.4 })
  expect(() => reserveBudget(budget, { tokens: 40, cost: 0.4 })).toThrow('reserved')
  resetPeriod(budget, Date.parse('2026-10-21T00:01Z'))
  expect(budget.used).toEqual({ input: 0, output: 0, cost: 0 })
  budget.period = 'month'; budget.used.input = 20
  resetPeriod(budget, Date.parse('2026-10-22T00:00Z')); expect(budget.used.input).toBe(20)
  resetPeriod(budget, Date.parse('2026-11-01T00:00Z')); expect(budget.used.input).toBe(0)
})

it('migrates full history, preserves indexed receipts and edits old chunks without rewriting unchanged chunks', async () => {
  const documents = new Map<string, unknown>(); let chunkWrites = 0
  const archive = () => new HistoryStore(async spec => ({ global: {
    get: () => spec.global.schema.parse(documents.get(spec.name) ?? []),
    set: async (value: unknown) => { documents.set(spec.name, spec.global.schema.parse(value)); chunkWrites++ },
  }, close: async () => {} }) as never)
  const state = botDomain.global.schema.parse({ bots: [], rooms: [{ id: 'r', title: 'History', kind: 'group', defaultBot: 'b', members: [{ botId: 'b', sessionId: 's', cursor: 550 }], messages:
    Array.from({ length: 600 }, (_, i) => ({ text: 'message ' + i, id: 'm' + i, botId: null, replyTo: null, status: 'complete', error: null, time: i, ...(i === 10 ? { external: { id: 'receipt', sender: { id: 'u', name: 'User' } } } : {}) })) }] })
  let manifest: BotState = state
  const store = archive()
  await store.persist(state, async next => { manifest = botDomain.global.schema.parse(next) })
  expect(manifest.rooms[0]!.messages.length).toBeLessThanOrEqual(256)
  const firstWrites = chunkWrites
  expect(await archive().hydrate(manifest)).toEqual(state)
  state.rooms[0]!.messages[599]!.text = 'updated tail'
  await store.persist(state, async next => { manifest = next })
  expect(chunkWrites).toBe(firstWrites)
  state.rooms[0]!.messages[10]!.external!.sources = [{ accountId: 'a', senderId: 'u' }]
  await store.persist(state, async next => { manifest = next })
  expect(chunkWrites).toBe(firstWrites + 1)
  expect(await archive().hydrate(manifest)).toEqual(state)
  const old = structuredClone(manifest)
  state.rooms[0]!.messages[11]!.text = 'uncommitted change'
  await expect(store.persist(state, async () => { throw new Error('disk full') })).rejects.toThrow('disk full')
  expect((await archive().hydrate(old)).rooms[0]!.messages[11]!.text).toBe('message 11')
  documents.delete('bot_history_' + old.rooms[0]!.historyChunks![0])
  await expect(archive().hydrate(old)).rejects.toThrow('missing or corrupted')
})

it('segments dedup windows and evicts old receipts without rewriting the retained middle', async () => {
  const { BridgeArchive } = await import('../src/infoflow/archive.ts')
  const { bridgeSchema } = await import('../src/infoflow/domain.ts')
  let raw = bridgeSchema.parse({ receipts: [], notices: [], pending: [], outbox: [] })
  const chunks = new Map<string, string[]>(); let writes = 0
  const load = () => BridgeArchive.load({ get: () => raw, set: async state => { raw = bridgeSchema.parse(state) } }, async spec => ({ global: {
    get: () => spec.global.schema.parse(chunks.get(spec.name) ?? []),
    set: async (value: unknown) => { chunks.set(spec.name, spec.global.schema.parse(value)); writes++ },
  }, close: async () => {} }) as never)
  const store = await load(), state = { receipts: Array.from({ length: 1000 }, (_, i) => 'receipt-' + i), notices: [], pending: [], outbox: [] }
  await store.set(state)
  const initialWrites = writes
  expect(raw.receipts.length).toBeLessThanOrEqual(256)
  state.receipts = [...state.receipts.slice(1), 'new-receipt']
  await store.set(state)
  expect(writes - initialWrites).toBeLessThanOrEqual(2)
  expect((await load()).get().receipts).toEqual(state.receipts)
  expect(store.get().windows).toBeUndefined()
  const persisted = structuredClone(raw)
  const failing = await BridgeArchive.load({ get: () => raw, set: async () => { throw new Error('disk full') } }, async spec => ({ global: {
    get: () => spec.global.schema.parse(chunks.get(spec.name) ?? []),
    set: async (value: unknown) => { chunks.set(spec.name, spec.global.schema.parse(value)) },
  }, close: async () => {} }) as never)
  await expect(failing.set({ ...state, receipts: [...state.receipts, 'uncommitted'] })).rejects.toThrow('disk full')
  expect(failing.get().receipts).toEqual(state.receipts)
  expect(raw).toEqual(persisted)
  chunks.delete('bot_receipts_' + raw.windows!.receipts!.chunks[0])
  await expect(load()).rejects.toThrow('missing or corrupted')
})
