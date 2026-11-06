import { expect, it } from 'vitest'
import { effectiveTaskPolicy, intersectTaskPolicies, taskFileDenial, validateTaskPolicy, type TaskPolicy } from '../src/task-policy.ts'
import type { BotPolicy } from '../src/types.ts'

it('accepts omitted legacy constraints and detached exact allowlists', () => {
  expect(validateTaskPolicy(undefined)).toBeUndefined()
  expect(validateTaskPolicy({})).toEqual({})
  expect(validateTaskPolicy({ fileMode: 'inherit', toolMode: 'inherit' })).toEqual({ fileMode: 'inherit', toolMode: 'inherit' })
  const input = { fileMode: 'read-only', toolMode: 'allow', tools: ['read_file', 'mcp:docs.search', 'read_file'] }
  const result = validateTaskPolicy(input)
  expect(result).toEqual({ fileMode: 'read-only', toolMode: 'allow', tools: ['read_file', 'mcp:docs.search'] })
  input.tools.push('write_file')
  expect(result?.tools).toEqual(['read_file', 'mcp:docs.search'])
  expect(validateTaskPolicy({ toolMode: 'allow', tools: [] })).toEqual({ toolMode: 'allow', tools: [] })
})

it('rejects malformed, misspelled and ambiguous constraints instead of broadening them', () => {
  for (const value of [null, true, 'read-only', [], new Date(), { mode: 'read-only' }, { fileMode: 'danger-full-access' },
    { fileMode: null }, { toolMode: 'all' }, { toolMode: 'allow' }, { toolMode: 'allow', tools: null }, { tools: ['read_file'] },
    { toolMode: 'inherit', tools: ['read_file'] }, { toolMode: 'allow', tools: 'read_file' },
    { toolMode: 'allow', tools: [''] }, { toolMode: 'allow', tools: ['read file'] }, { toolMode: 'allow', tools: [' read_file'] },
    { toolMode: 'allow', tools: [1] }, { toolMode: 'allow', tools: new Array(1) }, { toolMode: 'allow', tools: ['x'.repeat(201)] },
    { toolMode: 'allow', tools: Array.from({ length: 201 }, (_, i) => 'tool_' + i) },
    { fileMode: 'read-only', allowDelegation: true }, { [Symbol('policy')]: 'ignored' }, Object.create({ fileMode: 'read-only' }),
  ]) expect(() => validateTaskPolicy(value)).toThrow()
})

it('intersects file restrictions and keeps task inherit from broadening a Bot', () => {
  const modes = [undefined, 'inherit', 'read-only', 'workspace-write'] as const
  for (const botMode of modes) for (const taskMode of modes) {
    const result = effectiveTaskPolicy({ fileMode: botMode }, { fileMode: taskMode })
    const expected = botMode === 'read-only' || taskMode === 'read-only' ? 'read-only'
      : botMode === 'workspace-write' || taskMode === 'workspace-write' ? 'workspace-write' : botMode
    expect(result.fileMode).toEqual(expected)
  }
})

it('intersects exact tool names, including deny-all and an empty allowlist', () => {
  const modes = [undefined, 'inherit', 'none', 'allow'] as const
  for (const botMode of modes) for (const taskMode of modes) {
    const bot: BotPolicy = { toolMode: botMode, tools: ['read_file', 'search'] }
    const task: TaskPolicy = { toolMode: taskMode, ...(taskMode === 'allow' ? { tools: ['search', 'write_file'] } : {}) }
    const result = effectiveTaskPolicy(bot, task)
    const allowed = (name: string) => result.toolMode === 'none' ? false : result.toolMode === 'allow' ? result.tools!.includes(name) : true
    for (const name of ['read_file', 'search', 'write_file', 'other']) {
      const permits = (mode: string | undefined, names: string[]) => mode === 'none' ? false : mode === 'allow' ? names.includes(name) : true
      expect(allowed(name)).toBe(permits(botMode, bot.tools!) && permits(taskMode, task.tools ?? []))
    }
  }
  expect(effectiveTaskPolicy({ toolMode: 'allow' }, { toolMode: 'allow', tools: ['read_file'] }).tools).toEqual([])
  expect(effectiveTaskPolicy(undefined, { toolMode: 'allow', tools: [] })).toEqual({ toolMode: 'allow', tools: [] })
  expect(effectiveTaskPolicy(undefined, { toolMode: 'allow', tools: ['read_*'] }).tools).toEqual(['read_*'])
})

