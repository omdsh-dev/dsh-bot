/** Versioned atomic Bot/chat persistence on DSH's configured backend. */
import { z } from 'zod'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { BotId, RoomId, ChatMessageId, BotState } from './types.ts'
import { memorySchema } from './memory.ts'
import { usageLedgerSchema } from './usage-ledger.ts'
import { suggestionSchema } from './memory-governance.ts'

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
const questionItem = z.object({ id: z.string(), question: z.string(), detail: z.string().optional(), header: z.string().optional(), options: z.array(z.object({ label: z.string(), description: z.string().optional() })).optional(), multiSelect: z.boolean().optional() })
const answerSchema = z.object({ answers: z.array(z.object({ id: z.string(), selected: z.array(z.string()), custom: z.string().optional() })) })
export const messageSchema = z.object({ id: messageId, botId: botId.nullable(), text: z.string(),
      replyTo: messageId.nullable(), status: z.enum(['complete', 'queued', 'running', 'failed', 'canceled', 'interrupted']),
      error: z.string().nullable(), time: z.number(), external: externalMessage.optional(), allowDelegation: z.boolean().optional(),
      delegation: z.object({ rootId: messageId, task: z.string() }).optional(),
      executionSessionId: z.string().transform(SessionId).optional(), requestedTasks: z.array(z.object({ botId, task: z.string() })).optional(), awaiting: z.array(messageId).optional(), continuedBy: messageId.optional(), continuationOf: messageId.optional(), resultIds: z.array(messageId).optional(), collaborationCanceled: z.boolean().optional(), localOnly: z.boolean().optional(),
      context: z.object({ sessionId: z.string(), measuredAt: z.number(), tokens: z.number(), window: z.number(), measurement: z.enum(['provider', 'meter', 'characters', 'unknown']), memories: z.array(z.object({ id: z.string(), revision: z.number() })), conflicts: z.array(z.array(z.string())), omitted: z.number(), recalls: z.number() }).optional(),
      attachments: z.array(attachmentSchema).max(8).optional(), questions: z.array(z.object({ id: z.string(), callId: z.string(), questions: z.array(questionItem) })).optional(), questionReply: z.object({ callId: z.string(), questions: z.array(questionItem), answer: answerSchema }).optional(), toolDetails: z.array(z.object({ name: z.string(), arguments: z.string(), result: z.string().optional() })).optional(), usage: usage.optional(), scheduleId: z.string().optional(), publishExternal: z.boolean().optional(), notifyBot: botId.optional() })
const budgetSchema = z.object({ tokenLimit: z.number().nonnegative(), costLimit: z.number().nonnegative(), currency: z.string(), used: usage, since: z.number(), period: z.enum(['never', 'day', 'month']).optional(), reservationTokens: z.number().nonnegative().optional(), reservationCost: z.number().nonnegative().optional() })
const schema: z.ZodType<BotState> = z.object({
  historyVersion: z.number().optional(),
  usageLedger: usageLedgerSchema.optional(),
  memorySuggestions: z.array(suggestionSchema).optional(),
  memories: z.array(memorySchema).optional(), memoryChunks: z.array(z.string()).optional(), retiredMemoryChunks: z.array(z.string()).optional(), memoryEpoch: z.number().int().nonnegative().optional(),
  knowledgeSettings: z.object({ reviewEnabled: z.boolean() }).optional(),
  userIdentities: z.array(z.object({ id: z.string(), name: z.string(), aliases: z.array(z.string()) })).optional(),
  maintenanceUsage: z.array(z.object({ botId: z.string(), purpose: z.enum(['memory', 'handoff']), input: z.number(), output: z.number(), cost: z.number(), calls: z.number() })).optional(),
  memoryReviews: z.array(z.object({ id: z.string(), roomId: z.string(), messageId: z.string(), botId: z.string(), status: z.enum(['pending', 'running', 'complete', 'failed', 'skipped']), attempts: z.number().int().nonnegative(), nextAt: z.number(), createdAt: z.number(), finishedAt: z.number().optional(), error: z.string().optional(), candidates: z.number().optional() })).optional(),
  infoflowVisible: z.boolean().optional(),
  retiredBotIds: z.array(botId).optional(),
  budget: budgetSchema.optional(),
  botBudgets: z.record(z.string(), budgetSchema).optional(),
  budgetReservations: z.record(z.string(), z.array(z.object({ scope: z.string(), tokens: z.number(), cost: z.number() }))).optional(),
  schedules: z.array(z.object({ id: z.string(), roomId: z.string().transform(brandString<RoomId>), name: z.string(), text: z.string(),
    calendar: z.object({ timeZone: z.string(), time: z.string(), weekdays: z.array(z.number()) }).optional(), targets: z.array(botId), nextAt: z.number(), intervalMinutes: z.number().nonnegative(), enabled: z.boolean(),
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
    members: z.array(z.object({ botId, sessionId: z.string().transform(SessionId), cursor: z.number().int().nonnegative(), segments: z.array(z.object({ sessionId: z.string(), endedAt: z.number(), reason: z.string(), nextSessionId: z.string().optional(), handoff: z.string().optional() })).optional(), handoff: z.string().optional(), memoryEpoch: z.number().int().nonnegative().optional(), requiredMemoryEpoch: z.number().int().nonnegative().optional(), contextDecisions: z.array(z.object({ time: z.number(), action: z.string(), before: z.number(), after: z.number(), window: z.number() })).optional() })),
    historyChunks: z.array(z.string()).optional(),
    participants: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
    messages: z.array(messageSchema),
  })),
})
/** Additive v1 upgrade: missing external fields mean local data; existing IDs are retained. */
export const botDomain = defineDomain({ name: 'bot_mode', version: 1, tables: {}, global: { schema, initial: { bots: [], rooms: [] } } })
