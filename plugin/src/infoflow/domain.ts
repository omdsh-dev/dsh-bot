/** Connector-owned durable admission queue and outbound delivery records. */
import { z } from 'zod'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { BotId, ChatMessageId, ExternalRoomRequest, RoomId } from '../types.ts'
import type { Incoming } from './messages.ts'

/** Accepted request with its immutable routing decision. */
export interface Pending {
  key: string
  input: Incoming
  binding: ExternalRoomRequest
  submitted?: { roomId: RoomId; attemptIds: ChatMessageId[] } | undefined
  stop?: { roomId: RoomId; attemptIds: ChatMessageId[] } | undefined
}
/** A chunk is removed only after the platform confirms sending it. */
export interface Delivery { id: string; conversation: Incoming['conversation']; user: string; text: string; attempts: number; nextAt: number; botId?: BotId | undefined }
/** Receipts are retained until the operator raises capacity or archives this deployment. */
export interface BridgeState { receipts: string[]; pending: Pending[]; outbox: Delivery[]; notices: string[] }
const conversation = z.object({ provider: z.enum(['infoflow', 'feishu']), accountId: z.string().min(1), kind: z.enum(['private', 'group']), id: z.string().min(1) })
const message = z.object({ id: z.string().min(1), sender: z.object({ id: z.string().min(1), name: z.string() }) })
const attempts = z.object({ roomId: z.string().transform(brandString<RoomId>), attemptIds: z.array(z.string().transform(brandString<ChatMessageId>)) })
export const bridgeSchema: z.ZodType<BridgeState> = z.object({
  receipts: z.array(z.string()), notices: z.array(z.string()),
  pending: z.array(z.object({ key: z.string(), input: z.object({ conversation, message, text: z.string(), targets: z.array(z.string().transform(brandString<BotId>)).optional() }),
    binding: z.object({ conversation, title: z.string(), botIds: z.array(z.string().transform(brandString<BotId>)), defaultBot: z.string().transform(brandString<BotId>) }),
    submitted: attempts.optional(), stop: attempts.optional() })),
  outbox: z.array(z.object({ id: z.string(), conversation, user: z.string(), text: z.string(), attempts: z.number().int().nonnegative(), nextAt: z.number(), botId: z.string().transform(brandString<BotId>).optional() })),
})
/** Separate authoritative state; no SDK credentials or native execution logs are copied here. */
export const infoflowDomain = defineDomain({ name: 'bot_infoflow', version: 1, tables: {},
  global: { schema: bridgeSchema, initial: { receipts: [], pending: [], outbox: [], notices: [] } } })

/** Each managed robot or shared group owns an independent queue. */
export function bridgeDomain(name: string) { return defineDomain({ name, version: 1, tables: {},
  global: { schema: bridgeSchema, initial: { receipts: [], pending: [], outbox: [], notices: [] } } }) }
