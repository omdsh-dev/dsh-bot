/** Serializable Bot Mode domain and Remote contract. */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Stable, case-insensitive Bot handle. */
export type BotId = Branded<'BotMode.BotId'>
/** Persistent chat identity. */
export type RoomId = Branded<'BotMode.RoomId'>
/** Public chat message identity. */
export type ChatMessageId = Branded<'BotMode.ChatMessageId'>
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
}
/** Canonical DM or explicitly composed group. */
export interface Room {
  id: RoomId
  title: string
  kind: 'dm' | 'group'
  members: Member[]
  defaultBot: BotId
  messages: ChatMessage[]
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
