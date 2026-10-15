/** Serializable Bot Mode domain and Remote contract. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'

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
export interface ExternalRoomRequest { conversation: ExternalConversation; title: string; botIds: BotId[]; defaultBot: BotId }
/** Idempotent Host-only ingress. A busy result leaves the request uncommitted. */
export interface ExternalSendRequest extends SendRequest { external: ExternalMessage; sourceAccountId?: string }
/** Accepted receipts return this delivery's target response IDs, including on redelivery. */
export type ExternalSendResult = { status: 'busy' } | { status: 'rejected'; reason: 'room-full' | 'invalid-input' }
  | { status: 'accepted'; messageId: ChatMessageId; attemptIds: ChatMessageId[] }
/** Reusable Bot identity; each membership owns a separate Session. */
export interface Bot { id: BotId; name: string; instructions: string; preset: string }
/** One Bot's persistent context and consumed public-history position. */
export interface Member { botId: BotId; sessionId: SessionId; cursor: number }
/** A public user message or one Bot's response attempt. */
export interface ChatMessage {
  id: ChatMessageId
  botId: BotId | null
  text: string
  replyTo: ChatMessageId | null
  status: 'complete' | 'running' | 'failed' | 'canceled' | 'interrupted'
  error: string | null
  time: number
  external?: ExternalMessage | undefined
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
}
/** Atomic persisted state; also the detached Client baseline. */
export interface BotState { bots: Bot[]; rooms: Room[] }
/** Reconnecting feed replaces the complete small-domain snapshot. */
export type BotFrame = { type: 'baseline'; value: BotState } | { type: 'changed'; value: BotState }
/** Create one Bot and its canonical direct chat atomically. */
export interface CreateBotRequest { id: string; name: string; instructions: string; preset?: string }
/** Create a group from existing Bots. */
export interface CreateGroupRequest { title: string; botIds: BotId[]; defaultBot: BotId }
/** Edit group membership while all its response attempts are settled. */
export interface MembersRequest { roomId: RoomId; botIds: BotId[]; defaultBot: BotId }
/** A public prompt with optional explicit recipients or reply routing. */
export interface SendRequest { roomId: RoomId; text: string; targets?: BotId[]; replyTo?: ChatMessageId }
/** A stop/retry command addresses one response attempt. */
export interface AttemptRequest { roomId: RoomId; messageId: ChatMessageId }

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
