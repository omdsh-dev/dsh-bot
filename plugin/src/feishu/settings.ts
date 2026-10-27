/** Native versioned settings store; secret values belong to DSH credentials. */
import { z } from 'zod'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { BotId, RoomId } from '../types.ts'
import type { FeishuBindingView, FeishuRegistration, FeishuGroupView } from './types.ts'
export interface Binding extends Omit<FeishuBindingView, 'status' | 'error' | 'credentialsConfigured'> { secretRef: string }
export interface RegistrationRecord { botId: BotId; attemptId: string; purpose?: 'permissions' | undefined; status: FeishuRegistration['status']; message: string | null }
export interface Settings { bindings: Binding[]; registrations: RegistrationRecord[]; groups: FeishuGroupView[] }
const botId = z.string().transform(brandString<BotId>)
const schema: z.ZodType<Settings> = z.object({
  bindings: z.array(z.object({ botId, appId: z.string(), botOpenId: z.string(), robotName: z.string(), brand: z.enum(['feishu', 'lark']), enabled: z.boolean(),
    secretRef: z.string(), allowUsers: z.array(z.string()), allowGroups: z.array(z.string()), allowAllGroups: z.boolean().optional(), admins: z.array(z.string()) })),
  groups: z.array(z.object({ requestId: z.string(), title: z.string(), botIds: z.array(botId), creatorBot: botId, owner: z.string(), createdAt: z.number(),
    chatId: z.string().nullable(), roomId: z.string().transform(brandString<RoomId>).nullable(),
    status: z.enum(['creating', 'uncertain', 'failed', 'linking', 'ready']), error: z.string().nullable() })).default([]),
  registrations: z.array(z.object({ botId, attemptId: z.string(), purpose: z.literal('permissions').optional(), status: z.enum(['starting', 'waiting', 'saving', 'complete', 'canceled', 'expired', 'error', 'interrupted']), message: z.string().nullable() })),
})
export const settingsDomain = defineDomain({ name: 'bot_feishu_settings', version: 1, tables: {}, global: { schema, initial: { bindings: [], registrations: [], groups: [] } } })
