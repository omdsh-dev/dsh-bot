import type { ContextSegment, ContextTrace, KnowledgeSettings, MaintenanceUsage, MemoryReview, UserIdentity } from './knowledge-types.ts'
/** Serializable Bot Mode domain and Remote contract. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { Memory, MemorySuggestion } from './memory-types.ts'
import type { UsageLedger } from './usage-types.ts'
import type { AccessState } from './access-types.ts'
import type { ChatCard } from './card-types.ts'
import type { TeamActor, TeamAudit, TeamSettings } from './team-types.ts'
export type * from './memory-types.ts'

/** Stable, case-insensitive Bot handle. */
export type BotId = Branded<'BotMode.BotId'>
/** Persistent chat identity. */
export type RoomId = Branded<'BotMode.RoomId'>
/** Public chat message identity. */
export type ChatMessageId = Branded<'BotMode.ChatMessageId'>
/** Stable provider account and conversation identity; platform IDs stay strings. */
export interface ExternalConversation { provider: 'infoflow' | 'feishu'; accountId: string; kind: 'private' | 'group'; id: string }
/** Original human identity and provider message receipt. */
export interface ExternalMessage { id: string; sender: { id: string; name: string }; sources?: { accountId: string; senderId: string }[] | undefined }
/** Create or resolve a dedicated external room without reusing a local DM. */
export interface ExternalRoomRequest { conversation: ExternalConversation; title: string; botIds: BotId[]; defaultBot: BotId; preserveTitle?: boolean }
/** Idempotent Host-only ingress. A busy result leaves the request uncommitted. */
export interface ExternalSendRequest extends SendRequest { external: ExternalMessage; sourceAccountId?: string; allowDelegation?: boolean }
/** Accepted receipts return this delivery's target response IDs, including on redelivery. */
export type ExternalSendResult = { status: 'busy' } | { status: 'rejected'; reason: 'room-full' | 'invalid-input' }
  | { status: 'accepted'; messageId: ChatMessageId; attemptIds: ChatMessageId[] }
