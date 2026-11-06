/** Structured human-request constraints. They narrow authority; they never grant it. */
import type { BotPolicy } from './types.ts'

export type TaskPolicy = {
  /** Native filesystem/shell sandbox only; external writes need a separate tool allowlist. */
  fileMode?: 'inherit' | 'read-only' | 'workspace-write' | undefined
  toolMode?: 'inherit' | 'none' | 'allow' | undefined
  /** Exact dispatch names, not patterns or inferred read/write categories. */
  tools?: string[] | undefined
}

/**
 * Untrusted ingress shape for SendRequest. The index signature makes the generated Remote
 * codec emit intersection(object, record), which keeps unknown keys so validateTaskPolicy
 * rejects a typo such as `fileMod` instead of Zod stripping it and silently broadening.
 * Never store this type; store only the TaskPolicy returned by validateTaskPolicy.
 * SendRequest must accept ONLY this type: in a union with TaskPolicy the generator orders
 * the stripping TaskPolicy branch first, and Zod returns that first match.
 */
export type TaskPolicyInput = TaskPolicy & { [key: string]: TaskPolicyJson }

/** Remote boundaries reject `unknown`; unrecognized keys may carry any JSON value. */
export type TaskPolicyJson = null | boolean | number | string | TaskPolicyJson[] | { [key: string]: TaskPolicyJson }

const fields = new Set(['fileMode', 'toolMode', 'tools'])

/** Re-submit a saved policy through SendRequest. Validated copies never hold undefined fields. */
export function taskPolicyInput(policy: TaskPolicy | undefined): TaskPolicyInput | undefined {
  return validateTaskPolicy(policy) as TaskPolicyInput | undefined
}

/** Validate at ingress AND at execution; never silently discard an unrecognized constraint. */
export function validateTaskPolicy(value: unknown): TaskPolicy | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Reflect.ownKeys(value).some(key => typeof key !== 'string' || !fields.has(key))) throw new Error('Invalid task policy')
  const policy = value as Record<string, unknown>
  if (policy.fileMode !== undefined && !['inherit', 'read-only', 'workspace-write'].includes(policy.fileMode as string)) throw new Error('Invalid task file policy')
  if (policy.toolMode !== undefined && !['inherit', 'none', 'allow'].includes(policy.toolMode as string)) throw new Error('Invalid task tool policy')
  if (policy.tools !== undefined && (!Array.isArray(policy.tools) || policy.tools.length > 200
    || Array.from(policy.tools).some(name => typeof name !== 'string' || !name.trim() || name.length > 200 || /\s/.test(name)))) throw new Error('Invalid task tool allowlist')
  if (policy.toolMode === 'allow' && !Array.isArray(policy.tools)) throw new Error('An explicit task tool allowlist is required')
  // An accidental tools-only request must not silently run with unrestricted tools.
  if (policy.tools !== undefined && policy.toolMode !== 'allow' && policy.toolMode !== 'none') throw new Error('Task tools require allow or none mode')
  const result: TaskPolicy = {}
  if (policy.fileMode !== undefined) result.fileMode = policy.fileMode as TaskPolicy['fileMode']
  if (policy.toolMode !== undefined) result.toolMode = policy.toolMode as TaskPolicy['toolMode']
  if (policy.tools !== undefined) result.tools = [...new Set(policy.tools as string[])]
  return result
}

/**
 * Intersect restrictions without changing provider/pricing or either input. Native sandbox
 * policy and capability grants still apply separately. An allowlist is not a grant.
 */
export function effectiveTaskPolicy(bot: BotPolicy | undefined, task: unknown): BotPolicy {
  const constraint = validateTaskPolicy(task)
  // Validate even legacy Bot policy modes before combining: an unknown mode is not inherit.
  if (bot?.fileMode !== undefined && !['inherit', 'read-only', 'workspace-write'].includes(bot.fileMode)) throw new Error('Invalid Bot file policy')
  if (bot?.toolMode !== undefined && !['inherit', 'none', 'allow'].includes(bot.toolMode)) throw new Error('Invalid Bot tool policy')
  if (bot?.tools !== undefined && (!Array.isArray(bot.tools) || Array.from(bot.tools).some(name => typeof name !== 'string'))) throw new Error('Invalid Bot tool allowlist')
  const result: BotPolicy = { ...bot, ...(bot?.tools ? { tools: [...bot.tools] } : {}) }
  if (constraint?.fileMode && constraint.fileMode !== 'inherit') {
    result.fileMode = bot?.fileMode === 'read-only' ? 'read-only' : constraint.fileMode
  }
  if (constraint?.toolMode === 'none' || bot?.toolMode === 'none') {
    result.toolMode = 'none'; result.tools = []
  } else if (constraint?.toolMode === 'allow') {
    result.toolMode = 'allow'
    result.tools = constraint.tools!.filter(name => bot?.toolMode !== 'allow' || bot.tools?.includes(name))
  }
  return result
}

/** Intersect immutable task constraints when explicitly sharing work from several roots. */
export function intersectTaskPolicies(...constraints: unknown[]): TaskPolicy | undefined {
  // Validate every input before combining: deny-all does not excuse a malformed sibling.
  const policies = constraints.map(validateTaskPolicy).filter((policy): policy is TaskPolicy => policy !== undefined)
  if (!policies.length) return undefined
  return policies.reduce<TaskPolicy>((combined, policy) => effectiveTaskPolicy(combined, policy), {})
}

const sandboxRank: Record<string, number> = { 'read-only': 0, 'workspace-write': 1, 'danger-full-access': 2 }

/**
 * Final native dispatch check for a structured task's immutable filesystem ceiling.
 * Native bash, pwsh, filesystem mutations and run_code all use sandbox_permissions;
 * nested tool calls run this check separately. Other tools still need explicit grants.
 */
export function taskFileDenial(ceiling: 'read-only' | 'workspace-write', mode: unknown, args: unknown): string | undefined {
  if (ceiling !== 'read-only' && ceiling !== 'workspace-write') return 'Invalid task filesystem ceiling'
  if (typeof mode !== 'string' || !Object.hasOwn(sandboxRank, mode)) return 'Cannot verify the native sandbox mode for this task'
  if (sandboxRank[mode]! > sandboxRank[ceiling]!) return 'Native sandbox mode exceeds this task’s filesystem policy'
  if (args === undefined) return undefined
  if (!args || typeof args !== 'object' || Array.isArray(args)) return 'Cannot verify native sandbox arguments for this task'
  if (!('sandbox_permissions' in args)) return undefined
  const request = args as Record<string, unknown>
  // Native schemas advertise only these two explicit modes. Aliases such as
  // require_escalated/use_default must not turn into an unbounded approval ask.
  if (request.sandbox_permissions !== 'workspace-write' && request.sandbox_permissions !== 'danger-full-access') {
    return 'Invalid sandbox_permissions override under this task’s filesystem policy'
  }
  if (typeof request.justification !== 'string' || !request.justification.trim()) return 'Native sandbox escalation requires a nonempty justification'
  if (sandboxRank[request.sandbox_permissions]! > sandboxRank[ceiling]!) return 'Sandbox escalation exceeds this task’s filesystem policy'
  return undefined
}
