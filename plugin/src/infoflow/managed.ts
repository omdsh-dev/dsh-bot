/** Cordis-owned multi-robot runtime: independent connections, shared group receipts and native credentials. */
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Config } from '../infoflow.ts'
import type { BotId, InfoFlowGroupView, Room } from '../types.ts'
import { InfoFlowManager } from './manager.ts'
import { settingsDomain, type Binding } from './settings.ts'
import { bridgeDomain } from './domain.ts'
import { InfoFlowBridge } from './bridge.ts'
import { InfoFlowTransport, loadSdk, robotApi } from './sdk.ts'

/** Mount page-managed bindings; imported legacy references remain disabled until explicitly enabled in the UI. */
export async function applyManaged(ctx: Context, config: Config): Promise<void> {
  const settings = await ctx.storageDomain.open(settingsDomain)
  const connections = new Map<BotId, { transport: InfoFlowTransport; bridge: InfoFlowBridge; close(): Promise<void> }>()
  const shared = new Map<string, { bridge: InfoFlowBridge; room: Room; close(): Promise<void> }>()
  const opening = new Map<string, Promise<Room>>()
  const report = (message: string) => { ctx.logger.warn(message) }
  const wake = async () => { await Promise.all([...connections.values(), ...shared.values()].map(item => item.bridge.wake())) }
  const stop = async (botId: BotId) => { const current = connections.get(botId); if (current) { connections.delete(botId); await current.close() } }
  const queueName = (identity: string) => `bot_if_${createHash('sha256').update(identity).digest('hex').slice(0, 28)}`
  const resolve = async (ref: string) => (await ctx.credentials.resolve(credentialRef(ref)))?.value
  const link = (group: InfoFlowGroupView): Promise<Room> => {
    const existing = shared.get(group.groupId)
    if (existing) return Promise.resolve(existing.room)
    const pending = opening.get(group.groupId)
    if (pending) return pending
    const task = (async () => {
      const accountId = `group:${group.groupId}`
      const room = await ctx.botMode.ensureExternalRoom({ conversation: { provider: 'infoflow', accountId, kind: 'group', id: group.groupId },
        title: group.title, botIds: group.botIds, defaultBot: group.defaultBot })
      const domain = await ctx.storageDomain.open(bridgeDomain(queueName(accountId)))
      const bridge = new InfoFlowBridge(ctx.botMode, domain.global, { send: async delivery => {
        const target = connections.get(delivery.botId ?? group.defaultBot)
        if (!target) throw new Error('Replying robot is disabled; retain its outbox')
        await target.transport.send(delivery)
      } }, { ...config, allowDelegation: true, mentionId: botId => manager.snapshot().bindings.find(binding => binding.botId === botId)?.agentId,
        accountId, botIds: group.botIds, defaultBot: group.defaultBot,
        allowUsers: [], allowGroups: [group.groupId], admins: [group.owner] }, report)
      shared.set(group.groupId, { bridge, room, close: async () => { await bridge.close(); await domain.close() } })
      return room
    })().finally(() => { opening.delete(group.groupId) })
    opening.set(group.groupId, task)
    return task
  }
  const manager = new InfoFlowManager(settings.global, {
    bots: () => ctx.botMode.snapshot().bots.map(bot => bot.id), resolve,
    set: (ref, value) => ctx.credentials.set(credentialRef(ref), value), stop, link,
    api: (binding, secrets) => robotApi(loadSdk(), { ...secrets, agentId: binding.agentId, timeout: config.endpointTimeoutMs, ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}) }),
    start: async binding => {
      const [appKey, appSecret] = await Promise.all([resolve(binding.appKeyRef), resolve(binding.appSecretRef)])
      if (!appKey || !appSecret) throw new Error('Missing robot credentials')
      for (const groupId of binding.allowGroups) await ctx.botMode.ensureExternalRoom({
        conversation: { provider: 'infoflow', accountId: binding.agentId, kind: 'group', id: groupId },
        title: `如流 · ${groupId}`, botIds: [binding.botId], defaultBot: binding.botId,
      })
      const domain = await ctx.storageDomain.open(bridgeDomain(queueName(`bot:${binding.botId}:${binding.agentId}`)))
      let bridge: InfoFlowBridge | undefined
      let transport: InfoFlowTransport | undefined
      try {
        const connection = new InfoFlowTransport(loadSdk(), { ...config, accountId: binding.agentId, robotId: binding.robotId, appKey, appSecret }, async (input, mentions) => {
          const state = manager.snapshot()
          const group = input.conversation.kind === 'group' ? state.groups.find(item => item.groupId === input.conversation.id) : undefined
          if (group) {
            if (!group.botIds.includes(binding.botId)) return
            const targets = group.botIds.filter(botId => state.bindings.some(item => item.botId === botId && item.enabled && mentions.includes(item.robotId)))
            if (!targets.length) return
            await link(group)
            return shared.get(group.groupId)!.bridge.receive({ ...input, conversation: { ...input.conversation, accountId: `group:${group.groupId}` }, targets })
          }
          return bridge!.receive({ ...input, targets: [binding.botId] })
        }, report, status => { manager.connection(binding.botId, status, status === 'error' ? '长连接暂时不可用，正在重连' : null) })
        transport = connection
        const owner = new InfoFlowBridge(ctx.botMode, domain.global, { send: async delivery => {
          const target = connections.get(delivery.botId ?? binding.botId)
          if (!target) throw new Error('Replying robot is disabled; retain its outbox')
          await target.transport.send(delivery)
        } }, { ...config, accountId: binding.agentId, allowDelegation: true,
          mentionId: botId => manager.snapshot().bindings.find(item => item.botId === botId)?.agentId,
          groupBotIds: groupId => manager.snapshot().bindings.filter(peer => peer.enabled
            && (peer.allowAllGroups === true || peer.allowGroups.includes(groupId))).map(peer => peer.botId),
          botIds: [binding.botId], defaultBot: binding.botId, allowUsers: binding.allowUsers, allowGroups: binding.allowGroups, allowAllGroups: binding.allowAllGroups === true, admins: binding.admins }, report)
        bridge = owner
        connections.set(binding.botId, { transport: connection, bridge: owner, close: async () => { await connection.close(); await owner.close(); await domain.close() } })
        connection.start()
      } catch (error) { await transport?.close(); await bridge?.close(); await domain.close(); throw error }
    },
  })
  const abort = new AbortController()
  let feed: Promise<void> | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  const detach = ctx.botMode.attachInfoFlow(manager)
  ctx.effect(() => async () => {
    detach(); abort.abort(); if (timer) clearInterval(timer)
    await manager.close()
    await Promise.allSettled([...opening.values()])
    await Promise.all([...connections.keys()].map(stop))
    await Promise.all([...shared.values()].map(item => item.close()))
    await feed; await settings.close()
  }, 'infoflow-manager: detach controls and drain connections/queues')
  let seed: Binding | undefined
  if (config.accountId && config.robotId && config.defaultBot) seed = { botId: brandString<BotId>(config.defaultBot), agentId: config.accountId,
    robotId: config.robotId, robotName: config.defaultBot, enabled: false, appKeyRef: config.appKeyRef, appSecretRef: config.appSecretRef,
    allowUsers: config.allowUsers, allowGroups: config.allowGroups, admins: config.admins }
  await manager.init(seed)
  ctx.on('session/event', (session, event) => {
    if (event.type === 'approval/asked') for (const { bridge } of [...connections.values(), ...shared.values()]) void bridge.attention(session.id, `approval:${event.data.id}`).catch(() => { report('InfoFlow attention notice could not be saved') })
  })
  ctx.on('user-questions/request', async (request, next) => {
    if (request.agent) for (const { bridge } of [...connections.values(), ...shared.values()]) void bridge.attention(request.agent.session.id,
      `question:${createHash('sha256').update(JSON.stringify(request.questions)).digest('hex')}`).catch(() => { report('InfoFlow question notice could not be saved') })
    return next()
  }, { prepend: true })
  feed = (async () => { for await (const _frame of ctx.botMode.follow(abort.signal)) await wake() })().catch(() => { if (!abort.signal.aborted) report('InfoFlow state feed disconnected; periodic reconciliation remains active') })
  timer = setInterval(() => { void wake().catch(() => { report('InfoFlow reconciliation failed; queues retained') }) }, config.pollMs)
  timer.unref()
}
