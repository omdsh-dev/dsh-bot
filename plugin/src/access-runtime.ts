/** Native Agent-scoped capability mounts and execution-scoped credential delivery. */
import { randomUUID } from 'node:crypto'
import type { Context, Plugin } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import type { BotState } from './types.ts'
import { accessFingerprint, credentialNames, secretRedactor } from './access-state.ts'
import { optionalService } from './compatibility.ts'

interface SkillService { register(value: { name: string; description: string; content: string; source: string }): () => void }
interface ShellEnvironment {
  register(value: { name: string; variables: Record<string, { description: string }>; resolve(exec: ToolExecution): Record<string, string> }): () => void
}
interface ActiveAccess { botId: string; fingerprint: string; values: Map<string, string>; shell: Set<string>; signal: AbortSignal }
export class CapabilityRuntime {
  private active = new Map<Agent, ActiveAccess>()
  private unregisterShell: (() => void) | undefined
  private shellNames = ''
  constructor(private readonly ctx: Context, private readonly current: () => BotState) {}

  private shellEnvironment(): void {
    const names = [...new Set((this.current().access?.credentials ?? []).filter(item => item.shellBotIds.length).map(item => item.name))].sort()
    const signature = JSON.stringify(names)
    if (signature === this.shellNames) return
    const registry = optionalService<ShellEnvironment>(this.ctx, 'shellEnv')
    if (!registry && names.length) throw new Error('Enable the native shell-env service before granting shell credentials')
    this.unregisterShell?.(); this.unregisterShell = undefined; this.shellNames = ''
    if (names.length) this.unregisterShell = registry!.register({ name: 'bot-mode-credentials',
      variables: Object.fromEntries(names.map(name => [`DSH_SECRET_${name}`, { description: 'Operator-granted credential; available only to its authorized Bot when explicitly referenced.' }])),
      resolve: exec => {
        const active = exec.agent && this.active.get(exec.agent)
        if (!active || active.signal.aborted || active.fingerprint !== accessFingerprint(this.current(), active.botId)) return {}
        const references = credentialNames(JSON.stringify(exec.arguments)), result: Record<string, string> = {}
        for (const name of references) if (active.shell.has(name) && active.values.has(name)) result[`DSH_SECRET_${name}`] = active.values.get(name)!
        return result
      },
    })
    this.shellNames = signature
  }

  async mount(agent: Agent, botId: string, signal: AbortSignal): Promise<() => Promise<void>> {
    const state = this.current(), capabilities = (state.access?.capabilities ?? []).filter(item => item.botIds.includes(botId))
    const credentials = (state.access?.credentials ?? []).filter(item => item.botIds.includes(botId))
    if (!capabilities.length && !credentials.some(item => item.shellBotIds.includes(botId))) return async () => {}
    const fingerprint = accessFingerprint(state, botId), shell = new Set(credentials.filter(item => item.shellBotIds.includes(botId)).map(item => item.name))
    const needed = new Set([...shell, ...capabilities.flatMap(item => Object.values(item.env ?? item.headers ?? {}).flatMap(credentialNames))])
    const provider = optionalService<Context['credentials']>(this.ctx, 'credentials'), values = new Map<string, string>()
    for (const name of needed) {
      const grant = credentials.find(item => item.name === name)
      if (!grant || !/^bot-mode\/key-[a-f0-9-]{36}$/.test(grant.key)) throw new Error(`Credential ${name} is not granted to this Bot`)
      if (!provider?.readRecord) throw new Error('Native credential storage is unavailable')
      const record = await provider.readRecord(credentialKey('bot-mode', grant.key.slice('bot-mode/'.length)))
      if (record?.kind !== 'api-key' || !record.key || record.key.length < 8) throw new Error(`Credential ${name} is unavailable`)
      values.set(name, record.key)
    }
    signal.throwIfAborted()
    if (fingerprint !== accessFingerprint(this.current(), botId)) throw new Error('Bot capability access changed during preparation')
    const redact = secretRedactor(values), resolve = (value: string) => value.replace(/\$DSH_SECRET_([A-Z][A-Z0-9_]{0,63})/g, (_match, name: string) => {
      const secret = values.get(name); if (secret === undefined) throw new Error(`Credential ${name} is unavailable`); return secret
    })
    this.shellEnvironment()
    if (this.active.has(agent)) throw new Error('This Bot Session already has an active capability mount')
    this.active.set(agent, { botId, fingerprint, values, shell, signal })
    // A child fiber inherits this Agent's native registration scope and owns every temporary effect.
    const runtime = this
    const fork = agent.ctx.plugin({ name: `bot-access-${randomUUID()}`, inject: ['tools', 'systemPrompt'], async apply(ctx: Context) {
      ctx.tools.guard(exec => exec.agent !== agent || signal.aborted || fingerprint !== accessFingerprint(runtime.current(), botId) ? 'This Bot capability grant was revoked' : undefined)
      ctx.on('tools/execute', async (exec, next) => {
        if (exec.agent !== agent) return next()
        try { return redact(await next()) } catch { throw new Error('Bot capability execution failed; inspect its configuration') }
      }, { prepend: true })
      // Native loop requests are immutable reconstructions of the Session log: never rewrite them.
      ctx.on('llm/stream', (options, next) => {
        if (options.sessionId === agent.session.id) {
          const content = JSON.stringify([options.messages, options.system, options.tools])
          if (redact(content) !== content) throw new Error('A credential value was detected in model input; remove it before continuing')
        }
        return next()
      }, { global: true, prepend: true })
      if (shell.size) ctx.systemPrompt.section({ name: 'bot-mode.credentials', order: 998,
        text: `Available credential references for this Bot: ${[...shell].map(name => '$DSH_SECRET_' + name).join(', ')}. Reference only the credential required by the current authorized command. Never print, encode, attach or persist a secret value.` })
      for (const item of capabilities) {
        if (item.kind === 'skill') {
          const skills = optionalService<SkillService>(ctx, 'skills')
          if (!skills) throw new Error('Enable the native skill service before attaching skills')
          skills.register({ name: 'bot-' + item.name, description: item.description || item.name, content: item.content!, source: 'bot-mode' })
          continue
        }
        const loader = optionalService<{ import(name: string): Promise<Plugin<Record<string, unknown>>> }>(ctx, 'loader')
        if (!loader) throw new Error('The native plugin loader is unavailable')
        const plugin = await loader.import('@deepseek-ai/dsh-mcp-client')
        const config = item.transport === 'stdio' ? { transport: 'stdio', command: item.command, args: item.args ?? [],
          env: Object.fromEntries(Object.entries(item.env ?? {}).map(([key, value]) => [key, resolve(value)])), cwd: agent.session.header.cwd ?? '' }
          : { transport: 'streamable-http', url: item.url, headers: Object.fromEntries(Object.entries(item.headers ?? {}).map(([key, value]) => [key, resolve(value)])) }
        await ctx.plugin(plugin, { ...config, serverName: 'bot_' + item.name, toolCallTimeoutMs: 60000, failOnStartupError: true, reconnect: { enabled: false } })
      }
    } })
    let closing: Promise<void> | undefined
    const close = () => closing ??= (async () => {
      signal.removeEventListener('abort', abort)
      this.active.delete(agent)
      await fork.dispose()
      while (fork.inertia) await fork.inertia
      values.clear()
    })()
    const abort = () => { void close().catch(() => {}) }
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    try { await fork; signal.throwIfAborted(); return close } catch { await close(); throw new Error('Bot capability activation failed; check grants, endpoint/command and native services') }
  }
  close(): void { this.unregisterShell?.(); this.unregisterShell = undefined; this.active.clear() }
}
