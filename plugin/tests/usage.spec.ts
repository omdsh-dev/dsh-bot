import { expect, it } from 'vitest'
import { usageReport } from '../src/usage.ts'
import type { BotState, BotId, ChatMessageId, RoomId } from '../src/types.ts'

it('reports all retained history, keeps auxiliary usage distinct and includes retired Bots without exposing chat content', () => {
  const botId = 'sage' as BotId
  const state: BotState = { bots: [{ id: botId, name: 'Sage', preset: 'standard', instructions: 'private instructions' }], rooms: [{
    id: 'room' as RoomId, title: 'Private chat', kind: 'dm', defaultBot: botId, members: [], archived: true,
    messages: Array.from({ length: 130 }, (_, i) => ({ id: String(i) as ChatMessageId, botId, text: 'private message', replyTo: null, status: 'complete', error: null, time: i, usage: { input: 10, output: 2, cost: 0.1 } })),
  }], maintenanceUsage: [
    { botId, purpose: 'memory', input: 20, output: 4, cost: 0.2, calls: 2 },
    { botId: 'retired', purpose: 'handoff', input: 30, output: 6, cost: 0.3, calls: 1 },
  ] }
  const report = usageReport(state, 1000)
  expect(report.bots[0]).toMatchObject({ conversation: { input: 1300, output: 260, records: 130 }, memory: { input: 20, output: 4, records: 2 }, handoff: { records: 0 } })
  expect(report.bots[1]).toMatchObject({ botId: 'retired', deleted: true, handoff: { input: 30, output: 6, records: 1 } })
  expect(JSON.stringify(report)).not.toMatch(/private|Private/)
  state.rooms[0]!.deleted = true
  expect(usageReport(state).bots[0]!.conversation.records).toBe(0)
})

it('projects UTC budget rollover without writing state and never counts dual-scope reservations twice', () => {
  const old = Date.parse('2026-10-22T23:00:00Z'), now = Date.parse('2026-10-23T00:01:00Z')
  const state: BotState = { bots: [], rooms: [],
    budget: { since: old, period: 'day', currency: 'USD', tokenLimit: 1000, costLimit: 1, used: { input: 100, output: 50, cost: 0.2 } },
    botBudgets: { sage: { since: old, period: 'month', currency: 'USD', tokenLimit: 500, costLimit: 0, used: { input: 100, output: 50, cost: 0.2 } } },
    budgetReservations: { active: [{ scope: '*', tokens: 80, cost: 0.1 }, { scope: 'sage', tokens: 80, cost: 0.1 }] } }
  const before = structuredClone(state), report = usageReport(state, now)
  expect(report.budgets[0]).toMatchObject({ budget: { since: now, used: { input: 0, output: 0, cost: 0 } }, reserved: { tokens: 80, cost: 0.1 } })
  expect(report.budgets[1]).toMatchObject({ budget: { since: old, used: { input: 100, output: 50 } }, reserved: { tokens: 80, cost: 0.1 } })
  expect(state).toEqual(before)
  report.budgets[1]!.budget.used.input = 999
  expect(state).toEqual(before)
})
