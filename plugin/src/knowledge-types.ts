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
export interface ContextSegment { sessionId: string; endedAt: number; reason: string; nextSessionId?: string | undefined; handoff?: string | undefined }
export interface ContextTrace {
  sessionId: string; measuredAt: number; tokens: number; window: number; measurement: 'provider' | 'meter' | 'characters' | 'unknown'
  memories: { id: string; revision: number }[]; conflicts: string[][]; omitted: number; recalls: number
}
export interface ContextView {
  botId: string; sessionId: string; trace: ContextTrace | null
  current: { tokens: number; window: number; measurement: 'provider' | 'meter' | 'characters' | 'unknown' } | null
  memories: { id: string; revision: number; status: string; scope: string; subject: string; topic: string; body: string }[]
  segments: ContextSegment[]; pendingHandoff: string | null
  decisions: { time: number; action: string; before: number; after: number; window: number }[]
}
export interface MaintenanceUsage { botId: string; purpose: 'memory' | 'handoff'; input: number; output: number; cost: number; calls: number }