/** Reusable Bot identity; each membership owns a separate Session. */
export interface Bot { id: BotId; name: string; instructions: string; capabilities?: string | undefined; preset: string; archived?: boolean | undefined; policy?: BotPolicy | undefined }
/** Optional restrictions only narrow the deployment's existing permissions. */
export interface BotPolicy {
  provider?: string | undefined; model?: string | undefined
  fileMode?: 'inherit' | 'read-only' | 'workspace-write' | undefined
  toolMode?: 'inherit' | 'none' | 'allow' | undefined
  tools?: string[] | undefined
  /** Price per million tokens, in the budget's configured currency. */
  inputPrice?: number | undefined; outputPrice?: number | undefined
}
/** Native immutable attachment reference; binary bytes never enter the chat snapshot. */
export interface ChatAttachment {
  type: 'image' | 'file'
  attachment: { attachmentId: string; name: string; bytes: number; mediaType?: string | undefined; width?: number | undefined; height?: number | undefined }
  transcript?: string | undefined
}
export interface UploadRequest { name: string; mediaType: string; base64: string; transcribe?: boolean }
export interface Usage { input: number; output: number; cost: number }
export interface Budget { tokenLimit: number; costLimit: number; currency: string; used: Usage; since: number; period?: 'never' | 'day' | 'month' | undefined; reservationTokens?: number | undefined; reservationCost?: number | undefined }
export interface ConfigureBudget { tokenLimit: number; costLimit: number; currency: string; reset?: boolean; botId?: BotId; period?: 'never' | 'day' | 'month'; reservationTokens?: number; reservationCost?: number }
/** One Bot's persistent context and consumed public-history position. */
export interface Member { botId: BotId; sessionId: SessionId; cursor: number; segments?: ContextSegment[] | undefined; handoff?: string | undefined; memoryEpoch?: number | undefined; requiredMemoryEpoch?: number | undefined; contextDecisions?: { time: number; action: string; before: number; after: number; window: number }[] | undefined }
/** A public user message or one Bot's response attempt. */
export interface ChatMessage {
  id: ChatMessageId
  botId: BotId | null
  text: string
  replyTo: ChatMessageId | null
  status: 'complete' | 'queued' | 'running' | 'failed' | 'canceled' | 'interrupted'
  error: string | null
  time: number
  external?: ExternalMessage | undefined
  /** Set only by connectors that can deliver every delegated Bot's reply. */
  allowDelegation?: boolean | undefined
  /** Child reply belongs to its Bot parent and retains the original human authority. */
  delegation?: { rootId: ChatMessageId; task: string } | undefined
  executionSessionId?: SessionId | undefined
  context?: ContextTrace | undefined
  cards?: ChatCard[] | undefined
  requestedTasks?: { botId: BotId; task: string }[] | undefined
  awaiting?: ChatMessageId[] | undefined
  continuedBy?: ChatMessageId | undefined
  continuationOf?: ChatMessageId | undefined
  resultIds?: ChatMessageId[] | undefined
  collaborationCanceled?: boolean | undefined
  /** Sent from DSH into an external group; neither the request nor its replies reach the platform. */
  localOnly?: boolean | undefined
  attachments?: ChatAttachment[] | undefined
  usage?: Usage | undefined
  questions?: (QuestionView & { callId: string })[] | undefined
  questionReply?: { callId: string; questions: QuestionItem[]; answer: QuestionAnswer } | undefined
  toolDetails?: { name: string; arguments: string; result?: string | undefined }[] | undefined
  /** Durable receipt: retries must not restore an older user-supplied group name. */
  groupNameUpdate?: { title: string; callId: string; time: number; actor: TeamActor } | undefined
  /** Transient projection, never persisted with token-level updates. */
  progress?: { phase: string; tools: string[]; approvalId?: string | undefined; reason?: string | undefined; arguments?: string | undefined; question?: QuestionView | undefined } | undefined
  /** Explicitly configured scheduler source, used for auditing and notification idempotency. */
  scheduleId?: string | undefined
  publishExternal?: boolean | undefined
  notifyBot?: BotId | undefined
}
/** Canonical DM or explicitly composed group. */
export interface Room {
  id: RoomId
  title: string
  kind: 'dm' | 'group'
  members: Member[]
  defaultBot: BotId
  messages: ChatMessage[]
  external?: ExternalConversation | undefined
  /** Previous room IDs retained for queued replies and saved selections after a merge. */
  aliases?: RoomId[] | undefined
  archived?: boolean | undefined
  /** Tombstones retain external receipts to prevent replay after deletion. */
  deleted?: boolean | undefined
  messageCount?: number | undefined
  /** Immutable archived history; snapshots expose the recent/unfinished tail. */
  historyChunks?: string[] | undefined
  /** Historic identities remain available without loading archived message bodies. */
  participants?: { id: string; name: string }[] | undefined
}
/** Atomic persisted state; also the detached Client baseline. */
export interface BotState {
  bots: Bot[]; rooms: Room[]
  historyVersion?: number | undefined
  access?: AccessState | undefined
  teamSettings?: TeamSettings | undefined
  teamAudit?: TeamAudit[] | undefined
  /** Storage-only independent accounting ledger; snapshots exclude call metadata. */
  usageLedger?: UsageLedger | undefined
  /** Storage-only records. Ordinary snapshots/feed exclude them; management uses dedicated APIs. */
  memories?: Memory[] | undefined
  memorySuggestions?: MemorySuggestion[] | undefined
  memoryChunks?: string[] | undefined
  retiredMemoryChunks?: string[] | undefined
  memoryEpoch?: number | undefined
  knowledgeSettings?: KnowledgeSettings | undefined
  memoryReviews?: MemoryReview[] | undefined
  userIdentities?: UserIdentity[] | undefined
  maintenanceUsage?: MaintenanceUsage[] | undefined
  /** Profile-wide UI preference. Missing in older data; existing InfoFlow use keeps its entry visible. */
  infoflowVisible?: boolean | undefined
  budget?: Budget | undefined
  botBudgets?: Record<string, Budget> | undefined
  budgetReservations?: Record<string, { scope: string; tokens: number; cost: number }[]> | undefined
  retiredBotIds?: BotId[] | undefined
  schedules?: Schedule[] | undefined
}
export interface Schedule {
  id: string; roomId: RoomId; name: string; text: string; targets: BotId[]
  calendar?: CalendarRule | undefined
  nextAt: number; intervalMinutes: number; enabled: boolean
  allowDelegation: boolean; notify: boolean
  lastAt?: number | undefined; lastMessageId?: ChatMessageId | undefined; error?: string | undefined
}
export interface SaveScheduleRequest {
  id?: string; roomId: RoomId; name: string; text: string; targets: BotId[]
  calendar?: CalendarRule | undefined
  nextAt: number; intervalMinutes: number; enabled: boolean; allowDelegation: boolean; notify: boolean
}
export interface HistoryRequest { roomId: RoomId; before?: ChatMessageId; limit?: number; query?: string }
export interface HistoryPage { messages: ChatMessage[]; before: ChatMessageId | null; total: number }
export interface LifecycleRequest { kind: 'bot' | 'room'; id: string; action: 'archive' | 'restore' | 'delete' }
export interface FailureView {
  provider: 'infoflow' | 'feishu'; queue: string; id: string; time: number
  kind: 'admission' | 'media' | 'delivery'; reason: string; destination: string; text: string; attempts: number
}
export interface FailureAction { provider: 'infoflow' | 'feishu'; queue: string; id: string; action: 'retry' | 'discard' }
/** Reconnecting feed replaces the complete small-domain snapshot. */
export type BotFrame = { type: 'baseline'; value: BotState } | { type: 'changed'; value: BotState }
/** Create one Bot and its canonical direct chat atomically. */
export interface CreateBotRequest { id: string; name: string; instructions: string; capabilities?: string; preset?: string }
/** Edit a Bot's display identity. The handle and preset stay fixed for existing Sessions. */
export interface UpdateBotRequest { id: BotId; name: string; instructions: string; capabilities?: string; policy?: BotPolicy }
/** Create a group from existing Bots. */
export interface CreateGroupRequest { title: string; botIds: BotId[]; defaultBot: BotId }
/** Edit group membership while all its response attempts are settled. */
export interface MembersRequest { roomId: RoomId; botIds: BotId[]; defaultBot: BotId }
/** A public prompt with optional explicit recipients or reply routing. */
export interface SendRequest { roomId: RoomId; text: string; targets?: BotId[]; replyTo?: ChatMessageId; allowDelegation?: boolean; attachments?: ChatAttachment[]; notify?: boolean }
/** A stop/retry command addresses one response attempt. */
export interface AttemptRequest { roomId: RoomId; messageId: ChatMessageId }
/** External /stop cancels the original request's complete delegation tree. */
export interface StopRequest extends AttemptRequest { cascade?: boolean }

