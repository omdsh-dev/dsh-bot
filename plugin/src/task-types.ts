/** Serializable task/run lifecycle contract; safe to import from browser clients. */
export type TaskStatus = 'queued' | 'running' | 'waiting' | 'awaiting_verification' | 'verified' | 'failed' | 'canceled' | 'interrupted'
export type RunStatus = 'queued' | 'running' | 'waiting' | 'complete' | 'failed' | 'canceled' | 'interrupted'
export interface TaskRun {
  id: string; botId: string; status: RunStatus; createdAt: number; updatedAt: number
  sessionId?: string | undefined; parentRunId?: string | undefined; continuationOf?: string | undefined; retryOf?: string | undefined
  continuedBy?: string | undefined; resultIds: string[]; awaiting: string[]
}
export interface TaskEvent {
  sequence: number; time: number; kind: 'created' | 'run' | 'status' | 'verification' | 'cancel_requested' | 'merged'
  runId?: string | undefined; status?: TaskStatus | RunStatus | undefined
}
export interface TaskRecord {
  id: string; roomId: string; rootMessageId: string; createdAt: number; updatedAt: number; status: TaskStatus
  runs: TaskRun[]; events: TaskEvent[]; nextSequence: number; droppedEvents: number
  cancelRequestedAt?: number | undefined
  /** Verification is an explicit human action, never inferred from a model's turn/end. */
  verification?: { outcome: 'accepted' | 'rejected'; time: number } | undefined
}
export interface TaskLedger {
  version: 1; tasks: TaskRecord[]
  /** Root message order fence for pruned terminal tasks; unfinished work bypasses it. */
  retiredBefore: Record<string, { time: number; id: string }>
}
export interface TaskListRequest { roomId: string; limit?: number | undefined }
export interface TaskRequest { roomId: string; taskId: string }
export interface VerifyTaskRequest extends TaskRequest { outcome: 'accepted' | 'rejected' }
