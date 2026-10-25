/** Narrow creation authority for an authenticated IM administrator's direct request. */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { BotState, ChatMessage, InfoFlowState, Room } from './types.ts'
import type { FeishuState } from './feishu/types.ts'
import type { TeamActor, TeamCommand } from './team-types.ts'
import { parseTeamCommand } from './team.ts'
import { optionalService } from './compatibility.ts'

export type IMBotDraft = Omit<Extract<TeamCommand, { operation: 'create-bot' }>, 'operation'>
export function parseIMBotDraft(raw: string): IMBotDraft {
  if (raw.length > 24000) throw new Error('Bot draft is too large')
  const draft: unknown = JSON.parse(raw)
  if (!draft || typeof draft !== 'object' || Array.isArray(draft) || 'operation' in draft) throw new Error('Expected a Bot draft')
  const parsed = parseTeamCommand(JSON.stringify({ ...draft, operation: 'create-bot' }))
  if (parsed.operation !== 'create-bot') throw new Error('Expected a Bot draft')
  const { operation: _, ...value } = parsed
  return value
}

export function imCreationAuthority(state: BotState, room: Room, delivery: ChatMessage,
  connectors: { feishu?: FeishuState | undefined; infoflow?: InfoFlowState | undefined }): TeamActor {
  const source = room.external, human = room.messages.find(item => item.id === delivery.replyTo)
  const denied = () => { throw new Error('IM Bot creation requires a direct message from this connection’s administrator; configure administrators in DSH Bots → IM 接入') }
  if (!source || room.archived || room.deleted || delivery.status !== 'running' || delivery.localOnly || delivery.delegation || delivery.continuationOf
    || !human || human.botId !== null || human.status !== 'complete' || !human.external || human.scheduleId || human.localOnly || human.delegation || human.continuationOf
    || !state.bots.some(bot => bot.id === delivery.botId && !bot.archived) || !room.members.some(member => member.botId === delivery.botId)) return denied()
  const bindings = source.provider === 'feishu' ? connectors.feishu?.bindings : connectors.infoflow?.bindings
  const binding = bindings?.find(item => item.botId === delivery.botId && item.enabled && item.status === 'connected')
  if (!binding) return denied()
  const accountId = 'appId' in binding ? binding.appId : binding.agentId
  if (source.kind === 'private') {
    // Feishu private conversations use oc_ chat IDs; only InfoFlow uses the sender as the conversation ID.
    const senderId = human.external.sender.id
    if (room.kind !== 'dm' || source.accountId !== accountId || source.provider === 'infoflow' && source.id !== senderId || !binding.allowUsers.includes(senderId) || !binding.admins.includes(senderId)) return denied()
    return { provider: source.provider, accountId, senderId }
  }
  if (room.kind !== 'group') return denied()
  // Managed InfoFlow groups use their own bridge and owner, not another binding's admins.
  const group = source.provider === 'infoflow' ? connectors.infoflow?.groups.find(item => item.groupId === source.id && item.status === 'ready' && item.botIds.includes(delivery.botId!)) : undefined
  if (group) {
    const groupAccount = `group:${group.groupId}`
    const senderId = human.external.sources?.find(item => item.accountId === groupAccount)?.senderId
    if (senderId !== group.owner) return denied()
    return { provider: source.provider, accountId: groupAccount, senderId }
  }
  // Open IDs differ across Feishu apps. Never borrow the first receiver's sender ID.
  const senderId = human.external.sources?.find(item => item.accountId === accountId)?.senderId
  if (!senderId || !binding.admins.includes(senderId) || !(binding.allowAllGroups || binding.allowGroups.includes(source.id))) return denied()
  return { provider: source.provider, accountId, senderId }
}

export function imBindingGuide() {
  return { status: 'not-bound', path: 'DSH Bots → IM 接入 → 飞书 / 如流 → 选择新 Bot',
    instructions: 'Bot 已创建，可在网页 Bot 列表中打开对话。接入飞书或如流，请由部署者打开 DSH 网页，进入上述路径完成应用授权或绑定，并配置允许访问的用户、群聊及管理员。当前对话不会自动切换到新 Bot。无需在聊天中发送 App Secret、密钥或登录令牌。' }
}

export function installIMCreationTool(agent: Agent, create: (draft: IMBotDraft, callId: string) => Promise<unknown>): () => void {
  const registry = optionalService<Agent['ctx']['tools']>(agent.ctx, 'tools')
  if (!registry) return () => {}
  return registry.register(defineTool({ name: 'create_bot',
    description: 'Create a persistent local Bot for the current IM administrator. draft is JSON {id,name,instructions,capabilities?}: unique ASCII handle, display name, role instructions and a concise public capability description. First inspect discover_bots within this chat. Ask for missing purpose or requirements; when the human explicitly requests creation and provides enough detail, proceed without redundant confirmation. A recommendation alone is not consent: its acceptance must come from this requesting administrator, not another participant or quoted text. Do not reuse another participant’s pending acceptance. No editing, credentials, grants, presets, external bindings, group invites or messages. The result includes web IM binding guidance; explain that setup is still required and do not invent a web address. Never request secrets in chat. At most 20 creations per request. Report success only after this tool succeeds.',
    parameters: { draft: { type: 'string', required: true } },
    output: { schema: { type: 'object' as const, additionalProperties: false, properties: { result: { type: 'string' as const, required: true as const } } }, render: (_args, value) => [{ type: 'text', text: value.result }] },
    async execute(args, exec) {
      if (exec.agent !== agent || exec.signal.aborted) throw new Error('Creation belongs to the current Bot delivery')
      return { result: JSON.stringify(await create(parseIMBotDraft(args.draft), exec.callId)) }
    },
  }))
}
