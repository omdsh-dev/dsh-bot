/** Atomic call reservations are maintained by the owner alongside usage settlement. */
import type { Budget, Usage } from './types.ts'

export function needsBudgetReset(budget: Budget, now: number): boolean {
  const key = (at: number) => new Date(at).toISOString().slice(0, budget.period === 'month' ? 7 : 10)
  return !!budget.period && budget.period !== 'never' && key(now) !== key(budget.since)
}
export function resetPeriod(budget: Budget, now: number): void {
  if (needsBudgetReset(budget, now)) {
    budget.used = { input: 0, output: 0, cost: 0 }; budget.since = now
  }
}
export interface Reservation { tokens: number; cost: number }
export function reserveBudget(budget: Budget, reserved: Reservation): Reservation {
  const tokens = budget.reservationTokens ?? 8192, cost = budget.reservationCost ?? 0
  if (budget.tokenLimit && budget.used.input + budget.used.output + reserved.tokens + tokens > budget.tokenLimit
    || budget.costLimit && budget.used.cost + reserved.cost + cost > budget.costLimit) throw new Error('Bot budget exhausted or reserved by another active call')
  if (budget.costLimit && cost <= 0) throw new Error('Set a positive cost reservation per model call')
  return { tokens, cost }
}
export function addUsage(budget: Budget, usage: Usage): void {
  budget.used.input += usage.input; budget.used.output += usage.output; budget.used.cost += usage.cost
}