it('retains routing and pricing, avoids mutating policies, and does not alias caller arrays', () => {
  const bot: BotPolicy = { provider: 'fixture', model: 'chosen', inputPrice: 1, outputPrice: 2, toolMode: 'allow', tools: ['read_file', 'write_file'], fileMode: 'workspace-write' }
  const task: TaskPolicy = { fileMode: 'read-only', toolMode: 'allow', tools: ['read_file', 'search'] }
  const expected = structuredClone({ bot, task })
  const result = effectiveTaskPolicy(bot, task)
  expect(result).toEqual({ ...bot, fileMode: 'read-only', tools: ['read_file'] })
  result.tools?.push('unrelated')
  expect({ bot, task }).toEqual(expected)
  const unrestricted = effectiveTaskPolicy(bot, undefined)
  unrestricted.tools?.push('another')
  expect(bot).toEqual(expected.bot)
})

it('reapplies the same root constraints when delegating to a more capable Bot or resuming after serialization', () => {
  const root: TaskPolicy = { fileMode: 'read-only', toolMode: 'allow', tools: ['read_file', 'search'] }
  const restrictedBot: BotPolicy = { toolMode: 'allow', tools: ['read_file'], fileMode: 'read-only' }
  const powerfulBot: BotPolicy = { toolMode: 'inherit', fileMode: 'workspace-write' }
  expect(effectiveTaskPolicy(restrictedBot, root)).toMatchObject({ fileMode: 'read-only', tools: ['read_file'] })
  const result = effectiveTaskPolicy(powerfulBot, JSON.parse(JSON.stringify(root)))
  expect(result).toEqual({ fileMode: 'read-only', toolMode: 'allow', tools: ['read_file', 'search'] })
  expect(effectiveTaskPolicy({ toolMode: 'none' }, root)).toMatchObject({ toolMode: 'none', tools: [] })
})

it('fails closed on corrupted Bot modes or persisted task constraints', () => {
  for (const value of [{ fileMode: 'all' }, { toolMode: 'all' }, { tools: 'read_file' }, { tools: [5] }]) {
    expect(() => effectiveTaskPolicy(value as BotPolicy, { fileMode: 'read-only' })).toThrow()
  }
  expect(() => effectiveTaskPolicy(undefined, { fileMode: 'READ_ONLY' })).toThrow()
})


it('intersects several selected task roots without dropping restrictions or retaining aliases', () => {
  expect(intersectTaskPolicies()).toBeUndefined()
  expect(intersectTaskPolicies(undefined, undefined)).toBeUndefined()
  expect(intersectTaskPolicies(undefined, {})).toEqual({})
  const policies: TaskPolicy[] = [
    { fileMode: 'workspace-write', toolMode: 'allow', tools: ['read', 'search', 'write'] },
    { fileMode: 'read-only', toolMode: 'allow', tools: ['read', 'search'] },
    { fileMode: 'inherit', toolMode: 'allow', tools: ['read', 'other'] },
  ]
  const expected = structuredClone(policies)
  const merged = intersectTaskPolicies(undefined, ...policies)
  expect(merged).toEqual({ fileMode: 'read-only', toolMode: 'allow', tools: ['read'] })
  merged!.tools!.push('write')
  expect(policies).toEqual(expected)
  expect(intersectTaskPolicies(...policies, { toolMode: 'none' })).toEqual({ fileMode: 'read-only', toolMode: 'none', tools: [] })
  expect(intersectTaskPolicies(...policies.slice().reverse())).toEqual({ fileMode: 'read-only', toolMode: 'allow', tools: ['read'] })
  expect(intersectTaskPolicies(policies[0])).not.toBe(policies[0])
})

