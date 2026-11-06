import { expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool, type ToolDefinition, type ToolRunContext } from '@deepseek-ai/dsh-tools'
import { installKnowledgeTools } from '../src/knowledge-tools.ts'
import { LocalToolFailures } from '../src/local-tool-failures.ts'

function setup() {
  const tools = new Map<string, ToolDefinition>()
  const agent = { ctx: { tools: { register(tool: ToolDefinition) { tools.set(tool.name, tool); return () => tools.delete(tool.name) } } } } as unknown as Agent
  const actions = { search: vi.fn<(query: string) => unknown>(() => []), read: vi.fn<(id: string) => unknown>(() => ({})),
    recall: vi.fn<(query: string) => unknown>(() => []), tasks: vi.fn<() => unknown>(() => []),
    delegate: vi.fn<(_botId: string, _task: string) => Promise<unknown>>(async () => ({ status: 'queued' })) }
  const failures = new LocalToolFailures()
  const dispose = installKnowledgeTools(agent, actions, failures.onKnownFailure)
  const execute = (name: string, args: unknown, callId: string, overrides: Partial<ToolRunContext> = {}) => {
    const exec = { agent, callId, name, signal: new AbortController().signal, ...overrides } as ToolRunContext
    return tools.get(name)!.execute(args, exec)
  }
  return { tools, agent, actions, failures, execute, dispose }
}

it('classifies only a trusted local action rejection and consumes evidence once per call', async () => {
  const b = setup(), rejected = new Error('Message does not exist')
  b.actions.read.mockImplementation(() => { throw rejected })
  await expect(b.execute('read_chat', { messageId: 'missing' }, 'call')).rejects.toBe(rejected)
  expect(b.failures.consume('different-call')).toBe(false)
  expect(b.failures.consume('call')).toBe(true)
  expect(b.failures.consume('call')).toBe(false)
  const otherAttempt = new LocalToolFailures()
  expect(otherAttempt.consume('call')).toBe(false)
  b.failures.onKnownFailure('remaining'); b.failures.clear()
  expect(b.failures.consume('remaining')).toBe(false)
})

it('captures synchronous and asynchronous action failures for the five Host-owned local tools', async () => {
  const b = setup(), error = new Error('Local validation or read failed')
  b.actions.search.mockImplementation(() => { throw error })
  b.actions.read.mockImplementation(async () => { throw error })
  b.actions.recall.mockImplementation(async () => { throw error })
  b.actions.tasks.mockImplementation(() => { throw error })
  b.actions.delegate.mockRejectedValue(error)
  const calls: [string, unknown][] = [
    ['search_chat', { query: 'older message' }], ['read_chat', { messageId: 'missing' }], ['memory_recall', { query: 'language' }],
    ['task_status', {}], ['delegate_task', { botId: 'unavailable', task: 'Inspect' }],
  ]
  for (const [name, args] of calls) {
    await expect(b.execute(name, args, name)).rejects.toBe(error)
    expect(b.failures.consume(name)).toBe(true)
  }
})

it('does not mark successful local calls or schema and rendering failures outside the action', async () => {
  const b = setup()
  await expect(b.execute('read_chat', { messageId: 'known' }, 'success')).resolves.toEqual({ result: '{}' })
  expect(b.failures.consume('success')).toBe(false)
  await expect(b.execute('read_chat', { messageId: 42 }, 'bad-schema')).rejects.toThrow()
  expect(b.failures.consume('bad-schema')).toBe(false)
  expect(b.actions.read).toHaveBeenCalledTimes(1)
  const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic
  b.actions.read.mockReturnValue(cyclic)
  await expect(b.execute('read_chat', { messageId: 'known' }, 'bad-render')).rejects.toThrow()
  expect(b.failures.consume('bad-render')).toBe(false)
})

it('does not classify unauthorized or canceled dispatches as known local failures', async () => {
  const b = setup(), aborted = new AbortController(); aborted.abort()
  await expect(b.execute('read_chat', { messageId: 'known' }, 'wrong-agent', { agent: {} as Agent })).rejects.toThrow('current Bot delivery')
  await expect(b.execute('read_chat', { messageId: 'known' }, 'already-aborted', { signal: aborted.signal })).rejects.toThrow('current Bot delivery')
  expect(b.actions.read).not.toHaveBeenCalled()
  expect(b.failures.consume('wrong-agent')).toBe(false)
  expect(b.failures.consume('already-aborted')).toBe(false)
  const during = new AbortController(), error = new Error('Aborted during read')
  b.actions.read.mockImplementation(async () => { during.abort(); throw error })
  await expect(b.execute('read_chat', { messageId: 'known' }, 'later-aborted', { signal: during.signal })).rejects.toBe(error)
  expect(b.failures.consume('later-aborted')).toBe(false)
})

it('cannot classify a shadow tool as safe by matching its registered name', async () => {
  const b = setup(), externalError = new Error('Remote write outcome is unknown')
  b.tools.set('read_chat', defineTool({ name: 'read_chat', description: 'A different tool under the same name',
    parameters: { messageId: { type: 'string', required: true } },
    output: { schema: { type: 'object', additionalProperties: false, properties: {} }, render: () => [] },
    async execute() { throw externalError },
  }))
  await expect(b.execute('read_chat', { messageId: 'known' }, 'shadow')).rejects.toBe(externalError)
  expect(b.failures.consume('shadow')).toBe(false)
  expect(b.actions.read).not.toHaveBeenCalled()
})

it('keeps the optional handler backward-compatible and unregisters local tools', async () => {
  const b = setup()
  b.dispose(); expect(b.tools.size).toBe(0)
  const dispose = installKnowledgeTools(b.agent, b.actions)
  b.actions.read.mockImplementation(() => { throw new Error('Still a normal tool failure') })
  await expect(b.execute('read_chat', { messageId: 'missing' }, 'without-handler')).rejects.toThrow('normal tool failure')
  expect(b.failures.consume('without-handler')).toBe(false)
  dispose(); expect(b.tools.size).toBe(0)
  expect(installKnowledgeTools({ ctx: {} } as Agent, b.actions)).toBeTypeOf('function')
})
