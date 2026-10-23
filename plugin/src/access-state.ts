import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import type { AccessState, AccessRemoval, BotCapability, SaveCapability, SaveBotCredential } from './access-types.ts'
import type { BotState } from './types.ts'

const ids = z.array(z.string()).max(1000)
export const accessSchema: z.ZodType<AccessState> = z.object({
  capabilities: z.array(z.object({ name: z.string(), revision: z.number().int().positive(), description: z.string(), botIds: ids,
    kind: z.enum(['skill', 'mcp', 'browser']), content: z.string().optional(), executablePath: z.string().optional(), transport: z.enum(['stdio', 'streamable-http']).optional(),
    command: z.string().optional(), args: z.array(z.string()).optional(), env: z.record(z.string(), z.string()).optional(),
    url: z.string().optional(), headers: z.record(z.string(), z.string()).optional() })).max(100),
  credentials: z.array(z.object({ name: z.string(), revision: z.number().int().positive(), description: z.string(), botIds: ids, shellBotIds: ids, key: z.string() })).max(100),
})
export function accessState(state: BotState): AccessState { return state.access ??= { capabilities: [], credentials: [] } }
export function credentialNames(value: string): string[] { return [...new Set([...value.matchAll(/\$(?:env:|\{)?DSH_SECRET_([A-Z][A-Z0-9_]{0,63})/g)].map(match => match[1]!))] }
function label(value: string, max: number, name: string): string {
  if (typeof value !== 'string' || value.length > max || /\0/.test(value)) throw new Error(`Invalid ${name}`)
  return value.trim()
}
export function grantedBots(state: BotState, ids: string[]): string[] {
  const unique = [...new Set(ids)]
  if (unique.some(id => !state.bots.some(bot => bot.id === id && !bot.archived))) throw new Error('Select existing active Bots')
  return unique
}
export function checkRevision(previous: { revision: number } | undefined, revision?: number): void {
  if (previous ? previous.revision !== revision : revision !== undefined) throw new Error('Configuration changed; refresh before saving')
}
function fields(input: Record<string, string> = {}, kind: 'env' | 'headers'): Record<string, string> {
  const entries = Object.entries(input)
  if (entries.length > 50) throw new Error('Too many environment variables or headers')
  for (const [key, value] of entries) {
    if (!(kind === 'env' ? /^[A-Za-z_][A-Za-z0-9_]{0,127}$/ : /^[A-Za-z0-9-]{1,128}$/).test(key)
      || /[\r\n\0]/.test(value) || value.length > 4000) throw new Error('Invalid environment variable or header')
    if (kind === 'headers' && /authorization|cookie|api[-_]key|token/i.test(key) && !credentialNames(value).length) throw new Error('Authentication headers must reference a saved credential')
  }
  return Object.fromEntries(entries)
}
export function saveCapability(state: BotState, request: SaveCapability): BotCapability {
  const access = accessState(state), previous = access.capabilities.find(item => item.name === request.name)
  checkRevision(previous, request.revision)
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(request.name) || request.name.length > 24) throw new Error('Use a lowercase capability name of 1–24 characters')
  if (!previous && access.capabilities.length >= 100) throw new Error('Capability limit reached')
  const item: BotCapability = { name: request.name, revision: (previous?.revision ?? 0) + 1, description: label(request.description, 2000, 'description'), botIds: grantedBots(state, request.botIds), kind: request.kind }
  if (request.kind === 'skill') {
    item.content = label(request.content ?? '', 64000, 'skill content')
    if (!item.content) throw new Error('Skill instructions are required')
  } else if (request.kind === 'browser') {
    if (request.executablePath?.trim()) {
      item.executablePath = label(request.executablePath, 2000, 'browser executable')
      if (!isAbsolute(item.executablePath) || credentialNames(item.executablePath).length) throw new Error('Use an absolute browser executable path')
    }
  } else if (request.kind === 'mcp') {
    item.transport = request.transport
    if (request.transport === 'stdio') {
      item.command = label(request.command ?? '', 1000, 'command'); item.args = request.args ?? []; item.env = fields(request.env, 'env')
      if (!item.command || item.args.length > 100 || item.args.some(arg => typeof arg !== 'string' || arg.length > 4000 || /\0/.test(arg))) throw new Error('Invalid executable or arguments')
      if (credentialNames([item.command, ...item.args].join(' ')).length) throw new Error('Use environment variables for credentials; never put secrets in process arguments')
    } else if (request.transport === 'streamable-http') {
      let url: URL
      try { url = new URL(request.url ?? '') } catch { throw new Error('Use an HTTPS MCP endpoint') }
      if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search || credentialNames(url.href).length || (request.url?.length ?? 0) > 2000) throw new Error('Use an HTTPS endpoint without embedded credentials, query parameters or fragments')
      item.url = url.href; item.headers = fields(request.headers, 'headers')
    } else throw new Error('Choose an MCP transport')
  } else throw new Error('Unknown capability kind')
  const names = new Set(Object.values(item.env ?? item.headers ?? {}).flatMap(credentialNames))
  for (const name of names) {
    const credential = access.credentials.find(item => item.name === name)
    if (!credential || item.botIds.some(id => !credential.botIds.includes(id))) throw new Error(`Credential ${name} must be granted to every selected Bot`)
  }
  access.capabilities = [...access.capabilities.filter(existing => existing.name !== item.name), item]
  return item
}
export function credentialRequest(state: BotState, request: SaveBotCredential): Omit<AccessState['credentials'][number], 'key'> {
  const access = accessState(state), old = access.credentials.find(item => item.name === request.name)
  checkRevision(old, request.revision)
  if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(request.name)) throw new Error('Use an uppercase credential name')
  if (!old && access.credentials.length >= 100) throw new Error('Credential limit reached')
  const botIds = grantedBots(state, request.botIds), shellBotIds = grantedBots(state, request.shellBotIds)
  if (shellBotIds.some(id => !botIds.includes(id))) throw new Error('Shell access must be a subset of credential access')
  if (request.value !== undefined && request.value !== '' && (request.value.length < 8 || request.value.length > 16384 || /\0/.test(request.value))) throw new Error('Credential values must contain 8–16384 characters')
  if (!old && !request.value) throw new Error('A credential value is required')
  return { name: request.name, revision: (old?.revision ?? 0) + 1, description: label(request.description, 2000, 'description'), botIds, shellBotIds }
}
export function removeAccess(state: BotState, request: AccessRemoval): void {
  const access = accessState(state), list = request.kind === 'credential' ? access.credentials : access.capabilities
  const previous = list.find(item => item.name === request.name)
  if (!previous) throw new Error('Configuration no longer exists')
  checkRevision(previous, request.revision)
  if (request.kind === 'credential') access.credentials = access.credentials.filter(item => item.name !== request.name)
  else access.capabilities = access.capabilities.filter(item => item.name !== request.name)
}
export function accessFingerprint(state: BotState, botId: string): string {
  const access = state.access
  return JSON.stringify([access?.capabilities.filter(item => item.botIds.includes(botId)), access?.credentials.filter(item => item.botIds.includes(botId))])
}
/** Exact-value redaction is defense in depth; shell permission still authorizes use of the value. */
export function secretRedactor(values: Iterable<[string, string]>): <T>(value: T) => T {
  const patterns = [...values].flatMap(([_name, value]) => {
    let encoded = value
    try { encoded = encodeURIComponent(value) } catch { /* Raw and JSON forms still redact non-scalar Unicode. */ }
    return [...new Set([value, JSON.stringify(value).slice(1, -1), encoded, encoded.replace(/%[A-F0-9]{2}/g, text => text.toLowerCase()), Buffer.from(value).toString('base64'), Buffer.from(value).toString('base64url')])]
  }).filter(Boolean).sort((a, b) => b.length - a.length)
  let replacement = '[hidden ' + randomUUID() + ']'
  while (patterns.some(pattern => replacement.includes(pattern))) replacement = '[' + randomUUID() + ']'
  const matcher = patterns.length ? new RegExp(patterns.map(pattern => pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g') : undefined
  const clean = (value: unknown): unknown => {
    if (typeof value === 'string') return matcher ? value.replace(matcher, replacement) : value
    if (Array.isArray(value)) return value.map(clean)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item)]))
    return value
  }
  return <T>(value: T): T => clean(value) as T
}
