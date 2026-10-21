/** Connector-owned durable admission queue and outbound delivery records. */
import { z } from 'zod'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { BotId, ChatAttachment, ChatMessageId, ExternalRoomRequest, RoomId } from '../types.ts'
import { attachmentSchema } from '../domain.ts'
import type { Incoming } from './messages.ts'

/** Accepted request with its immutable routing decision. */
export interface Pending {
  key: string
  input: Incoming
  binding: ExternalRoomRequest
  submitted?: { roomId: RoomId; attemptIds: ChatMessageId[] } | undefined
  delivered?: ChatMessageId[] | undefined
  announced?: ChatMessageId[] | undefined
  stop?: { roomId: RoomId; attemptIds: ChatMessageId[] } | undefined
  attempts?: number | undefined
  nextAt?: number | undefined
}
/** A chunk is removed only after the platform confirms sending it. */
export interface RobotMention { id: string; name: string }
export interface Delivery { id: string; conversation: Incoming['conversation']; user: string; text: string; attempts: number; nextAt: number; botId?: BotId | undefined; mentions?: RobotMention[] | undefined; attachment?: ChatAttachment | undefined }
/** Failed work is retained for inspection without blocking subsequent work. */
export interface FailedWork { time: number; reason: 'permanent' | 'exhausted'; pending?: Pending | undefined; delivery?: Delivery | undefined }
/** Receipt and notice windows are bounded; native room receipts also prevent turn replay. */
export interface BridgeState { windows?: Partial<Record<'receipts' | 'notices', { chunks: string[]; offset: number } | undefined>> | undefined; receipts: string[]; pending: Pending[]; outbox: Delivery[]; notices: string[]; failed?: FailedWork[] | undefined; notificationCursors?: Record<string, number> | undefined }
const conversation = z.object({ provider: z.enum(['infoflow', 'feishu']), accountId: z.string().min(1), kind: z.enum(['private', 'group']), id: z.string().min(1) })
const message = z.object({ id: z.string().min(1), sender: z.object({ id: z.string().min(1), name: z.string() }) })
const attempts = z.object({ roomId: z.string().transform(brandString<RoomId>), attemptIds: z.array(z.string().transform(brandString<ChatMessageId>)) })
const pendingSchema = z.object({ key: z.string(), input: z.object({ conversation, message, text: z.string(), attachments: z.array(attachmentSchema).optional(), media: z.object({ accountId: z.string(), resources: z.array(z.object({ key: z.string(), type: z.enum(['image', 'file', 'audio']), name: z.string() })).optional() }).optional(), targets: z.array(z.string().transform(brandString<BotId>)).optional() }),
    binding: z.object({ conversation, title: z.string(), botIds: z.array(z.string().transform(brandString<BotId>)), defaultBot: z.string().transform(brandString<BotId>) }),
    submitted: attempts.optional(), stop: attempts.optional(), delivered: z.array(z.string().transform(brandString<ChatMessageId>)).optional(),
    announced: z.array(z.string().transform(brandString<ChatMessageId>)).optional(),
    attempts: z.number().int().nonnegative().optional(), nextAt: z.number().optional() })
const deliverySchema = z.object({ id: z.string(), conversation, user: z.string(), text: z.string(), attempts: z.number().int().nonnegative(), nextAt: z.number(), botId: z.string().transform(brandString<BotId>).optional(),
    attachment: attachmentSchema.optional(), mentions: z.array(z.object({ id: z.string().min(1), name: z.string() })).max(10).optional() })
export const bridgeSchema: z.ZodType<BridgeState> = z.object({
  windows: z.object({ receipts: z.object({ chunks: z.array(z.string()), offset: z.number().int().nonnegative() }).optional(), notices: z.object({ chunks: z.array(z.string()), offset: z.number().int().nonnegative() }).optional() }).optional(),
  receipts: z.array(z.string()), notices: z.array(z.string()),
  pending: z.array(pendingSchema), outbox: z.array(deliverySchema),
  notificationCursors: z.record(z.string(), z.number().int().nonnegative()).optional(),
  failed: z.array(z.object({ time: z.number(), reason: z.enum(['permanent', 'exhausted']),
    pending: pendingSchema.optional(), delivery: deliverySchema.optional() })).optional(),
})
/** Separate authoritative state; no SDK credentials or native execution logs are copied here. */
export const infoflowDomain = defineDomain({ name: 'bot_infoflow', version: 1, tables: {},
  global: { schema: bridgeSchema, initial: { receipts: [], pending: [], outbox: [], notices: [] } } })

/** Each managed robot or shared group owns an independent queue. */
export function bridgeDomain(name: string) { return defineDomain({ name, version: 1, tables: {},
  global: { schema: bridgeSchema, initial: { receipts: [], pending: [], outbox: [], notices: [] } } }) }
