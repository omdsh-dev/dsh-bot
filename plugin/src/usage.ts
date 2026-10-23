/** Read-only reporting over complete Host history, independent of the browser's bounded message tail. */
import { resetPeriod } from './budgets.ts'
import type { Budget, BotState, Usage } from './types.ts'
import type { UsageBucket, UsageDetail, UsageFilter, UsageRecord } from './usage-types.ts'

export interface UsageTotals { input: number; output: number; records: number }
export interface BotUsageRow {
  botId: string; name: string; archived: boolean; deleted: boolean; pricesConfigured: boolean
  conversation: UsageTotals; memory: UsageTotals; handoff: UsageTotals; unreported: number
}
export interface UsageBudget {
  scope: string; name: string; budget: Budget; reserved: { tokens: number; cost: number }
}
export interface UsageReport { generatedAt: number; bots: BotUsageRow[]; budgets: UsageBudget[]; ledger?: UsageDetail }

export function usageReport(state: BotState, now = Date.now()): UsageReport {
  const rows = new Map<string, BotUsageRow>()
  const rowFor = (id: string) => {
    let row = rows.get(id)
    if (!row) {
      const bot = state.bots.find(bot => bot.id === id)
      row = { botId: id, name: bot?.name ?? id, archived: !!bot?.archived, deleted: !bot,
        pricesConfigured: bot?.policy?.inputPrice !== undefined && bot.policy.outputPrice !== undefined,
        conversation: { input: 0, output: 0, records: 0 }, memory: { input: 0, output: 0, records: 0 },
        handoff: { input: 0, output: 0, records: 0 }, unreported: 0 }
      rows.set(id, row)
    }
    return row
  }
  const add = (total: UsageTotals, usage: Pick<Usage, 'input' | 'output'>, records: number) => {
    total.input += usage.input; total.output += usage.output; total.records += records
  }
  for (const bot of state.bots) rowFor(bot.id)
  for (const room of state.rooms) {
    if (room.deleted) continue
    for (const message of room.messages) {
      if (!message.botId || message.status === 'queued') continue
      const row = rowFor(message.botId)
      if (message.usage) add(row.conversation, message.usage, 1)
      else row.unreported++
    }
  }
  for (const usage of state.maintenanceUsage ?? []) add(rowFor(usage.botId)[usage.purpose], usage, usage.calls)
  const budgets: UsageBudget[] = []
  for (const [scope, source] of [...(state.budget ? [['*', state.budget] as const] : []), ...Object.entries(state.botBudgets ?? {})]) {
    const budget = structuredClone(source)
    resetPeriod(budget, now)
    const reserved = Object.values(state.budgetReservations ?? {}).flat().filter(item => item.scope === scope)
      .reduce((total, item) => ({ tokens: total.tokens + item.tokens, cost: total.cost + item.cost }), { tokens: 0, cost: 0 })
    budgets.push({ scope, name: scope === '*' ? '' : rowFor(scope).name, budget, reserved })
  }
  return { generatedAt: now, bots: [...rows.values()], budgets }
}

/** Stream immutable ledger chunks; only aggregates and the latest 100 matching calls stay in memory. */
export async function ledgerReport(state: BotState, records: AsyncIterable<UsageRecord> | Iterable<UsageRecord>, filter: UsageFilter = {}, now = Date.now()): Promise<UsageReport> {
  if ([filter.from, filter.to].some(value => value !== undefined && (!Number.isFinite(value) || value < 0))
    || filter.from !== undefined && filter.to !== undefined && filter.from >= filter.to) throw new Error('Use a valid usage date range')
  const report = usageReport({ ...state, rooms: [], maintenanceUsage: [] }, now)
  const bucket = (key: string): UsageBucket => ({ key, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, records: 0,
    unreported: 0, estimatedTokens: 0, legacyRecords: 0, unpricedRecords: 0, costs: [] })
  const totals = bucket('*'), days = new Map<string, UsageBucket>(), models = new Map<string, UsageBucket>(), rooms = new Map<string, UsageBucket>(), purposes = new Map<string, UsageBucket>()
  const recent: UsageRecord[] = []
  let matchedRecords = 0
  const add = (target: UsageBucket, record: UsageRecord) => {
    target.records += record.records
    if (record.status === 'estimated') target.estimatedTokens += record.input + record.output
    if (record.status === 'reported' || record.status === 'legacy') {
      target.input += record.input; target.output += record.output
      target.cacheRead += record.cacheRead ?? 0; target.cacheWrite += record.cacheWrite ?? 0
    } else target.unreported += record.records
    if (record.status === 'legacy') target.legacyRecords += record.records
    if (record.cost === null || record.currency === null) target.unpricedRecords += record.records
    else {
      let cost = target.costs.find(cost => cost.currency === record.currency)
      if (!cost) { cost = { currency: record.currency, cost: 0 }; target.costs.push(cost) }
      cost.cost += record.cost
    }
  }
  for await (const record of records) {
    if (filter.from !== undefined && (record.startedAt === null || record.startedAt < filter.from)
      || filter.to !== undefined && (record.startedAt === null || record.startedAt >= filter.to)
      || filter.botId && record.botId !== filter.botId || filter.roomId && record.roomId !== filter.roomId
      || filter.provider && record.provider !== filter.provider || filter.model && record.model !== filter.model
      || filter.purpose && record.purpose !== filter.purpose) continue
    matchedRecords++
    add(totals, record)
    for (const [map, key] of [[days, record.startedAt === null ? 'unknown' : new Date(record.startedAt).toISOString().slice(0, 10)],
      [models, JSON.stringify([record.provider, record.model])], [rooms, record.roomId ?? 'unknown'], [purposes, record.purpose]] as const) {
      const value = map.get(key) ?? bucket(key); add(value, record); map.set(key, value)
    }
    let row = report.bots.find(row => row.botId === record.botId)
    if (!row) { row = { botId: record.botId, name: record.botId, archived: false, deleted: true, pricesConfigured: false,
      conversation: { input: 0, output: 0, records: 0 }, memory: { input: 0, output: 0, records: 0 }, handoff: { input: 0, output: 0, records: 0 }, unreported: 0 }; report.bots.push(row) }
    row[record.purpose].records += record.records
    if (record.status === 'reported' || record.status === 'legacy') { row[record.purpose].input += record.input; row[record.purpose].output += record.output }
    else row.unreported += record.records
    recent.push(record)
    recent.sort((a, b) => (b.startedAt ?? -1) - (a.startedAt ?? -1) || b.id.localeCompare(a.id))
    if (recent.length > 100) recent.pop()
  }
  report.ledger = { totals, days: [...days.values()].sort((a, b) => a.key.localeCompare(b.key)),
    models: [...models.values()], rooms: [...rooms.values()], purposes: [...purposes.values()], recent, matchedRecords,
    activeCalls: Object.keys(state.usageLedger?.pending ?? {}).length }
  return report
}
