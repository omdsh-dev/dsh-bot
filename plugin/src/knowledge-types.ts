/** Maintenance is durable, bounded and separate from public conversation delivery. */
export interface MemoryReview {
  id: string; roomId: string; messageId: string; botId: string
  status: 'pending' | 'running' | 'complete' | 'failed' | 'skipped'
  attempts: number; nextAt: number; createdAt: number; finishedAt?: number | undefined
  error?: string | undefined; candidates?: number | undefined
}
export interface KnowledgeSettings { reviewEnabled: boolean }
export interface KnowledgeStatus {
  settings: KnowledgeSettings; reviews: MemoryReview[]
  identities: { id: string; name: string; aliases: string[] }[]
  usage: { botId: string; purpose: string; input: number; output: number; cost: number; calls: number }[]
}
export interface UserIdentity { id: string; name: string; aliases: string[] }
export interface ContextSegment { sessionId: string; endedAt: number; reason: string }
export interface MaintenanceUsage { botId: string; purpose: 'memory' | 'handoff'; input: number; output: number; cost: number; calls: number }
