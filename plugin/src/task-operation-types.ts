/** Serializable operation metadata; safe for client Remote contracts. */
export type OperationStatus = 'started' | 'returned' | 'unknown'
export type OperationResolution = 'verified_applied' | 'verified_not_applied'
export interface OperationKey { roomId: string; messageId: string; callId: string }
export interface ToolOperation extends OperationKey {
  /** Collision-free identity for a particular native call in one response attempt. */
  id: string
  name: string
  status: OperationStatus
  startedAt: number
  finishedAt?: number | undefined
  resolution?: { outcome: OperationResolution; time: number } | undefined
}
export interface TaskOperationLedger { version: 1; operations: ToolOperation[] }
export interface OperationState { taskOperations?: TaskOperationLedger | undefined }
export interface ResolveOperationRequest extends OperationKey { resolution: OperationResolution }
/** Explicit authorized room IDs (including aliases) and optional root-task attempt IDs. Empty arrays match nothing. */
export interface OperationScope { roomIds: string[]; messageIds?: string[] | undefined }
