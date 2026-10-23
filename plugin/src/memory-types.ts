/** Durable memory contracts. Scope describes ownership, access describes where it may be recalled. */
export type MemoryScope = 'global' | 'bot' | 'group' | 'user'
export type MemoryKind = 'preference' | 'fact'
export type MemoryStatus = 'pending' | 'active' | 'superseded' | 'forgotten'
export interface MemorySource {
  kind: 'operator' | 'conversation'
  roomId?: string | undefined
  messageId?: string | undefined
  userId?: string | undefined
  botId?: string | undefined
  /** Exact supporting quotation or operator-supplied evidence. */
  evidence: string
}
export interface Memory {
  id: string; revision: number
  scope: MemoryScope; ownerId: string
  /** private: the owner's DM only; source-room: only the originating room; scope: normal scope visibility. */
  access: 'private' | 'source-room' | 'scope'
  kind: MemoryKind
  /** Stable subject/environment and topic keys, used to detect competing statements. */
  subject: string; topic: string; body: string
  status: MemoryStatus
  source: MemorySource
  createdAt: number; updatedAt: number
  effectiveAt?: number | undefined; expiresAt?: number | undefined
  supersedes?: string | undefined
  reviewedAt?: number | undefined
  /** Operator evidence added on revision; the original conversation quotation remains intact. */
  reviewEvidence?: string | undefined
}
export interface SaveMemoryRequest {
  /** Updating creates a new version and supersedes this one; stale revisions fail. */
  id?: string; revision?: number
  scope: MemoryScope; ownerId: string; kind: MemoryKind
  subject: string; topic: string; body: string; evidence: string
  effectiveAt?: number; expiresAt?: number
  /** Explicit operator permission to broaden an existing memory's audience or share user memory. */
  share?: boolean
}
export interface MemoryAction { id: string; revision: number; action: 'approve' | 'forget' }
export interface MemoryListRequest { scope?: MemoryScope; ownerId?: string; status?: MemoryStatus; query?: string }
export interface MemoryOwner { id: string; name: string }
export interface MemoryCatalog { users: MemoryOwner[] }
export interface MemorySelection {
  records: Memory[]
  conflicts: string[][]
  omitted: number
  /** Serialized bounded data frame, also persisted in the native Session input. */
  text: string
}
export interface MemoryPreviewRequest { roomId: string; botId: string; userId?: string; query: string }
