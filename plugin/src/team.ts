import { z } from 'zod'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { BotState, ChatMessage, Room } from './types.ts'
import type { TeamCommand, TeamSettings } from './team-types.ts'
import { optionalService } from './compatibility.ts'

export const teamOperation = z.enum(['create-bot', 'edit-bot', 'create-group', 'edit-group', 'archive'])
export const teamSettingsSchema: z.ZodType<TeamSettings> = z.object({ revision: z.number().int().nonnegative(), botId: z.string().nullable(), operations: z.array(teamOperation).max(5) }).strict()
export const teamAuditSchema = z.object({ id: z.string(), time: z.number(), botId: z.string(), roomId: z.string(), messageId: z.string(), operation: teamOperation, targetId: z.string() })
const id = z.string().min(1).max(100), title = z.string().trim().min(1).max(200)
const command: z.ZodType<TeamCommand> = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('create-bot'), id, name: title, instructions: z.string().max(16000), capabilities: z.string().max(500).optional() }).strict(),
  z.object({ operation: z.literal('edit-bot'), id, name: title, instructions: z.string().max(16000), capabilities: z.string().max(500).optional() }).strict(),
  z.object({ operation: z.literal('create-group'), title, botIds: z.array(id).min(1).max(16), defaultBot: id }).strict(),
  z.object({ operation: z.literal('edit-group'), id, title, botIds: z.array(id).min(1).max(16), defaultBot: id }).strict(),
  z.object({ operation: z.literal('archive'), kind: z.enum(['bot', 'room']), id, archived: z.boolean() }).strict(),
])
export function parseTeamCommand(raw: string): TeamCommand {
  if (raw.length > 24000) throw new Error('Team command is too large')
  return command.parse(JSON.parse(raw))
}
/** Only a direct local operator delivery can carry team authority. */
export function teamAuthority(state: BotState, room: Room, delivery: ChatMessage, revision?: number): TeamSettings {
  const settings = state.teamSettings, human = room.messages.find(item => item.id === delivery.replyTo)
  if (!settings?.botId || settings.botId !== delivery.botId || !state.bots.some(bot => bot.id === delivery.botId && !bot.archived)
    || !settings.operations.length || revision !== undefined && revision !== settings.revision
    || room.kind !== 'dm' || room.external || room.archived || room.deleted || room.defaultBot !== delivery.botId
    || delivery.status !== 'running' || delivery.delegation || delivery.continuationOf || !human || human.botId !== null || human.external || human.scheduleId) {
    throw new Error('Team management requires the current Main Bot grant and a direct operator message in its local chat')
  }
  return settings
}
export function installTeamTools(agent: Agent, actions: { list(): unknown; manage(command: TeamCommand, callId: string): Promise<unknown> }): () => void {
  const registry = optionalService<Agent['ctx']['tools']>(agent.ctx, 'tools')
  if (!registry) return () => {}
  const verify = (exec: { agent?: unknown; signal: AbortSignal }) => { if (exec.agent !== agent || exec.signal.aborted) throw new Error('This team tool belongs to the current delivery') }
  const output = { schema: { type: 'object' as const, additionalProperties: false, properties: { result: { type: 'string' as const, required: true as const } } }, render: (_args: unknown, value: { result: string }) => [{ type: 'text' as const, text: value.result }] }
  const close = [registry.register(defineTool({ name: 'team_list', parameters: {}, output,
    description: 'List local Bot identities, local group rosters and the operator-granted team operations. No private chat, memories, credentials or connector configuration are exposed.',
    async execute(_args, exec) { verify(exec); return { result: JSON.stringify(actions.list()) } },
  })), registry.register(defineTool({ name: 'team_manage', output,
    description: 'Perform an operator-requested team operation within your granted scope. command is JSON: {operation:"create-bot"|"edit-bot",id,name,instructions,capabilities?}; {operation:"create-group",title,botIds,defaultBot}; {operation:"edit-group",id,title,botIds,defaultBot}; {operation:"archive",kind:"bot"|"room",id,archived:boolean}. No policies, presets, credentials, capability grants, budgets, external chats or deletion can be changed. Cannot edit or archive yourself. Check discover_bots and team_list first to avoid unnecessary duplicate Bots. Include a concise public capabilities description when creating a specialist; never copy private instructions or secrets into it. A recommendation alone is not human acceptance to create. Preserve operator constraints. Limit 20 successful changes per request.',
    parameters: { command: { type: 'string', required: true } },
    async execute(args, exec) { verify(exec); return { result: JSON.stringify(await actions.manage(parseTeamCommand(args.command), exec.callId)) } },
  }))]
  return () => { for (const unregister of close.reverse()) unregister() }
}
