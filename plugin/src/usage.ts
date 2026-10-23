/** Read-only reporting over complete Host history, independent of the browser's bounded message tail. */
import { resetPeriod } from './budgets.ts'
import type { Budget, BotState, Usage } from './types.ts'

export interface UsageTotals { input: number; output: number; records: number }
export interface BotUsageRow {
  botId: string; name: string; archived: boolean; deleted: boolean; pricesConfigured: boolean
  conversation: UsageTotals; memory: UsageTotals; handoff: UsageTotals; unreported: number
}
export interface UsageBudget {
  scope: string; name: string; budget: Budget; reserved: { tokens: number; cost: number }
}
export interface UsageReport { generatedAt: number; bots: BotUsageRow[]; budgets: UsageBudget[] }

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
