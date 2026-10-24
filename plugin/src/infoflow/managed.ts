/** Cordis-owned multi-robot runtime: independent connections, shared group receipts and native credentials. */
import { CONNECTOR_PROTOCOL } from '../compatibility.ts'
import { PermanentChatError } from '../external-errors.ts'
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Config } from '../infoflow.ts'
import type { BotId, InfoFlowGroupView, Room } from '../types.ts'
import { InfoFlowManager } from './manager.ts'
import { settingsDomain, type Binding } from './settings.ts'
import { QueueRegistry } from './queues.ts'
import { InfoFlowBridge } from './bridge.ts'
import { InfoFlowTransport, loadSdk, robotApi } from './sdk.ts'

/** Mount page-managed bindings; imported legacy references remain disabled until explicitly enabled in the UI. */
export async function applyManaged(ctx: Context, config: Config): Promise<void> {
  const queues = new QueueRegistry(ctx, 'infoflow')
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
      const name = queueName(accountId)
      const domain = await queues.open(name)
      try {
        const bridge = new InfoFlowBridge(ctx.botMode, domain.global, { prepare: async input => {
          const transport = [...connections.values()].find(item => item.transport.accountId === input.media?.accountId)?.transport
          if (!transport) throw new PermanentChatError('Receiving robot is disabled')
          return transport.prepare(input)
        }, send: async delivery => {
          const target = connections.get(delivery.botId ?? group.defaultBot)
          if (!target) throw new PermanentChatError('Replying robot is disabled')
          await target.transport.send(delivery)
        } }, { ...config, notifyScheduled: true, allowDelegation: true, mentionId: botId => manager.snapshot().bindings.find(binding => binding.botId === botId)?.agentId,
          accountId, botIds: group.botIds, defaultBot: group.defaultBot,
          allowUsers: [], allowGroups: [group.groupId], admins: [group.owner] }, report)
        queues.bind(accountId, name, bridge)
        shared.set(group.groupId, { bridge, room, close: async () => { await bridge.close() } })
        return room
      } finally { queues.cancel(name) }
    })().finally(() => { opening.delete(group.groupId) })
    opening.set(group.groupId, task)
    return task
  }
  const manager = new InfoFlowManager(settings.global, {
    bots: () => ctx.botMode.snapshot().bots.map(bot => bot.id), resolve,
    unset: ref => ctx.credentials.unset(credentialRef(ref)),
    set: (ref, value) => ctx.credentials.set(credentialRef(ref), value), stop, link,
    api: (binding, secrets) => robotApi(loadSdk(), { ...secrets, agentId: binding.agentId, timeout: config.endpointTimeoutMs, ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}) }),
    start: async binding => {
      const [appKey, appSecret] = await Promise.all([resolve(binding.appKeyRef), resolve(binding.appSecretRef)])
      if (!appKey || !appSecret) throw new Error('Missing robot credentials')
      for (const groupId of binding.allowGroups) await ctx.botMode.ensureExternalRoom({
        conversation: { provider: 'infoflow', accountId: binding.agentId, kind: 'group', id: groupId },
        title: `如流 · ${groupId}`, botIds: [binding.botId], defaultBot: binding.botId,
      })
      const name = queueName(`bot:${binding.botId}:${binding.agentId}`)
      const domain = await queues.open(name)
      let bridge: InfoFlowBridge | undefined
      let transport: InfoFlowTransport | undefined
      try {
        const connection = new InfoFlowTransport(loadSdk(), { ...config, accountId: binding.agentId, robotId: binding.robotId, appKey, appSecret,
          upload: request => ctx.botMode.upload(request), read: item => ctx.botMode.readAttachment(item),
          allowMedia: input => input.conversation.kind === 'private' ? binding.allowUsers.includes(input.message.sender.id)
            : binding.allowAllGroups === true || binding.allowGroups.includes(input.conversation.id)
              || manager.snapshot().groups.some(group => group.groupId === input.conversation.id && group.botIds.includes(binding.botId) && group.status === 'ready'),
          robotIds: () => manager.snapshot().bindings.flatMap(peer => [peer.robotId, peer.agentId]) }, async (input, mentions) => {
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
        const owner = new InfoFlowBridge(ctx.botMode, domain.global, { prepare: async input => {
          const transport = [...connections.values()].find(item => item.transport.accountId === input.media?.accountId)?.transport
          if (!transport) throw new PermanentChatError('Receiving robot is disabled')
          return transport.prepare(input)
        }, send: async delivery => {
          const target = connections.get(delivery.botId ?? binding.botId)
          if (!target) throw new PermanentChatError('Replying robot is disabled')
          await target.transport.send(delivery)
        } }, { ...config, accountId: binding.agentId, notifyScheduled: true, allowDelegation: true,
          notifyGroup: groupId => !manager.snapshot().groups.some(group => group.groupId === groupId && group.status === 'ready'),
          mentionId: botId => manager.snapshot().bindings.find(item => item.botId === botId)?.agentId,
          groupBotIds: groupId => manager.snapshot().bindings.filter(peer => peer.enabled
            && (peer.allowAllGroups === true || peer.allowGroups.includes(groupId))).map(peer => peer.botId),
          botIds: [binding.botId], defaultBot: binding.botId, allowUsers: binding.allowUsers, allowGroups: binding.allowGroups, allowAllGroups: binding.allowAllGroups === true, admins: binding.admins }, report)
        bridge = owner
        queues.bind(binding.botId, name, owner)
        connections.set(binding.botId, { transport: connection, bridge: owner, close: async () => { await connection.close(); await owner.close() } })
        connection.start()
      } catch (error) { await Promise.allSettled([transport?.close(), bridge?.close()]); throw error }
      finally { queues.cancel(name) }
    },
  })
  const detachDiscovery = ctx.botMode.attachQueueDiscovery(async () => {
    for (const binding of settings.global.get().bindings) await queues.offline(binding.botId, queueName(`bot:${binding.botId}:${binding.agentId}`), {
      ...config, accountId: binding.agentId, botIds: [binding.botId], defaultBot: binding.botId,
      allowUsers: binding.allowUsers, allowGroups: binding.allowGroups, admins: binding.admins,
    })
    for (const group of settings.global.get().groups) if (group.groupId) await queues.offline(`group:${group.groupId}`, queueName(`group:${group.groupId}`), {
      ...config, accountId: `group:${group.groupId}`, botIds: group.botIds, defaultBot: group.defaultBot,
      allowUsers: [], allowGroups: [group.groupId], admins: [group.owner],
    })
  }, CONNECTOR_PROTOCOL)
  const abort = new AbortController()
  let feed: Promise<void> | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  const detach = ctx.botMode.attachInfoFlow(manager, CONNECTOR_PROTOCOL)
  ctx.effect(() => async () => {
    detach(); detachDiscovery(); abort.abort(); if (timer) clearInterval(timer)
    await manager.close()
    await Promise.allSettled([...opening.values()])
    await Promise.all([...connections.keys()].map(stop))
    await Promise.all([...shared.values()].map(item => item.close()))
    await feed; await queues.close(); await settings.close()
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
