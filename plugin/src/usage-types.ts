/** Accounting metadata only: no prompts, answers, credentials or tool arguments. */
export type UsagePurpose = 'conversation' | 'memory' | 'handoff'
export interface UsageCall {
  id: string; botId: string; roomId: string | null; messageId: string | null; sessionId: string | null
  purpose: UsagePurpose; startedAt: number | null; provider: string | null; model: string | null
  currency: string | null; inputPrice: number | null; outputPrice: number | null
}
export interface UsageRecord extends UsageCall {
  completedAt: number | null; input: number; output: number; cacheRead: number | null; cacheWrite: number | null
  cost: number | null; records: number; status: 'reported' | 'estimated' | 'unreported' | 'legacy'
}
export interface UsageLedger {
  version: 1; chunks: string[]; tail: UsageRecord[]; pending: Record<string, UsageCall>
}
export interface UsageFilter {
  from?: number | undefined; to?: number | undefined; botId?: string | undefined; roomId?: string | undefined
  provider?: string | undefined; model?: string | undefined; purpose?: UsagePurpose | undefined
}
export interface UsageBucket {
  key: string; input: number; output: number; cacheRead: number; cacheWrite: number; records: number; unreported: number
  estimatedTokens: number; legacyRecords: number; unpricedRecords: number; costs: { currency: string; cost: number }[]
}
export interface UsageDetail {
  totals: UsageBucket; days: UsageBucket[]; models: UsageBucket[]; rooms: UsageBucket[]; purposes: UsageBucket[]
  recent: UsageRecord[]; matchedRecords: number; activeCalls: number
}
