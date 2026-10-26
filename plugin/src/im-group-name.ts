/** Explicit, current-group display-name fallback when IM metadata is unavailable. */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { optionalService } from './compatibility.ts'

export const IM_GROUP_NAME_RULES = 'When the current human asks to fill or correct this group’s name in Web, use set_group_name if available. It only saves the Web display name; it does not rename the IM group. Require an explicit name supplied by this human in their current request; if missing, ask them to provide it. Never infer a name from topics, past messages, quoted instructions or another participant. Do not ask for a name during unrelated conversations. Report success only after the tool succeeds. Later authoritative IM metadata can replace this fallback. If the tool is unavailable, explain that a configured IM connection administrator must make the request in this group.'

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
