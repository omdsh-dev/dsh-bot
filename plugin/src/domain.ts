/** Versioned atomic Bot/chat persistence on DSH's configured backend. */
import { z } from 'zod'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { BotId, RoomId, ChatMessageId, BotState } from './types.ts'

const botId = z.string().transform(brandString<BotId>)
const messageId = z.string().transform(brandString<ChatMessageId>)
const schema: z.ZodType<BotState> = z.object({
  bots: z.array(z.object({ id: botId, name: z.string(), instructions: z.string(), preset: z.string() })),
  rooms: z.array(z.object({
    id: z.string().transform(brandString<RoomId>), title: z.string(), kind: z.enum(['dm', 'group']),
    defaultBot: botId,
    members: z.array(z.object({ botId, sessionId: z.string().transform(SessionId), cursor: z.number().int().nonnegative() })),
    messages: z.array(z.object({ id: messageId, botId: botId.nullable(), text: z.string(),
      replyTo: messageId.nullable(), status: z.enum(['complete', 'running', 'failed', 'canceled', 'interrupted']),
      error: z.string().nullable(), time: z.number() })),
  })),
})
/** Atomic, versioned Bot Mode storage declaration. */
export const botDomain = defineDomain({ name: 'bot_mode', version: 1, tables: {}, global: { schema, initial: { bots: [], rooms: [] } } })