it('validates every shared task constraint even when another constraint already denies tools', () => {
  expect(() => intersectTaskPolicies({ toolMode: 'none' }, { toolMode: 'allow' })).toThrow()
  expect(() => intersectTaskPolicies({ toolMode: 'none' }, null)).toThrow()
  expect(() => intersectTaskPolicies({ fileMode: 'read-only' }, { fileMode: 'unsafe' }, undefined)).toThrow()
  expect(intersectTaskPolicies({ toolMode: 'allow', tools: [] }, { toolMode: 'inherit' })).toEqual({ toolMode: 'allow', tools: [] })
})


it('rejects a broader or unverifiable live native mode before any tool dispatch', () => {
  expect(taskFileDenial('read-only', 'read-only', {})).toBeUndefined()
  expect(taskFileDenial('workspace-write', 'read-only', undefined)).toBeUndefined()
  expect(taskFileDenial('workspace-write', 'workspace-write', {})).toBeUndefined()
  expect(taskFileDenial('read-only', 'workspace-write', {})).toContain('exceeds')
  for (const ceiling of ['read-only', 'workspace-write'] as const) {
    expect(taskFileDenial(ceiling, 'danger-full-access', {})).toContain('exceeds')
    for (const mode of [undefined, null, false, 0, {}, 'inherit', 'read_only', 'require_escalated', 'toString', '__proto__']) {
      expect(taskFileDenial(ceiling, mode, {})).toBeDefined()
    }
  }
})

it('allows native escalation only within the immutable task ceiling', () => {
  const write = { sandbox_permissions: 'workspace-write', justification: 'Write the requested workspace file.' }
  const all = { sandbox_permissions: 'danger-full-access', justification: 'Write outside the workspace.' }
  expect(taskFileDenial('read-only', 'read-only', write)).toContain('exceeds')
  expect(taskFileDenial('workspace-write', 'read-only', write)).toBeUndefined()
  expect(taskFileDenial('workspace-write', 'workspace-write', write)).toBeUndefined()
  for (const ceiling of ['read-only', 'workspace-write'] as const) expect(taskFileDenial(ceiling, ceiling, all)).toContain('exceeds')
  expect(write).toEqual({ sandbox_permissions: 'workspace-write', justification: 'Write the requested workspace file.' })
})

it('fails closed on malformed recognized overrides and unbounded escalation aliases', () => {
  for (const value of [undefined, null, false, {}, [], 1, 'read-only', 'require_escalated', 'use_default', 'allow', 'inherit', 'full-access', 'toString']) {
    expect(taskFileDenial('workspace-write', 'read-only', { sandbox_permissions: value, justification: 'Reason' })).toBeDefined()
  }
  for (const justification of [undefined, null, false, {}, '', '   ', 1]) {
    expect(taskFileDenial('workspace-write', 'read-only', { sandbox_permissions: 'workspace-write', justification })).toBeDefined()
  }
  for (const args of [null, false, [], 'sandbox_permissions=workspace-write', 1]) expect(taskFileDenial('workspace-write', 'read-only', args)).toBeDefined()
})

it('does not mistake quoted payloads or ordinary mode fields for native permission overrides', () => {
  expect(taskFileDenial('read-only', 'read-only', { mode: 'write', payload: { sandbox_permissions: 'danger-full-access' } })).toBeUndefined()
  expect(taskFileDenial('read-only', 'read-only', { command: 'printf sandbox_permissions', justification: 'Business reason' })).toBeUndefined()
})
