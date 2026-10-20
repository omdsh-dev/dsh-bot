/** Versioned atomic Bot/chat persistence on DSH's configured backend. */
import { z } from 'zod'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { BotId, RoomId, ChatMessageId, BotState } from './types.ts'

const botId = z.string().transform(brandString<BotId>)
const messageId = z.string().transform(brandString<ChatMessageId>)
const externalConversation = z.object({ provider: z.enum(['infoflow', 'feishu']), accountId: z.string().min(1),
  kind: z.enum(['private', 'group']), id: z.string().min(1) })
const externalMessage = z.object({ id: z.string().min(1), sender: z.object({ id: z.string().min(1), name: z.string() }),
  sources: z.array(z.object({ accountId: z.string(), senderId: z.string() })).optional() })
const usage = z.object({ input: z.number().nonnegative(), output: z.number().nonnegative(), cost: z.number().nonnegative() })
export const attachmentSchema = z.object({ type: z.enum(['image', 'file']), attachment: z.object({
  attachmentId: z.string(), name: z.string(), bytes: z.number().int().nonnegative(),
  mediaType: z.string().optional(), width: z.number().optional(), height: z.number().optional(),
}), transcript: z.string().optional() })
const schema: z.ZodType<BotState> = z.object({
  infoflowVisible: z.boolean().optional(),
  retiredBotIds: z.array(botId).optional(),
  budget: z.object({ tokenLimit: z.number().nonnegative(), costLimit: z.number().nonnegative(), currency: z.string(), used: usage, since: z.number() }).optional(),
  schedules: z.array(z.object({ id: z.string(), roomId: z.string().transform(brandString<RoomId>), name: z.string(), text: z.string(),
    targets: z.array(botId), nextAt: z.number(), intervalMinutes: z.number().nonnegative(), enabled: z.boolean(),
    allowDelegation: z.boolean(), notify: z.boolean(), lastAt: z.number().optional(), lastMessageId: messageId.optional(), error: z.string().optional() })).optional(),
  bots: z.array(z.object({ id: botId, name: z.string(), instructions: z.string(), preset: z.string(), archived: z.boolean().optional(),
    policy: z.object({ provider: z.string().optional(), model: z.string().optional(), fileMode: z.enum(['inherit', 'read-only', 'workspace-write']).optional(), toolMode: z.enum(['inherit', 'none', 'allow']).optional(),
      tools: z.array(z.string()).optional(), inputPrice: z.number().nonnegative().optional(), outputPrice: z.number().nonnegative().optional() }).optional() })),
  rooms: z.array(z.object({
    id: z.string().transform(brandString<RoomId>), title: z.string(), kind: z.enum(['dm', 'group']),
    defaultBot: botId,
    external: externalConversation.optional(),
    aliases: z.array(z.string().transform(brandString<RoomId>)).optional(),
    archived: z.boolean().optional(), deleted: z.boolean().optional(),
    members: z.array(z.object({ botId, sessionId: z.string().transform(SessionId), cursor: z.number().int().nonnegative() })),
    messages: z.array(z.object({ id: messageId, botId: botId.nullable(), text: z.string(),
      replyTo: messageId.nullable(), status: z.enum(['complete', 'queued', 'running', 'failed', 'canceled', 'interrupted']),
      error: z.string().nullable(), time: z.number(), external: externalMessage.optional(), allowDelegation: z.boolean().optional(),
      delegation: z.object({ rootId: messageId, task: z.string() }).optional(), localOnly: z.boolean().optional(),
      attachments: z.array(attachmentSchema).max(8).optional(), usage: usage.optional(), scheduleId: z.string().optional(), publishExternal: z.boolean().optional(), notifyBot: botId.optional() })),
  })),
})
/** Additive v1 upgrade: missing external fields mean local data; existing IDs are retained. */
export const botDomain = defineDomain({ name: 'bot_mode', version: 1, tables: {}, global: { schema, initial: { bots: [], rooms: [] } } })
