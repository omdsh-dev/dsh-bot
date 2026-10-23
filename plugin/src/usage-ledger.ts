import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import type { Bot, BotState, Usage } from './types.ts'
import type { UsageCall, UsageLedger, UsageRecord } from './usage-types.ts'

const amount = z.number().finite().nonnegative()
const callFields = {
  id: z.string(), botId: z.string(), roomId: z.string().nullable(), messageId: z.string().nullable(), sessionId: z.string().nullable(),
  purpose: z.enum(['conversation', 'memory', 'handoff']), startedAt: amount.nullable(), provider: z.string().nullable(), model: z.string().nullable(),
  currency: z.string().nullable(), inputPrice: amount.nullable(), outputPrice: amount.nullable(),
}
export const usageRecordSchema: z.ZodType<UsageRecord> = z.object({ ...callFields,
  completedAt: amount.nullable(), input: amount, output: amount, cacheRead: amount.nullable(), cacheWrite: amount.nullable(),
  cost: amount.nullable(), records: amount.int(), status: z.enum(['reported', 'estimated', 'unreported', 'legacy']),
})
export const usageLedgerSchema: z.ZodType<UsageLedger> = z.object({ version: z.literal(1), chunks: z.array(z.string()),
  tail: z.array(usageRecordSchema), pending: z.record(z.string(), z.object(callFields)),
})

/** One-time import. Historical aggregate prices, routes and call dates cannot be reconstructed. */
export function migrateUsage(state: BotState): void {
  if (state.usageLedger) return
  const ledger: UsageLedger = { version: 1, chunks: [], tail: [], pending: {} }
  const base = { provider: null, model: null, currency: null, inputPrice: null, outputPrice: null,
    cost: null, cacheRead: null, cacheWrite: null, status: 'legacy' as const }
  for (const room of state.rooms) if (!room.deleted) for (const message of room.messages) {
    if (!message.botId || !message.usage) continue
    ledger.tail.push({ ...base, id: `legacy:${room.id}:${message.id}`, botId: message.botId, roomId: room.id,
      messageId: message.id, sessionId: message.executionSessionId ?? null, purpose: 'conversation',
      startedAt: message.time, completedAt: null, input: message.usage.input, output: message.usage.output, records: 1 })
  }
  for (const row of state.maintenanceUsage ?? []) ledger.tail.push({ ...base, id: `legacy:${row.botId}:${row.purpose}`,
    botId: row.botId, roomId: null, messageId: null, sessionId: null, purpose: row.purpose,
    startedAt: null, completedAt: null, input: row.input, output: row.output, records: row.calls })
  state.usageLedger = ledger
}

export function beginUsage(state: BotState, key: string, bot: Bot, context: Partial<Pick<UsageCall, 'roomId' | 'messageId' | 'sessionId' | 'purpose' | 'provider' | 'model'>> = {}, now = Date.now()): void {
  migrateUsage(state)
  state.usageLedger!.pending[key] = { id: randomUUID(), botId: bot.id, roomId: context.roomId ?? null,
    messageId: context.messageId ?? null, sessionId: context.sessionId ?? null, purpose: context.purpose ?? 'conversation',
    provider: context.provider ?? bot.policy?.provider ?? null, model: context.model ?? bot.policy?.model ?? null, startedAt: now,
    currency: state.budget?.currency ?? state.botBudgets?.[bot.id]?.currency ?? 'USD',
    inputPrice: bot.policy?.inputPrice ?? null, outputPrice: bot.policy?.outputPrice ?? null }
}

/** Consumes the durable pending call exactly once, in the same transaction as budget settlement. */
export function finishUsage(state: BotState, key: string, usage?: Usage, tokens?: TokenUsage, invoked = true, now = Date.now()): void {
  const ledger = state.usageLedger, call = ledger?.pending[key]
  if (!ledger || !call) return
  delete ledger.pending[key]
  if (!invoked) return
  const reservations = state.budgetReservations?.[key] ?? []
  // Profile and per-Bot reservations cover the same call: do not sum them.
  const reserved = reservations.find(row => row.scope === '*') ?? reservations[0]
  ledger.tail.push({ ...call, completedAt: now,
    input: usage?.input ?? reserved?.tokens ?? 0, output: usage?.output ?? 0,
    cacheRead: tokens ? tokens.cacheReadTokens ?? 0 : null, cacheWrite: tokens ? tokens.cacheWriteTokens ?? 0 : null,
    cost: usage ? call.inputPrice !== null && call.outputPrice !== null
      ? (usage.input * call.inputPrice + usage.output * call.outputPrice) / 1000000 : null : reserved?.cost ?? null,
    records: 1, status: usage ? 'reported' : reserved ? 'estimated' : 'unreported' })
}
