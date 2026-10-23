import { expect, it } from 'vitest'
import { botDomain } from '../src/domain.ts'
import { beginUsage, finishUsage, migrateUsage } from '../src/usage-ledger.ts'
import { UsageStore } from '../src/usage-store.ts'
import { ledgerReport } from '../src/usage.ts'
import type { BotState, UsageLedger } from '../src/types.ts'

function fixture(): BotState {
  return botDomain.global.schema.parse({ bots: [{ id: 'sage', name: 'Sage', instructions: 'secret', preset: 'standard', policy: { inputPrice: 1, outputPrice: 2 } }],
    rooms: [{ id: 'r', title: 'Chat', kind: 'dm', defaultBot: 'sage', members: [], messages: [
      { id: 'm', botId: 'sage', text: 'secret message', replyTo: null, time: 1000, status: 'complete', error: null, usage: { input: 50, output: 10, cost: 90 } },
    ] }], maintenanceUsage: [{ botId: 'sage', purpose: 'memory', input: 20, output: 2, cost: 40, calls: 2 }] })
}

it('imports legacy totals once without inventing prices, models, cache accounting or auxiliary dates', async () => {
  const state = fixture()
  migrateUsage(state); migrateUsage(state)
  expect(state.usageLedger!.tail).toHaveLength(2)
  expect(state.usageLedger!.tail[0]).toMatchObject({ provider: null, model: null, cost: null, cacheRead: null, startedAt: 1000 })
  expect(state.usageLedger!.tail[1]).toMatchObject({ startedAt: null, records: 2 })
  state.rooms = []; state.maintenanceUsage = []; state.bots = []
  const report = await ledgerReport(state, state.usageLedger!.tail)
  expect(report.bots[0]).toMatchObject({ deleted: true, conversation: { input: 50, output: 10, records: 1 }, memory: { input: 20, output: 2, records: 2 } })
  expect(report.ledger!.totals).toMatchObject({ input: 70, output: 12, records: 3, unpricedRecords: 3, legacyRecords: 3, costs: [] })
  expect(JSON.stringify(report)).not.toContain('secret')
  expect((await ledgerReport(state, state.usageLedger!.tail, { from: 0, to: 2000 })).ledger!.totals.records).toBe(1)
})

it('records route and prices at dispatch, separates cached input and settles the same pending call once', async () => {
  const state = fixture(), bot = state.bots[0]!
  migrateUsage(state); state.usageLedger!.tail = []
  beginUsage(state, 'call', bot, { roomId: 'r', provider: 'deepseek', model: 'reasoner', purpose: 'conversation' }, 10000)
  bot.policy!.inputPrice = 99
  finishUsage(state, 'call', { input: 120, output: 5, cost: 0.00013 }, { inputTokens: 20, cacheReadTokens: 80, cacheWriteTokens: 20, outputTokens: 5 }, true, 12000)
  finishUsage(state, 'call')
  expect(state.usageLedger!.tail).toHaveLength(1)
  expect(state.usageLedger!.tail[0]).toMatchObject({ inputPrice: 1, cost: 0.00013, cacheRead: 80, cacheWrite: 20, status: 'reported', provider: 'deepseek' })
  const report = await ledgerReport(state, state.usageLedger!.tail, { provider: 'deepseek', model: 'reasoner', roomId: 'r', purpose: 'conversation', from: 10000, to: 12000 })
  expect(report.ledger!.totals).toMatchObject({ input: 120, output: 5, cacheRead: 80, cacheWrite: 20, records: 1 })
  expect((await ledgerReport(state, state.usageLedger!.tail, { model: 'other' })).ledger!.matchedRecords).toBe(0)
})

it('preserves unknown-call charges on restart, avoids double scope totals and excludes calls canceled before invocation', async () => {
  const state = fixture(), bot = state.bots[0]!
  migrateUsage(state); state.usageLedger!.tail = []
  beginUsage(state, 'call', bot)
  state.budgetReservations = { call: [{ scope: '*', tokens: 80, cost: 1 }, { scope: 'sage', tokens: 50, cost: 0.5 }] }
  const restarted = botDomain.global.schema.parse(state)
  finishUsage(restarted, 'call')
  beginUsage(restarted, 'unreported', bot); finishUsage(restarted, 'unreported')
  beginUsage(restarted, 'canceled', bot); finishUsage(restarted, 'canceled', undefined, undefined, false)
  const report = await ledgerReport(restarted, restarted.usageLedger!.tail)
  expect(report.ledger!.totals).toMatchObject({ input: 0, output: 0, estimatedTokens: 80, records: 2, unreported: 2, costs: [{ currency: 'USD', cost: 1 }] })
  expect(restarted.usageLedger!.pending).toEqual({})
})

it('commits independent chunks atomically, streams after restart and rejects corrupt accounting data', async () => {
  const docs = new Map<string, unknown>()
  const make = () => new UsageStore(async spec => ({ global: {
    get: () => spec.global.schema.parse(docs.get(spec.name) ?? []),
    set: async (value: unknown) => { docs.set(spec.name, spec.global.schema.parse(value)) },
  }, close: async () => {} }) as never)
  const state = fixture(); migrateUsage(state)
  const sample = state.usageLedger!.tail[0]!
  state.usageLedger!.tail = Array.from({ length: 410 }, (_, i) => ({ ...sample, id: String(i), startedAt: i }))
  const before = structuredClone(state)
  await expect(make().persist(state, async () => { throw new Error('disk full') })).rejects.toThrow('disk full')
  expect(state).toEqual(before)
  let committed: BotState = state
  await make().persist(state, async next => { committed = botDomain.global.schema.parse(next) })
  expect(state.usageLedger!.tail.length).toBeLessThanOrEqual(128)
  const store = make(), ledger = committed.usageLedger!
  const [a, b] = await Promise.all([ledgerReport(committed, store.read(ledger)), ledgerReport(committed, store.read(ledger))])
  expect(a.ledger!.totals.records).toBe(410)
  expect(a.ledger!.recent).toHaveLength(100)
  expect(b.ledger).toEqual(a.ledger)
  committed.rooms = []; committed.budget = undefined
  expect((await ledgerReport(committed, make().read(ledger))).ledger!.totals.records).toBe(410)
  docs.delete('bot_usage_' + ledger.chunks[0])
  await expect(ledgerReport(committed, make().read(ledger))).rejects.toThrow('missing or corrupted')
  const invalid: UsageLedger = { ...ledger, chunks: ['../bad'] }
  await expect(ledgerReport(committed, make().read(invalid))).rejects.toThrow('Invalid usage')
})
