/** Optional Feishu companion, with one independently owned robot per DSH Bot. */
import Schema from '@deepseek-ai/schemastery'
import type { BridgeConfig } from './infoflow/bridge.ts'
import { checkIM } from './compatibility.ts'
import type { Context } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from './index.ts'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'
import type { BotId } from './types.ts'
import { InfoFlowBridge } from './infoflow/bridge.ts'
import { bridgeDomain } from './infoflow/domain.ts'
import { settingsDomain } from './feishu/settings.ts'
import { FeishuManager } from './feishu/manager.ts'
import { FeishuTransport, createGroup, identity, loadSdk, qrImage, register } from './feishu/sdk.ts'
export const name = 'bot-feishu'
export const inject = ['botMode', 'storageDomain', 'credentials']
export interface Config extends Pick<BridgeConfig, 'maxPending' | 'maxQueuePerRoom' | 'maxConcurrentRooms' | 'maxReceipts' | 'maxOutbox' | 'chunkSize' | 'retryMs' | 'maxRetryMs'> { endpointTimeoutMs: number; pollMs: number }
export const Config: Schema<Config> = Schema.object({
  maxPending: Schema.natural().min(1).default(200), maxQueuePerRoom: Schema.natural().min(1).default(20), maxConcurrentRooms: Schema.natural().min(1).default(4),
  maxReceipts: Schema.natural().min(1).default(100000), maxOutbox: Schema.natural().min(20).default(10000), chunkSize: Schema.natural().min(100).max(3000).default(3000),
  retryMs: Schema.natural().min(100).default(5000), maxRetryMs: Schema.natural().min(100).default(120000),
  endpointTimeoutMs: Schema.natural().min(1000).default(15000), pollMs: Schema.natural().min(100).default(1000),
})
export async function apply(ctx: Context, config: Config): Promise<void> {
  checkIM(ctx)
  const settings = await ctx.storageDomain.open(settingsDomain)
  const connections = new Map<BotId, { bridge: InfoFlowBridge; close(): Promise<void> }>()
  const stop = async (botId: BotId) => { const current = connections.get(botId); if (current) { connections.delete(botId); await current.close() } }
  const report = () => { ctx.logger.warn('Feishu operation failed; check connection status and retained work') }
  const resolve = async (ref: string) => (await ctx.credentials.resolve(credentialRef(ref)))?.value
  const manager = new FeishuManager(settings.global, {
    bots: () => ctx.botMode.snapshot().bots,
    createGroup: (binding, secret, options) => createGroup(loadSdk(config.endpointTimeoutMs), binding.appId, secret, binding.brand, config.endpointTimeoutMs, options),
    linkGroup: async (group, bindings) => {
      if (!group.chatId) throw new Error('Created chat ID required')
      return ctx.botMode.ensureExternalRoom({ conversation: { provider: 'feishu', accountId: `group:${group.chatId}`, kind: 'group', id: group.chatId },
        title: group.title, botIds: bindings.map(binding => binding.botId), defaultBot: group.creatorBot })
    },
    resolve, set: (ref, value) => ctx.credentials.set(credentialRef(ref), value), stop,
    identity: (appId, secret, brand) => identity(loadSdk(config.endpointTimeoutMs), appId, secret, brand, config.endpointTimeoutMs),
    register: options => register(loadSdk(config.endpointTimeoutMs), options), qrImage,
    start: async binding => {
      const appSecret = await resolve(binding.secretRef)
      if (!appSecret || !binding.botOpenId) throw new Error('Robot identity and credentials required')
      for (const chatId of binding.allowGroups) await ctx.botMode.ensureExternalRoom({
        conversation: { provider: 'feishu', accountId: binding.appId, kind: 'group', id: chatId },
        title: `飞书 · ${chatId}`, botIds: [binding.botId], defaultBot: binding.botId,
      })
      const queue = await ctx.storageDomain.open(bridgeDomain(`bot_fs_${createHash('sha256').update(`${binding.botId}:${binding.appId}`).digest('hex').slice(0, 28)}`))
      let bridge: InfoFlowBridge | undefined, transport: FeishuTransport | undefined
      try {
        transport = new FeishuTransport(loadSdk(config.endpointTimeoutMs), { ...binding, appSecret, timeoutMs: config.endpointTimeoutMs }, input => bridge!.receive({ ...input, targets: [binding.botId] }),
          status => { manager.connection(binding.botId, status, status === 'error' ? '长连接异常，请检查事件订阅、应用发布状态和网络后重新启用' : null) }, report)
        bridge = new InfoFlowBridge(ctx.botMode, queue.global, transport, { ...config, provider: 'feishu', accountId: binding.appId,
          botIds: [binding.botId], defaultBot: binding.botId, allowUsers: binding.allowUsers, allowGroups: binding.allowGroups, admins: binding.admins }, report)
        const currentBridge = bridge, currentTransport = transport
        connections.set(binding.botId, { bridge, close: async () => { await currentTransport.close(); await currentBridge.close(); await queue.close() } })
        transport.start()
      } catch (cause) { await transport?.close(); await bridge?.close(); await queue.close(); throw cause }
    },
  })
  const abort = new AbortController()
  const wake = async () => { await Promise.all([...connections.values()].map(item => item.bridge.wake())) }
  let feed: Promise<void> | undefined, timer: ReturnType<typeof setInterval> | undefined
  const detach = ctx.botMode.attachFeishu(manager)
  ctx.effect(() => async () => {
    detach(); abort.abort(); if (timer) clearInterval(timer)
    await manager.close(); await Promise.all([...connections.keys()].map(stop)); await feed; await settings.close()
  }, 'feishu: cancel registration, drain handlers and close native queues')
  await manager.init()
  ctx.on('session/event', (session, event) => {
    if (event.type === 'approval/asked') for (const { bridge } of connections.values()) void bridge.attention(session.id, `approval:${event.data.id}`).catch(report)
  })
  ctx.on('user-questions/request', async (request, next) => {
    if (request.agent) for (const { bridge } of connections.values()) void bridge.attention(request.agent.session.id,
      `question:${createHash('sha256').update(JSON.stringify(request.questions)).digest('hex')}`).catch(report)
    return next()
  }, { prepend: true })
  feed = (async () => { for await (const _frame of ctx.botMode.follow(abort.signal)) await wake() })().catch(() => { if (!abort.signal.aborted) report() })
  timer = setInterval(() => { void wake().catch(report) }, config.pollMs); timer.unref()
}