/** Public connector state never contains credential values. */
export interface InfoFlowBindingView {
  botId: BotId; agentId: string; robotId: string; robotName: string; enabled: boolean
  status: 'disabled' | 'connecting' | 'connected' | 'error'; error: string | null
  allowUsers: string[]; allowGroups: string[]; allowAllGroups?: boolean; admins: string[]; credentialsConfigured: boolean
}
/** Group creation records survive uncertain network outcomes without creating another group. */
export interface InfoFlowGroupView {
  requestId: string; title: string; groupId: string; roomId: RoomId | null; botIds: BotId[]; defaultBot: BotId
  owner: string; members: string[]; status: 'creating' | 'linking' | 'ready' | 'uncertain'; warning: string | null
}
export interface InfoFlowState { available: boolean; bindings: InfoFlowBindingView[]; groups: InfoFlowGroupView[] }
/** Empty credential fields retain saved values. Only connect: true enables a new binding. */
export interface SaveInfoFlowBindingRequest {
  botId: BotId; appKey?: string; appSecret?: string; agentId?: string; connect?: boolean; allowAllGroups?: boolean; allowUsers: string[]; allowGroups: string[]; admins: string[]
}
/** Send a fixed diagnostic message to one saved private-chat account; never invokes a Bot. */
export interface TestInfoFlowRequest { botId: BotId; user: string }
export interface ToggleInfoFlowRequest { botId: BotId; enabled: boolean }
/** Stable browser request ID prevents duplicate platform groups after retries. */
export interface CreateInfoFlowGroupRequest extends CreateGroupRequest { requestId: string; owner: string; members: string[] }

/** Calendar recurrence uses an explicit IANA zone; weekdays use ISO 1=Monday … 7=Sunday. */
export interface CalendarRule { timeZone: string; time: string; weekdays: number[] }
export interface ScheduleRun { messageId: ChatMessageId; time: number; status: ChatMessage['status']; replies: { botId: BotId | null; status: ChatMessage['status']; text: string; error: string | null }[] }
export interface QuestionItem { id: string; question: string; detail?: string | undefined; header?: string | undefined; options?: { label: string; description?: string | undefined }[] | undefined; multiSelect?: boolean | undefined }
export interface QuestionAnswer { answers: { id: string; selected: string[]; custom?: string | undefined }[] }
export interface QuestionView { id: string; questions: QuestionItem[] }
export interface AttachmentRequest { roomId: RoomId; messageId: ChatMessageId; attachmentId: string }
export interface AttachmentData { name: string; mediaType: string; base64: string }
export interface CapabilityCatalog { providers: { id: string; models: { id: string; name: string }[]; error?: string | undefined }[]; tools: { name: string; description: string }[] }

export type * from './knowledge-types.ts'
export type * from './usage-types.ts'
export type * from './access-types.ts'
export type * from './card-types.ts'
export type * from './team-types.ts'
export type { UsageReport, UsageBudget, BotUsageRow, UsageTotals } from './usage.ts'
