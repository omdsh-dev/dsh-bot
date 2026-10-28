/** Durable robot references and platform group creation outcomes; no credential values. */
import { z } from 'zod'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { BotId, RoomId, InfoFlowGroupView } from '../types.ts'
export interface Binding {
  botId: BotId; agentId: string; robotId: string; robotName: string; enabled: boolean
  appKeyRef: string; appSecretRef: string; allowUsers: string[]; allowGroups: string[]; allowAllGroups?: boolean | undefined; admins: string[]
}
export interface Settings { bindings: Binding[]; groups: InfoFlowGroupView[]; groupInviteAllowlist?: string[] | undefined }
const botId = z.string().transform(brandString<BotId>)
const schema: z.ZodType<Settings> = z.object({
  groupInviteAllowlist: z.array(z.string()).optional(),
  bindings: z.array(z.object({ botId, agentId: z.string(), robotId: z.string(), robotName: z.string(), enabled: z.boolean(),
    appKeyRef: z.string(), appSecretRef: z.string(), allowUsers: z.array(z.string()), allowGroups: z.array(z.string()), allowAllGroups: z.boolean().optional(), admins: z.array(z.string()) })),
  groups: z.array(z.object({ requestId: z.string(), title: z.string(), groupId: z.string(), roomId: z.string().transform(brandString<RoomId>).nullable(),
    botIds: z.array(botId), defaultBot: botId, owner: z.string(), members: z.array(z.string()),
    status: z.enum(['creating', 'linking', 'ready', 'uncertain']), warning: z.string().nullable() })),
})
export const settingsDomain = defineDomain({ name: 'bot_infoflow_settings', version: 1, tables: {}, global: { schema, initial: { bindings: [], groups: [] } } })
