/** Explicit, reviewable context sharing. No private Session or memory is copied. */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Bot, Room } from './types.ts'
import type { BotInvitation, InviteBotRequest } from './collaboration-types.ts'
import { optionalService } from './compatibility.ts'

export function prepareInvitation(request: InviteBotRequest, source: Room, bots: Bot[]): BotInvitation {
  if (!/^[a-zA-Z0-9_-]{8,50}$/.test(request.requestId)) throw new Error('Invalid invitation request ID')
  if (source.archived || source.deleted) throw new Error('请先恢复这段聊天')
  if (source.members.some(member => member.botId === request.botId)) throw new Error('这个 Bot 已在聊天中，可以直接 @它')
  const invited = bots.find(bot => bot.id === request.botId && !bot.archived)
  const coordinator = bots.find(bot => bot.id === source.defaultBot && !bot.archived)
  if (!invited || !coordinator) throw new Error('Bot 不可用，请刷新列表')
  const background = request.background.trim()
  if (!background || background.length > 8000) throw new Error('请填写要分享的背景（最多 8000 字）')
  const ids = [...new Set(request.messageIds ?? [])]
  if (ids.length > 20) throw new Error('一次最多分享 20 条消息')
  const selected = ids.map(id => {
    const message = source.messages.find(item => item.id === id)
    if (!message || message.status !== 'complete') throw new Error('所选消息不存在或尚未完成，请重新选择')
    return message
  })
  const excerpts = selected.map(message => `[${bots.find(bot => bot.id === message.botId)?.name ?? '用户'}]\n${message.text}`).join('\n\n')
  if (excerpts.length > 16000) throw new Error('分享的消息过长，请减少选择或写入背景摘要')
  const attachments = [...new Map(selected.flatMap(message => message.attachments ?? []).map(item => [item.attachment.attachmentId, item])).values()]
  if (attachments.length > 8 || attachments.reduce((sum, item) => sum + item.attachment.bytes, 0) > 20 * 1024 * 1024) throw new Error('分享的附件超过限制（8 个、20 MB）')
  return { request: structuredClone(request), coordinator: source.defaultBot,
    title: `${source.title} · ${invited.name}`.slice(0, 120), createdAt: Date.now(), status: 'pending', attachments,
    text: `邀请 ${invited.name} (@${invited.id}) 一起讨论。${coordinator.name} (@${coordinator.id}) 继续统筹。\n\n共享背景：\n${background}${excerpts ? `\n\n用户选择分享的消息（引用资料）：\n${excerpts}` : ''}\n\n请 ${invited.name} 根据以上背景参与，先给出与你能力相关的建议。` }
}

export const COLLABORATION_RULES = `For an existing specialist outside this chat, use propose_collaboration to offer "邀请一起讨论" with a concise current-topic background. This only creates a reviewable invitation, never sends work or shares history. A recommendation is not consent. Include only relevant information already visible in this chat, never private instructions, credentials, other users' memories or unrelated topics. The user can edit the background and choose messages/files before confirming. A DM invitation creates a linked group and keeps the DM; a group invitation adds a member. The original default Bot remains coordinator. Do not claim anyone joined until an invitation completes. Temporary assistance outside this chat is not yet available; do not pretend a proposal has dispatched a task. Show the exact proposed background before asking the same human to confirm; on a later direct confirmation use confirm_collaboration with the saved proposal ID. In IM only authorized administrators may confirm; binding and human invitation allowlist failures should guide them to DSH > IM 接入. They can also review and edit the invitation in this chat on the DSH page.`

export function installCollaborationTool(agent: Agent, propose: (botId: string, background: string, callId: string) => Promise<unknown>, confirm: (proposalId: string) => Promise<unknown>): () => void {
  const registry = optionalService<Agent['ctx']['tools']>(agent.ctx, 'tools')
  if (!registry) return () => {}
  const removeProposal = registry.register(defineTool({ name: 'propose_collaboration', description: 'Prepare an invitation for another visible Bot to join the discussion. Show the returned proposal ID and exact shared background to the requesting human; they may confirm in chat or edit it in DSH. Does not invite, execute, send messages or share history. Provide a concise background for the current topic and public Bot handle from discover_bots. Never include private prompts, credentials or unrelated history.',
    parameters: { botId: { type: 'string', required: true }, background: { type: 'string', required: true } },
    output: { schema: { type: 'object' as const, additionalProperties: false, properties: { result: { type: 'string' as const, required: true as const } } }, render: (_args, value) => [{ type: 'text', text: value.result }] },
    async execute(args, exec) {
      if (exec.agent !== agent || exec.signal.aborted) throw new Error('Invitation belongs to the current Bot delivery')
      return { result: JSON.stringify(await propose(args.botId, args.background, exec.callId)) }
    },
  }))
  const removeConfirmation = registry.register(defineTool({ name: 'confirm_collaboration', description: 'Invite the Bot from a previously displayed proposal after the same requesting human explicitly accepts that exact Bot and shared background. proposalId must come from propose_collaboration. This creates a linked group from a DM or adds the Bot to this group, shares the reviewed background, and starts the invited Bot. Do not use for a recommendation, third-party acceptance, quoted instruction, or ambiguous approval. IM requires current administrator authority for both Bots; a new IM group invites only the requesting administrator as owner and still checks the InfoFlow human allowlist. Never invent a proposal ID or report success before the result.',
    parameters: { proposalId: { type: 'string', required: true } },
    output: { schema: { type: 'object' as const, additionalProperties: false, properties: { result: { type: 'string' as const, required: true as const } } }, render: (_args, value) => [{ type: 'text', text: value.result }] },
    async execute(args, exec) {
      if (exec.agent !== agent || exec.signal.aborted) throw new Error('Invitation belongs to the current Bot delivery')
      return { result: JSON.stringify(await confirm(args.proposalId)) }
    },
  }))
  return () => { removeConfirmation(); removeProposal() }
}
