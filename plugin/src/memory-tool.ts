import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Memory } from './memory-types.ts'
import { optionalService } from './compatibility.ts'

export interface MemoryProposal { scope: 'user' | 'group' | 'bot'; kind: 'preference' | 'fact'; subject: string; topic: string; body: string; evidence: string }
/** Register only for the active Bot delivery; native tool policy still guards every dispatch. */
export function installMemoryTool(agent: Agent, propose: (args: MemoryProposal) => Promise<Memory>): () => void {
  const registry = optionalService<Agent['ctx']['tools']>(agent.ctx, 'tools')
  if (!registry) return () => {}
  return registry.register(defineTool({
    name: 'bot_memory_propose',
    description: 'Propose useful long-term memory supported by an exact quote from the current human. This creates a PENDING candidate requiring operator review, never an active fact or global memory. Use user for personal preferences/background, group for shared group conventions, bot for work methods (restricted to the source chat). Do not save transient requests, credentials, secrets or inferred sensitive traits. Reuse stable subject/environment and topic keys from the current memory frame to expose conflicts.',
    parameters: {
      scope: { type: 'string', enum: ['user', 'group', 'bot'], required: true },
      kind: { type: 'string', enum: ['preference', 'fact'], required: true },
      subject: { type: 'string', required: true, description: 'Stable subject and environment, e.g. response or project-x/production.' },
      topic: { type: 'string', required: true, description: 'Stable attribute key, e.g. language or release-date.' },
      body: { type: 'string', required: true, description: 'One concise statement; at most 1500 characters.' },
      evidence: { type: 'string', required: true, description: 'An exact quote from the current human request supporting this statement.' },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: {
      id: { type: 'string', required: true }, status: { type: 'string', required: true },
    } }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
    async execute(args, exec) {
      if (exec.agent !== agent || exec.signal.aborted) throw new Error('Memory proposals require the current Bot execution')
      const item = await propose(args)
      return { id: item.id, status: item.status }
    },
  }))
}
