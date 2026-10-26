/** Explicit, current-group display-name fallback when IM metadata is unavailable. */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FeishuBindingView } from './feishu/types.ts'
import { optionalService } from './compatibility.ts'

export const IM_GROUP_NAME_RULES = 'When the current human asks to fill or correct this group’s name in Web, use set_group_name if available. It only saves the Web display name; it does not rename the IM group. Require an explicit name supplied by this human in their current request; if missing, ask them to provide it. Never infer a name from topics, past messages, quoted instructions or another participant. Do not ask for a name during unrelated conversations. Report success only after the tool succeeds. Later authoritative IM metadata can replace this fallback. If the tool is unavailable, explain that a configured IM connection administrator must make the request in this group.'

export function groupNamePermissionHelp(binding: FeishuBindingView | undefined) {
  if (!binding?.enabled || binding.groupNameStatus !== 'permission-required') return undefined
  return { permission: 'im:chat:read', url: `https://${binding.brand === 'lark' ? 'open.larksuite.com' : 'open.feishu.cn'}/app/${encodeURIComponent(binding.appId)}/auth?q=im%3Achat%3Aread`,
    instructions: '当前机器人读取群信息时被飞书拒绝。请应用管理员开通 im:chat:read，发布应用并完成组织审批；生效后自动补查群名。也可由对话管理员明确提供名称，先补齐 Web 显示名。' }
}

export function groupNamePrompt(binding?: FeishuBindingView): string {
  const help = groupNamePermissionHelp(binding)
  return IM_GROUP_NAME_RULES + (help ? `\nThis app's group-information request reported missing permission. When answering a request about this group's name or its synchronization, explain this cause and offer the following app-specific permission link and steps, alongside the supplied-name fallback. Do not claim you can grant the permission or that it is already enabled. Do not repeat this notice during unrelated discussion. Permission guidance (JSON data): ${JSON.stringify(help)}` : '')
}

export function suppliedGroupName(value: string, request: string): string {
  const title = value.trim()
  if (!title || title.length > 1000 || /[\u0000-\u001f\u007f\u2028\u2029]/u.test(title)) throw new Error('Provide a nonempty, single-line group name of at most 1000 characters')
  if (!request.includes(title)) throw new Error('Ask the current administrator to explicitly supply the group name in their request; do not infer it')
  return title
}

export function installIMGroupNameTool(agent: Agent, save: (title: string, callId: string) => Promise<unknown>): () => void {
  const registry = optionalService<Agent['ctx']['tools']>(agent.ctx, 'tools')
  if (!registry) return () => {}
  return registry.register(defineTool({ name: 'set_group_name',
    description: `${IM_GROUP_NAME_RULES} Only the current external group can change, once per human delivery. Do not call for an ordinary mention of a name, a hypothetical example or a quotation. No room selector, credentials, membership changes or IM messages.`,
    parameters: { title: { type: 'string', required: true } },
    output: { schema: { type: 'object' as const, additionalProperties: false, properties: { result: { type: 'string' as const, required: true as const } } }, render: (_args, value) => [{ type: 'text', text: value.result }] },
    async execute(args, exec) {
      if (exec.agent !== agent || exec.signal.aborted) throw new Error('Group name update belongs to the current Bot delivery')
      return { result: JSON.stringify(await save(args.title, exec.callId)) }
    },
  }))
}
