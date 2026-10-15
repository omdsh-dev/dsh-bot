/** Optional native InfoFlow plugin; credentials, storage and execution remain DSH-owned. */
import type { Context } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import Schema from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'
import type {} from './index.ts'
import { InfoFlowBridge, type BridgeConfig } from './infoflow/bridge.ts'
import { infoflowDomain } from './infoflow/domain.ts'
import { InfoFlowTransport, loadSdk } from './infoflow/sdk.ts'
import { applyManaged } from './infoflow/managed.ts'
import type { BotId } from './types.ts'

/** Validated connector settings. Secret values never appear in plugin config or snapshots. */
export interface Config extends Omit<BridgeConfig, 'botIds' | 'defaultBot' | 'labelReplies'> {
  managed: boolean; botIds: string[]; defaultBot: string; robotId: string; appKeyRef: string; appSecretRef: string
  baseUrl: string; wsGateway: string; wsConnectDomain: string
  endpointTimeoutMs: number; sendTimeoutMs: number; connectRetryMs: number; maxConnectRetryMs: number; pollMs: number
}
export const name = 'bot-infoflow'
export const inject = ['botMode', 'storageDomain', 'credentials']
export const Config: Schema<Config> = Schema.object({
  managed: Schema.boolean().default(false),
  accountId: Schema.string().default(''), robotId: Schema.string().default(''),
  appKeyRef: Schema.string().default('INFOFLOW_APP_KEY'), appSecretRef: Schema.string().default('INFOFLOW_APP_SECRET'),
  botIds: Schema.array(Schema.string()).default([]), defaultBot: Schema.string().default(''),
  allowUsers: Schema.array(Schema.string()).default([]), allowGroups: Schema.array(Schema.string()).default([]), admins: Schema.array(Schema.string()).default([]),
  baseUrl: Schema.string().default(''), wsGateway: Schema.string().default(''), wsConnectDomain: Schema.string().default(''),
  maxPending: Schema.natural().min(1).default(200), maxQueuePerRoom: Schema.natural().min(1).default(20), maxConcurrentRooms: Schema.natural().min(1).default(4),
  maxReceipts: Schema.natural().min(1).default(100000), maxOutbox: Schema.natural().min(20).default(10000),
  chunkSize: Schema.natural().min(100).max(3000).default(3000), retryMs: Schema.natural().min(100).default(5000), maxRetryMs: Schema.natural().min(100).default(120000),
  endpointTimeoutMs: Schema.natural().min(1000).default(30000), sendTimeoutMs: Schema.natural().min(1000).default(30000),
  connectRetryMs: Schema.natural().min(100).default(5000), maxConnectRetryMs: Schema.natural().min(100).default(120000), pollMs: Schema.natural().min(100).default(1000),
})

/** Mount the managed robot registry or the legacy single connector after Bot Mode.
 * @param ctx - native Host scope. @param config - validated user deployment settings.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  if (config.baseUrl && !/^https:\/\//.test(config.baseUrl)) throw new Error('InfoFlow baseUrl must use HTTPS')
  for (const domain of [config.wsGateway, config.wsConnectDomain]) {
    if (domain && !/^[a-zA-Z0-9.-]+(?::\d+)?$/.test(domain)) throw new Error('InfoFlow WebSocket overrides must be domain names without a URL scheme or path')
  }
  if (config.managed) { await applyManaged(ctx, config); return }
  if (!config.accountId.trim() || !config.robotId.trim() || !config.botIds.length || !config.botIds.includes(config.defaultBot)) throw new Error('InfoFlow requires an account ID, robot AT ID, and a default Bot in botIds')
  if (config.botIds.some(id => !ctx.botMode.snapshot().bots.some(bot => bot.id === id))) throw new Error('Create the configured InfoFlow Bots in DSH before enabling the connector')
  const [key, secret] = await Promise.all([ctx.credentials.resolve(credentialRef(config.appKeyRef)), ctx.credentials.resolve(credentialRef(config.appSecretRef))])
  if (!key || !secret) throw new Error('Configure the InfoFlow application key and secret through DSH credentials before enabling the connector')
  const sdk = loadSdk()
  const domain = await ctx.storageDomain.open(infoflowDomain)
  const abort = new AbortController()
  let bridge: InfoFlowBridge | undefined
  let transport: InfoFlowTransport | undefined
  let feed: Promise<void> | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  ctx.effect(() => async () => {
    abort.abort()
    if (timer) clearInterval(timer)
    await transport?.close()
    await bridge?.close()
    await feed
    await domain.close()
  }, 'infoflow: disconnect, drain handlers and close durable queues')
  const report = (message: string) => { ctx.logger.warn(message) }
  const connection = new InfoFlowTransport(sdk, { ...config, appKey: key.value, appSecret: secret.value }, input => bridge!.receive(input), report)
  transport = connection
  const owner = new InfoFlowBridge(ctx.botMode, domain.global, connection,
    { ...config, botIds: config.botIds.map(brandString<BotId>), defaultBot: brandString<BotId>(config.defaultBot), labelReplies: config.botIds.length > 1 }, report)
  bridge = owner
  ctx.on('session/event', (session, event) => {
    if (event.type === 'approval/asked') void owner.attention(session.id, `approval:${event.data.id}`).catch(() => { report('InfoFlow approval notice could not be persisted') })
  })
  ctx.on('user-questions/request', async (request, next) => {
    if (request.agent) void owner.attention(request.agent.session.id, `question:${createHash('sha256').update(JSON.stringify(request.questions)).digest('hex')}`).catch(() => { report('InfoFlow question notice could not be persisted') })
    return next()
  }, { prepend: true })
  feed = (async () => { for await (const _frame of ctx.botMode.follow(abort.signal)) await owner.wake() })()
    .catch(() => { if (!abort.signal.aborted) report('InfoFlow Bot feed disconnected; periodic reconciliation remains active') })
  timer = setInterval(() => { void owner.wake() }, config.pollMs)
  timer.unref()
  connection.start()
}
