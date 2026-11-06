import type { TaskPolicy } from './task-policy.ts'
import type { BotId, ChatAttachment, ChatMessageId, RoomId } from './types.ts'

/** One explicit invitation owns its context and result across retries and restarts. */
export interface InviteBotRequest {
  requestId: string
  roomId: RoomId
  botId: BotId
  background: string
  messageIds?: ChatMessageId[] | undefined
  /** Required for IM DMs. Never inferred from another configured human. */
  owner?: string | undefined
}
export interface BotInvitation {
  request: InviteBotRequest
  coordinator: BotId
  title: string
  text: string
  attachments: ChatAttachment[]
  /** Host-captured constraints from the explicitly shared/confirmed task. */
  taskPolicy?: TaskPolicy | undefined
  createdAt: number
  status: 'pending' | 'ready'
  roomId?: RoomId | undefined
}
export interface InvitationCandidate {
  id: BotId; name: string; capabilities: string
  status: 'available' | 'member' | 'binding-required' | 'disconnected'
}
export interface InvitationView {
  candidates: InvitationCandidate[]
  ownerChoices: string[]
  pending: BotInvitation[]
}
export interface GroupBotInvite {
  requestId: string; groupId: string; title: string; botIds: BotId[]; defaultBot: BotId
}
export interface CollaborationProposal { taskPolicy?: TaskPolicy | undefined; id: string; botId: BotId; background: string; actor?: { provider: 'feishu' | 'infoflow'; accountId: string; senderId: string } | undefined }
