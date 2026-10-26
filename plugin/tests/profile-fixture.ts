/** Keyless real-profile driver. Only the external model is replaced. */
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { once } from 'node:events'
import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type {} from '../src/index.ts'
import type { RoomId } from '../src/types.ts'

const CONNECTOR_PROTOCOL = 2
export const name = 'bot-mode-profile-fixture'
export const inject = ['botMode', 'llm', 'storageDomain', 'agents']
export async function apply(ctx: Context): Promise<void> {
  const requests: GenerateOptions[] = []
  let knowledgeMessageId = ''
  let browserUrl = ''
  class Fixture extends LlmAdapter {
    async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      if (options.purpose !== 'session-title') requests.push(options)
      if (typeof options.system === 'string' && options.system.startsWith('Extract only lasting preferences')) {
        const text = JSON.stringify({ candidates: [{ scope: 'user', kind: 'preference', subject: 'response', topic: 'auto-language', body: 'Use Chinese for future replies.', evidence: '以后请用中文回复。' }] })
        yield { type: 'text-delta', index: 0, text }
        yield { type: 'usage', usage: { inputTokens: 5, outputTokens: 4 } }
        yield { type: 'finish', reason: { kind: 'stop' } }; return
      }
      // Skill/context plugins may append user-role context after the public request.
      const content = JSON.stringify(options.messages.findLast(message => message.role === 'user'
        && message.content.some(block => block.type === 'text' && block.text.includes('Public chat messages (JSON data):'))) ?? options.messages.at(-1))
      // DSH 0.1 represents tool results as blocks in user messages; 0.2 uses tool-role messages.
      const hasResult = (id: string) => options.messages.some(message => message.role === 'tool' && message.toolCallId === id
        || message.content.some(block => { const kind: unknown = Reflect.get(block, 'type'); return kind === 'tool-result' && Reflect.get(block, 'toolCallId') === id }))
      const memoryResult = hasResult('memory-fixture-call')
      let tool: { id: string; name: string; args: unknown } | undefined
      if (content.includes('KNOWLEDGE_FIXTURE')) tool = [
        { id: 'knowledge-search', name: 'search_chat', args: { query: 'ARCHIVE_LOOKUP_FIXTURE' } },
        { id: 'knowledge-read', name: 'read_chat', args: { messageId: knowledgeMessageId } },
        { id: 'knowledge-memory', name: 'memory_recall', args: { query: 'shared-fixture' } },
        { id: 'knowledge-status', name: 'task_status', args: {} },
      ].find(call => !hasResult(call.id))
      if (content.includes('DISCOVERY_FIXTURE') && !hasResult('discovery-list')) tool = { id: 'discovery-list', name: 'discover_bots', args: { query: '数据分析' } }
      const imTarget = content.match(/IM_CREATE_FIXTURE:([a-z-]+)/)?.[1]
      if (imTarget) tool = [
        { id: `im-discover-${imTarget}`, name: 'discover_bots', args: { query: 'Research' } },
        { id: `im-create-${imTarget}`, name: 'create_bot', args: { draft: JSON.stringify({ id: imTarget, name: `IM ${imTarget}`, instructions: 'Gather evidence.', capabilities: 'Research requested from IM' }) } },
      ].find(call => !hasResult(call.id))
      const groupNameTarget = content.match(/GROUP_NAME_FIXTURE:(feishu|infoflow)/)?.[1]
      if (groupNameTarget && !hasResult(`group-name-${groupNameTarget}`)) tool = { id: `group-name-${groupNameTarget}`, name: 'set_group_name', args: { title: `${groupNameTarget} 对话补齐群` } }
      if (content.includes('ACCESS_TOOL_FIXTURE') && !hasResult('access-inspect')) tool = { id: 'access-inspect', name: 'mcp__bot_access-fixture__inspect', args: {} }
      if (content.includes('CARD_VIEW_FIXTURE') && !hasResult('card-view')) tool = { id: 'card-view', name: 'show_card', args: { id: 'followup', card: JSON.stringify({ kind: 'form', title: 'Native form fixture', submitLabel: 'Continue', fields: [{ name: 'detail', label: 'Detail', type: 'text', required: true }] }) } }
      if (content.includes('TEAM_FIXTURE')) tool = [
        { id: 'team-list', name: 'team_list', args: {} },
        { id: 'team-create', name: 'team_manage', args: { command: JSON.stringify({ operation: 'create-bot', id: 'team-worker', name: 'Team worker', instructions: 'Gather evidence.', capabilities: 'Research and evidence gathering.' }) } },
        { id: 'team-group', name: 'team_manage', args: { command: JSON.stringify({ operation: 'create-group', title: 'Native team fixture', botIds: ['team-worker'], defaultBot: 'team-worker' }) } },
      ].find(call => !hasResult(call.id))
      for (const [marker, id, path] of [['BROWSER_OWNER_FIXTURE', 'browser-owner', 'set'], ['BROWSER_OTHER_FIXTURE', 'browser-other', 'other'], ['BROWSER_FRESH_FIXTURE', 'browser-fresh', 'fresh']]) {
        if (content.includes(marker!) && !hasResult(id!)) tool = { id: id!, name: 'mcp__bot_browser-fixture__browser_navigate', args: { url: browserUrl + path } }
      }
      if (content.includes('BROWSER_OWNER_FIXTURE') && hasResult('browser-owner') && !hasResult('browser-owner-check')) tool = { id: 'browser-owner-check', name: 'mcp__bot_browser-fixture__browser_navigate', args: { url: browserUrl + 'owner-check' } }
      if (content.includes('COLLAB_FIXTURE') && !content.includes('Delegated task from') && !hasResult('collab-delegate'))
        tool = { id: 'collab-delegate', name: 'delegate_task', args: { botId: 'collab-worker', task: 'Return a verified result for this fixture.' } }
      if (options.purpose !== 'session-title' && tool) {
        const id = ToolCallId(tool.id), args = JSON.stringify(tool.args)
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id, name: tool.name, argumentsDelta: args }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name: tool.name, arguments: args } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }; return
      }
      if (options.purpose !== 'session-title' && content.includes('MEMORY_PROPOSAL_FIXTURE') && !memoryResult) {
        const args = JSON.stringify({ scope: 'user', kind: 'preference', subject: 'response', topic: 'paragraphs', body: 'Prefer short paragraphs.', evidence: 'Remember to use short paragraphs.' })
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id: ToolCallId('memory-fixture-call'), name: 'bot_memory_propose', argumentsDelta: args }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId('memory-fixture-call'), name: 'bot_memory_propose', arguments: args } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }
        return
      }
      if (options.purpose !== 'session-title' && content.includes('WAIT_FOR_STOP')) {
        await new Promise<void>((resolve) => {
          if (options.signal?.aborted) resolve()
          else options.signal?.addEventListener('abort', () => { resolve() }, { once: true })
        })
        options.signal?.throwIfAborted()
      }
      const text = process.env.BOT_TEST_PHASE === 'preview'
        ? `【本地联调 · 未连接真实模型】\n${JSON.stringify(options.messages[0]).includes('产品') ? '产品 Bot：我负责需求与体验。这个群里的公开消息会进入我的独立 DSH Session。' : JSON.stringify(options.messages[0]).includes('工程') ? '工程 Bot：我负责实现与验证。工具、审批和执行记录沿用 DSH 原生能力。' : 'DSH Bot：我负责整理问题。你可以 @某个 Bot、@all，或者回复某个 Bot 的消息继续讨论。'}`
        : content.includes('COLLAB_FIXTURE') ? content.includes('Your delegated work has returned') ? 'COLLAB_SUMMARY_DONE' : content.includes('Delegated task from') ? 'VERIFIED_CHILD_RESULT' : 'Task recorded.' : `fixture answer ${requests.length}`
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'usage', usage: { inputTokens: 3, outputTokens: 2 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['bot-fixture'], new Fixture())
  ctx.llm.registerAdapter(['bot-selected-fixture'], new Fixture())
  async function settled(id: RoomId) {
    const deadline = Date.now() + 15000
    while (ctx.botMode.snapshot().rooms.find(room => room.id === id)!.messages.some(message => ['running', 'queued'].includes(message.status))) {
      if (Date.now() > deadline) throw new Error(`Bot response did not settle: ${JSON.stringify({ room: ctx.botMode.snapshot().rooms.find(room => room.id === id), latest: requests.at(-1)?.messages.slice(-3) })}`)
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    return ctx.botMode.snapshot().rooms.find(room => room.id === id)!
  }
  if (process.env.BOT_TEST_PHASE === 'preview') {
    if (!ctx.botMode.snapshot().bots.length) {
      const a = await ctx.botMode.createBot({ id: 'dsh', name: 'DSH Bot', instructions: '通用助手，负责组织讨论。' })
      const b = await ctx.botMode.createBot({ id: 'product', name: '产品 Bot', instructions: '产品与体验设计助手。' })
      const c = await ctx.botMode.createBot({ id: 'engineer', name: '工程 Bot', instructions: '工程实现与验证助手。' })
      const room = await ctx.botMode.createGroup({ title: 'DSH Bot 设计讨论', botIds: [a.id, b.id, c.id], defaultBot: a.id })
      await ctx.botMode.send({ roomId: room.id, text: '@all 介绍一下你在这个聊天中的职责，以及 DSH 插件如何支持多 Bot。' })
    }
    return
  }
  try {
    const service = ctx.botMode
    await service.configureKnowledge({ reviewEnabled: false })
    if (process.env.BOT_TEST_PHASE === 'resume') {
      assert.equal(service.snapshot().bots.find(bot => bot.id === 'team-worker')?.capabilities, 'Research and evidence gathering.')
      assert.equal(service.snapshot().infoflowVisible, false, 'An explicit hidden preference survives restart, including existing InfoFlow chats')
      assert.deepEqual(service.snapshot().bots.find(bot => bot.id === 'critic')!.policy,
        { provider: 'bot-selected-fixture', model: 'selected-fixture-model', toolMode: 'none', tools: [] })
      assert.equal(service.snapshot().schedules?.find(item => item.name === 'Restart reservation')?.enabled, false, 'Paused schedule configuration survives native storage reload')
      assert.equal(service.snapshot().budget?.currency, 'CNY', 'Budget settings survive native storage reload')
      const historyRoom = service.snapshot().rooms.find(room => room.title === 'History segmentation fixture')!
      assert.ok(historyRoom.messages.length <= 256, 'Idle history remains archived after restart'); assert.equal(historyRoom.messageCount, 600); assert.equal((await service.connectorRoom(historyRoom.id)).messages.length, 600)
      assert.equal((await service.history({ roomId: historyRoom.id, query: 'ARCHIVE_010', limit: 50 })).total, 1)
      const duplicate = await service.submitExternalMessage({ roomId: historyRoom.id, text: 'ARCHIVE_010', external: { id: 'receipt-10', sender: { id: 'history-user', name: 'History User' } } })
      assert.equal(duplicate.status, 'accepted', 'Archived receipts still prevent replay')
      assert.equal(requests.length, 0)
      const before = service.snapshot().rooms.find(room => room.kind === 'group')!
      assert.equal(before.messages.length, 8)
      const ids = before.members.map(member => member.sessionId)
      await service.send({ roomId: before.id, text: '@all after process restart' })
      const after = await settled(before.id)
      assert.deepEqual(after.members.map(member => member.sessionId), ids)
      assert.ok(after.messages.slice(-2).every(message => message.status === 'complete'), JSON.stringify(after))
      assert.equal(requests.length, 2)
      assert.ok(requests.every(request => JSON.stringify(request.messages).includes('first public question')))
      assert.ok(requests.every(request => !JSON.stringify(request.messages).includes('PRIVATE_SECRET')))
      assert.ok(requests.every(request => JSON.stringify(request.messages).includes('GLOBAL_MEMORY_FIXTURE')))
      assert.ok(requests.every(request => !JSON.stringify(request.messages).includes('PRIVATE_MEMORY_FIXTURE')))
      assert.equal(service.listMemories({ status: 'pending' }).find(item => item.topic === 'paragraphs')?.body, 'Prefer short paragraphs.', 'Tool proposals survive restart without becoming active')
      assert.equal(service.knowledgeStatus().reviews.filter(item => item.status === 'complete').length, 1, 'Completed maintenance survives restart')
      const personal = service.listMemories({ status: 'active' }).find(item => item.topic === 'private-fixture')!
      const privateRoom = service.snapshot().rooms.find(item => item.kind === 'dm' && item.defaultBot === 'architect')!
      const previousSession = privateRoom.members[0]!.sessionId
      await service.memoryAction({ id: personal.id, revision: personal.revision, action: 'forget' })
      await service.send({ roomId: privateRoom.id, text: 'AFTER_FORGET_FIXTURE' })
      const fresh = await settled(privateRoom.id)
      assert.notEqual(fresh.members[0]!.sessionId, previousSession)
      assert.equal(fresh.members[0]!.segments?.at(-1)?.reason, 'memory-access-changed')
      assert.equal(fresh.messages.at(-1)!.status, 'complete', JSON.stringify(fresh.messages.at(-1)))
      assert.ok(!JSON.stringify(requests.at(-1)!.messages).includes('PRIVATE_MEMORY_FIXTURE'), 'Forgotten frames do not enter the fresh native Session')

    } else {
      const bytes = Buffer.from('native attachment service access')
      const file = await service.upload({ name: 'native-service-check.txt', mediaType: 'text/plain', base64: bytes.toString('base64') })
      const downloaded = await service.readAttachment(file)
      assert.equal(Buffer.from(downloaded.base64, 'base64').toString(), bytes.toString(), 'Media crosses the real Cordis service boundary')
      assert.ok((await service.catalog()).providers.some(provider => provider.id === 'bot-fixture'), 'Catalog reads optional native services without an Agent')
      assert.equal(service.snapshot().infoflowVisible, false, 'New profiles hide enterprise-only entry points')
      const unused = async (): Promise<never> => { throw new Error('Visibility must not call the connector') }
      const legacyControl = {
        snapshot: () => ({ available: true, groups: [], bindings: [{ botId: 'legacy' as import('../src/types.ts').BotId,
          agentId: 'fixture', robotId: 'fixture', robotName: 'Existing robot', enabled: false, status: 'disabled' as const,
          error: null, allowUsers: [], allowGroups: [], admins: [], credentialsConfigured: true }] }),
        save: unused, verify: unused, toggle: unused, testMessage: unused, createGroup: unused, resumeGroup: unused, attachGroup: unused,
      }
      assert.throws(() => service.attachInfoFlow(legacyControl), /Upgrade Feishu/)
      const detach = service.attachInfoFlow(legacyControl, CONNECTOR_PROTOCOL)
      assert.equal(service.snapshot().infoflowVisible, true, 'Upgrades retain access to saved bindings')
      await service.setInfoflowVisible(false)
      assert.equal(service.snapshot().infoflowVisible, false, 'Explicit choice takes precedence over saved bindings')
      detach()
      const feedAbort = new AbortController()
      const feed = service.follow(feedAbort.signal)[Symbol.asyncIterator]()
      const baseline = await feed.next()
      assert.equal(baseline.done, false)
      if (!baseline.done) assert.equal(baseline.value.type, 'baseline')
      await service.setInfoflowVisible(true)
      const preference = await feed.next()
      assert.equal(preference.value?.value.infoflowVisible, true, 'Visibility reaches connected clients through the native feed')
      await service.setInfoflowVisible(false)
      const architect = await service.createBot({ id: 'architect', name: 'Architect', instructions: 'PERSONA_ARCHITECT {{literal}}' })
      const changed = await feed.next()
      assert.equal(changed.done, false)
      if (!changed.done) assert.equal(changed.value.type, 'changed')
      feedAbort.abort()
      await feed.return?.()
      const critic = await service.createBot({ id: 'critic', name: 'Critic', instructions: 'PERSONA_CRITIC' })
      const dm = service.snapshot().rooms.find(room => room.defaultBot === architect.id)!
      await service.saveMemory({ scope: 'global', ownerId: '*', kind: 'preference', subject: 'response', topic: 'shared-fixture', body: 'GLOBAL_MEMORY_FIXTURE', evidence: 'operator' })
      await service.saveMemory({ scope: 'user', ownerId: 'local:operator', kind: 'preference', subject: 'response', topic: 'private-fixture', body: 'PRIVATE_MEMORY_FIXTURE', evidence: 'operator' })
      await service.send({ roomId: dm.id, text: 'PRIVATE_SECRET' })
      assert.equal((await settled(dm.id)).messages.at(-1)!.status, 'complete')
      assert.ok(JSON.stringify(requests.at(-1)!.messages).includes('PRIVATE_MEMORY_FIXTURE'))
      const room = await service.createGroup({ title: 'Design room', botIds: [architect.id, critic.id], defaultBot: architect.id })
      await service.send({ roomId: room.id, text: '@all first public question' })
      let current = await settled(room.id)
      assert.ok(current.messages.slice(-2).every(message => message.status === 'complete'), JSON.stringify(current))
      assert.equal(requests.length, 3)
      assert.ok(requests.slice(1).every(request => !JSON.stringify(request.messages).includes('PRIVATE_SECRET')))
      assert.ok(requests.slice(1).every(request => !JSON.stringify(request.messages).includes('PRIVATE_MEMORY_FIXTURE')))
      assert.ok(requests.slice(1).every(request => JSON.stringify(request.messages).includes('GLOBAL_MEMORY_FIXTURE')))
      const system = requests.slice(1).map(request => JSON.stringify(request.messages.filter(message => message.role === 'system')))
      assert.ok(system.some(text => text.includes('PERSONA_ARCHITECT {{literal}}')))
      assert.ok(system.some(text => text.includes('PERSONA_CRITIC')))
      const ids = current.members.map(member => member.sessionId)
      await service.send({ roomId: room.id, text: '@critic follow-up' })
      current = await settled(room.id)
      assert.deepEqual(current.members.map(member => member.sessionId), ids)
      assert.ok(JSON.stringify(requests.at(-1)!.messages).includes('first public question'))
      assert.ok(JSON.stringify(requests.at(-1)!.messages).includes('fixture answer'))
      const count = requests.length
      await service.send({ roomId: room.id, text: '@all WAIT_FOR_STOP' })
      while (requests.length < count + 2) await new Promise(resolve => setTimeout(resolve, 10))
      await assert.rejects(service.setMembers({ roomId: room.id, botIds: [critic.id], defaultBot: critic.id }), /active responses/)
      for (const message of service.snapshot().rooms.find(item => item.id === room.id)!.messages.filter(item => item.status === 'running')) {
        await service.stop({ roomId: room.id, messageId: message.id })
      }
      current = await settled(room.id)
      assert.ok(current.messages.slice(-2).every(message => message.status === 'canceled'))
      assert.equal(current.messages.length, 8)
      // Exercise new execution controls against the real Agent waterfall and durable storage.
      const controlled = service.snapshot().rooms.find(item => item.kind === 'dm' && item.defaultBot === critic.id)!
      await service.updateBot({ id: critic.id, name: critic.name, instructions: critic.instructions,
        policy: { provider: 'bot-selected-fixture', model: 'selected-fixture-model', toolMode: 'none', inputPrice: 1, outputPrice: 2 } })
      await service.configureBudget({ tokenLimit: 5, reservationTokens: 5, costLimit: 0, currency: 'USD', reset: true })
      await service.send({ roomId: controlled.id, text: 'CONTROLLED_MODEL' })
      const controlledResult = await settled(controlled.id)
      assert.equal(controlledResult.messages.at(-1)!.status, 'complete', JSON.stringify(controlledResult.messages.at(-1)))
      assert.equal(requests.at(-1)!.model, 'selected-fixture-model')
      assert.equal(service.snapshot().budget!.used.input, 3)
      assert.equal(service.snapshot().budget!.used.output, 2)
      const beforeBlocked = requests.length
      await service.send({ roomId: controlled.id, text: 'BUDGET_BLOCKED' })
      assert.equal((await settled(controlled.id)).messages.at(-1)!.status, 'failed')
      assert.equal(requests.length, beforeBlocked, 'Exhausted budget must block actual adapter calls')
      await service.configureBudget({ tokenLimit: 0, costLimit: 0, currency: 'USD', reset: true })
      await service.updateBot({ id: critic.id, name: critic.name, instructions: critic.instructions, policy: {} })
      assert.ok((await service.exportChat({ roomId: controlled.id, format: 'markdown' })).includes('CONTROLLED_MODEL'))
      await service.lifecycle({ kind: 'room', id: controlled.id, action: 'archive' })
      await assert.rejects(service.send({ roomId: controlled.id, text: 'archived' }), /Restore/)
      await service.lifecycle({ kind: 'room', id: controlled.id, action: 'restore' })
      await service.updateBot({ id: critic.id, name: critic.name, instructions: critic.instructions,
        policy: { provider: 'bot-selected-fixture', model: 'selected-fixture-model', toolMode: 'none' } })
      await service.saveSchedule({ roomId: controlled.id, name: 'Restart reservation', text: 'not enabled',
        targets: [critic.id], nextAt: Date.now() + 3600000, intervalMinutes: 60, enabled: false, allowDelegation: false, notify: false })
      await service.configureBudget({ tokenLimit: 0, costLimit: 0, currency: 'CNY' })
      const historyRoom = await service.ensureExternalRoom({ conversation: { provider: 'infoflow', accountId: 'history-fixture', kind: 'private', id: 'history-user' }, title: 'History segmentation fixture', botIds: [architect.id], defaultBot: architect.id })
      await Reflect.get(service, 'change').call(service, (state: import('../src/types.ts').BotState) => {
        const room = state.rooms.find(room => room.id === historyRoom.id)!
        room.messages = Array.from({ length: 600 }, (_, i) => ({ id: ('history-' + i) as import('../src/types.ts').ChatMessageId, botId: null,
          text: 'ARCHIVE_' + String(i).padStart(3, '0'), replyTo: null, status: 'complete', error: null, time: i,
          external: { id: 'receipt-' + i, sender: { id: 'history-user', name: 'History User' } } }))
      })
      assert.ok(Reflect.get(service, 'domain').global.get().rooms.find((room: import('../src/types.ts').Room) => room.id === historyRoom.id).messages.length <= 256, 'Native storage commits only the archive manifest and bounded tail')
    }
    if (process.env.BOT_TEST_INFOFLOW === '1') await (await import('./infoflow-profile.ts')).exerciseInfoflow(ctx, requests, settled)
    if (process.env.BOT_TEST_PHASE === 'first') {
      const bot = await service.createBot({ id: 'memory-fixture', name: 'Memory fixture', instructions: 'Memory tool roundtrip' })
      const room = service.snapshot().rooms.find(room => room.kind === 'dm' && room.defaultBot === bot.id)!
      await service.send({ roomId: room.id, text: 'MEMORY_PROPOSAL_FIXTURE Remember to use short paragraphs.' })
      const completed = await settled(room.id)
      assert.equal(completed.messages.at(-1)!.status, 'complete', JSON.stringify(completed.messages.at(-1)))
      assert.equal(service.listMemories({ status: 'pending' }).find(item => item.topic === 'paragraphs')?.body, 'Prefer short paragraphs.', 'The native model tool writes a pending memory with owned provenance')
      assert.equal(service.previewMemories({ roomId: room.id, botId: bot.id, userId: 'local:operator', query: 'paragraphs' }).records.some(item => item.topic === 'paragraphs'), false)
      await Reflect.get(service, 'change').call(service, (state: import('../src/types.ts').BotState) => {
        const chat = state.rooms.find(item => item.id === room.id)!
        knowledgeMessageId = 'archived-knowledge-message'
        chat.messages.push(...Array.from({ length: 130 }, (_, i) => ({ id: (i ? `later-knowledge-${i}` : knowledgeMessageId) as import('../src/types.ts').ChatMessageId,
          botId: null, text: i ? 'ordinary old history' : 'ARCHIVE_LOOKUP_FIXTURE release is Friday', replyTo: null, status: 'complete' as const, error: null, time: i })))
      })
      await service.send({ roomId: room.id, text: 'KNOWLEDGE_FIXTURE Search the archived release, read it and recall shared preferences.' })
      const knowledge = (await settled(room.id)).messages.at(-1)!
      assert.equal(knowledge.status, 'complete', JSON.stringify(knowledge))
      assert.deepEqual(knowledge.toolDetails?.map(tool => tool.name), ['search_chat', 'read_chat', 'memory_recall', 'task_status'])
      assert.ok(knowledge.toolDetails?.find(tool => tool.name === 'search_chat')?.result?.includes(knowledgeMessageId), JSON.stringify(knowledge.toolDetails))
      assert.ok(knowledge.toolDetails?.find(tool => tool.name === 'read_chat')?.result?.includes('release is Friday'))
      assert.ok(knowledge.toolDetails?.find(tool => tool.name === 'memory_recall')?.result?.includes('GLOBAL_MEMORY_FIXTURE'))
      const worker = await service.createBot({ id: 'collab-worker', name: 'Worker', instructions: 'Perform delegated work.' })
      const group = await service.createGroup({ title: 'Result join fixture', botIds: [bot.id, worker.id], defaultBot: bot.id })
      await service.send({ roomId: group.id, text: 'COLLAB_FIXTURE Delegate the check, then summarize the returned result.', targets: [bot.id], allowDelegation: true })
      const joined = await settled(group.id), parent = joined.messages[1]!, callback = joined.messages.find(item => item.continuationOf === parent.id)!
      assert.ok(parent.awaiting?.length === 1, JSON.stringify(joined))
      assert.equal(callback?.status, 'complete', JSON.stringify(joined))
      assert.equal(callback.text, 'COLLAB_SUMMARY_DONE')
      assert.equal(joined.messages.find(item => item.id === callback.resultIds?.[0])?.text, 'VERIFIED_CHILD_RESULT')
      assert.equal(joined.messages.filter(item => item.continuationOf).length, 1)
      await service.updateBot({ id: bot.id, name: bot.name, instructions: bot.instructions, policy: { provider: 'bot-fixture', model: 'fixture' } })
      await service.configureKnowledge({ reviewEnabled: true })
      await service.send({ roomId: room.id, text: 'AUTO_MEMORY_FIXTURE 以后请用中文回复。' })
      await settled(room.id)
      await Reflect.get(service, 'change').call(service, (state: import('../src/types.ts').BotState) => {
        for (const review of state.memoryReviews ?? []) review.nextAt = 0
      })
      await Reflect.get(service, 'tick').call(service)
      const reviewDeadline = Date.now() + 10000
      while (!service.knowledgeStatus().reviews.some(item => item.status === 'complete')) {
        if (Date.now() > reviewDeadline) throw new Error('Memory maintenance did not finish: ' + JSON.stringify(service.knowledgeStatus()))
        await new Promise(resolve => setTimeout(resolve, 20))
      }
      assert.equal(service.listMemories({ status: 'pending' }).find(item => item.topic === 'auto-language')?.body, 'Use Chinese for future replies.')
      assert.ok(service.knowledgeStatus().usage.some(item => item.purpose === 'memory' && item.input === 5 && item.output === 4), JSON.stringify(service.knowledgeStatus()))
      const usage = await service.usageReport()
      assert.ok(usage.bots.some(row => row.botId === bot.id && row.memory.input === 5 && row.memory.output === 4))
      assert.ok(usage.budgets.some(row => row.scope === '*' && row.budget.used.input > 0))
      assert.ok(!JSON.stringify(usage).includes('PRIVATE_MEMORY_FIXTURE'), 'Usage reporting exposes totals, not conversation or memory content')
      assert.equal(service.previewMemories({ roomId: room.id, botId: bot.id, userId: 'local:operator', query: '' }).records.some(item => item.topic === 'auto-language'), false)
      await service.configureKnowledge({ reviewEnabled: false })

    }
    if (process.env.BOT_TEST_PHASE === 'first') {
      if (process.env.DSH_BOT_BROWSER_EXECUTABLE) {
        const cookies = new Map<string, string>(), server = createServer((request, response) => {
          cookies.set(request.url!, request.headers.cookie ?? '')
          if (request.url === '/set') response.setHeader('Set-Cookie', 'dsh_bot_isolation=OWNER_COOKIE; Path=/; SameSite=Lax')
          response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Bot browser fixture</title><h1>Isolated browser fixture</h1>')
        })
        server.listen(0, '127.0.0.1'); await once(server, 'listening')
        const address = server.address(); assert.ok(address && typeof address !== 'string'); browserUrl = `http://127.0.0.1:${address.port}/`
        try {
          const a = await service.createBot({ id: 'browser-owner', name: 'Browser owner', instructions: '' }), b = await service.createBot({ id: 'browser-other', name: 'Browser other', instructions: '' })
          await service.saveCapability({ name: 'browser-fixture', kind: 'browser', description: 'Disposable browser fixture', botIds: [a.id, b.id], executablePath: process.env.DSH_BOT_BROWSER_EXECUTABLE })
          const first = await service.openDirect(a.id), second = await service.openDirect(b.id)
          await service.send({ roomId: first.id, text: 'BROWSER_OWNER_FIXTURE Navigate, then WAIT_FOR_STOP.' })
          const deadline = Date.now() + 20000
          while (!cookies.has('/owner-check')) { if (Date.now() > deadline) throw new Error('The real isolated browser did not navigate: ' + JSON.stringify({ observed: [...cookies], room: service.snapshot().rooms.find(room => room.id === first.id), latest: requests.at(-1)?.messages.slice(-3) })); await new Promise(resolve => setTimeout(resolve, 30)) }
          assert.equal(cookies.get('/owner-check'), 'dsh_bot_isolation=OWNER_COOKIE', 'The first browser must actually retain its own cookie')
          await service.send({ roomId: second.id, text: 'BROWSER_OTHER_FIXTURE Navigate independently.' })
          assert.equal((await settled(second.id)).messages.at(-1)!.status, 'complete')
          assert.equal(cookies.get('/other'), '', 'Concurrent Bots must not share cookies')
          const active = service.snapshot().rooms.find(room => room.id === first.id)!.messages.find(message => message.status === 'running')!
          await service.stop({ roomId: first.id, messageId: active.id }); await settled(first.id)
          await service.send({ roomId: first.id, text: 'BROWSER_FRESH_FIXTURE Navigate with a fresh profile.' })
          assert.equal((await settled(first.id)).messages.at(-1)!.status, 'complete')
          assert.equal(cookies.get('/fresh'), '', 'A stopped delivery must not retain its login profile')
        } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
      }
      const mainBot = await service.createBot({ id: 'team-main', name: 'Main Bot', instructions: 'Manage the team only as explicitly requested.' }), mainRoom = await service.openDirect(mainBot.id)
      const specialist = await service.createBot({ id: 'data-specialist', name: '数据伙伴', capabilities: '数据分析、可视化、报表核对', instructions: 'DISCOVERY_PRIVATE_PROMPT_MUST_NOT_LEAK' })
      const countBeforeDiscovery = service.snapshot().bots.length
      await service.send({ roomId: mainRoom.id, text: 'DISCOVERY_FIXTURE 帮我找到能做数据分析的 Bot，有现成的就不要新建。' })
      assert.equal((await settled(mainRoom.id)).messages.at(-1)!.status, 'complete')
      const discoveryRequest = requests.at(-1)!
      const discoveryEvidence = JSON.stringify(discoveryRequest.messages)
      assert.ok(JSON.stringify(discoveryRequest.tools).includes('discover_bots'), 'Normal Bots can discover without Main Bot grants')
      assert.ok(!JSON.stringify(discoveryRequest.tools).includes('team_manage'), 'Discovery does not grant creation')
      assert.ok(discoveryEvidence.includes(specialist.id) && discoveryEvidence.includes('数据分析、可视化、报表核对'), 'The native discovery tool returned the declared capability')
      assert.ok(!discoveryEvidence.includes('DISCOVERY_PRIVATE_PROMPT_MUST_NOT_LEAK'))
      assert.equal(service.snapshot().bots.length, countBeforeDiscovery, 'Recommendation lookup creates no Bot')
      assert.equal(service.teamView().audit.length, 0)
      await service.configureTeam({ revision: 0, botId: mainBot.id, operations: ['create-bot', 'create-group'] })
      await service.send({ roomId: mainRoom.id, text: 'TEAM_FIXTURE Create the requested worker and local team group.' })
      assert.equal((await settled(mainRoom.id)).messages.at(-1)!.status, 'complete')
      assert.equal(service.snapshot().bots.find(bot => bot.id === 'team-worker')?.capabilities, 'Research and evidence gathering.')
      assert.ok(service.snapshot().rooms.some(room => room.title === 'Native team fixture'))
      assert.equal(service.teamView().audit.length, 2)
      const externalTeam = await service.ensureExternalRoom({ conversation: { provider: 'feishu', accountId: mainBot.id, kind: 'private', id: 'team-outsider' }, title: 'External team request', botIds: [mainBot.id], defaultBot: mainBot.id })
      await service.submitExternalMessage({ roomId: externalTeam.id, text: 'TEAM_EXTERNAL_SCOPE_CHECK DISCOVERY_FIXTURE', external: { id: 'team-receipt', sender: { id: 'outsider', name: 'External sender' } } })
      assert.equal((await settled(externalTeam.id)).messages.at(-1)!.status, 'complete')
      assert.ok(!JSON.stringify(requests.at(-1)?.tools).includes('team_manage'))
      assert.ok(!JSON.stringify(requests.at(-1)).includes(specialist.id), 'External private discovery cannot expose a different Bot')
      const unusedIM = async (): Promise<never> => { throw new Error('IM creation must not change connector configuration or send messages') }
      const imHost = await service.createBot({ id: 'im-host', name: 'IM host', instructions: 'Help administrators create specialist Bots.' })
      for (const provider of ['feishu', 'infoflow'] as const) {
        const baseBinding = { botId: imHost.id, enabled: true, status: 'connected' as const, error: null, robotName: 'Fixture', credentialsConfigured: true,
          allowUsers: ['admin', 'guest'], allowGroups: ['im-group'], admins: ['admin'] }
        const detachIM = provider === 'feishu' ? service.attachFeishu({
          snapshot: () => ({ available: true, registrations: [], groups: [], bindings: [{ ...baseBinding, appId: 'im-app', botOpenId: 'ou_bot', brand: 'feishu' }] }),
          save: unusedIM, verify: unusedIM, toggle: unusedIM, register: unusedIM, cancel: unusedIM, createGroup: unusedIM, resumeGroup: unusedIM,
        }, CONNECTOR_PROTOCOL) : service.attachInfoFlow({
          save: unusedIM, verify: unusedIM, toggle: unusedIM, testMessage: unusedIM, createGroup: unusedIM, resumeGroup: unusedIM, attachGroup: unusedIM,
          snapshot: () => ({ available: true, groups: [], bindings: [{ ...baseBinding, agentId: 'im-app', robotId: 'robot' }] }),
        }, CONNECTOR_PROTOCOL)
        try {
          for (const kind of ['private', 'group'] as const) {
            const target = `im-${provider}-${kind}`
            const imRoom = await service.ensureExternalRoom({ conversation: { provider, accountId: 'im-app', kind, id: kind === 'private' ? (provider === 'feishu' ? 'oc_admin_chat' : 'admin') : 'im-group' }, title: 'IM creation fixture', botIds: [imHost.id], defaultBot: imHost.id })
            await service.submitExternalMessage({ roomId: imRoom.id, sourceAccountId: 'im-app', targets: [imHost.id], text: `IM_CREATE_FIXTURE:${target} Create the research Bot.`, external: { id: target, sender: { id: 'admin', name: 'Administrator' } } })
            const reply = (await settled(imRoom.id)).messages.at(-1)!
            assert.equal(reply.status, 'complete', JSON.stringify(reply))
            assert.equal(service.snapshot().bots.find(bot => bot.id === target)?.capabilities, 'Research requested from IM')
            const nativeRequest = requests.at(-1)!
            assert.ok(JSON.stringify(nativeRequest.tools).includes('create_bot'))
            assert.equal(JSON.stringify(nativeRequest.tools).includes('set_group_name'), kind === 'group')
            assert.ok(!JSON.stringify(nativeRequest.tools).includes('team_manage') && !JSON.stringify(nativeRequest.tools).includes('team_list'))
            assert.ok(JSON.stringify(nativeRequest.messages).includes('not-bound') && JSON.stringify(nativeRequest.messages).includes('IM 接入'))
            assert.ok(!JSON.stringify(nativeRequest).includes(specialist.id), 'IM admins cannot browse unrelated Bots')
            assert.ok(!service.snapshot().rooms.some(room => room.external && room.members.some(member => member.botId === target)), 'Creation does not bind or invite the new Bot')
            assert.equal(service.teamView().audit.at(-1)!.actor!.provider, provider)
            assert.equal(service.teamView().audit.at(-1)!.actor!.senderId, 'admin')
            if (kind === 'group') {
              const before = service.snapshot().rooms.find(room => room.id === imRoom.id)!
              const refreshed = await service.ensureExternalRoom({ conversation: { ...before.external!, accountId: 'im-app' }, title: `${provider} 群改名同步`, botIds: [], defaultBot: before.defaultBot })
              assert.equal(refreshed.title, `${provider} 群改名同步`)
              assert.deepEqual(refreshed.members, before.members)
              assert.deepEqual(refreshed.messages, before.messages)
              await service.submitExternalMessage({ roomId: imRoom.id, sourceAccountId: 'im-app', targets: [imHost.id], text: `GROUP_NAME_FIXTURE:${provider} 这个群叫「${provider} 对话补齐群」，帮我补齐到 Web。`, external: { id: `name-${provider}`, sender: { id: 'admin', name: 'Administrator' } } })
              const named = await settled(imRoom.id), namedReply = named.messages.at(-1)!
              assert.equal(namedReply.status, 'complete', JSON.stringify(namedReply))
              assert.equal(named.title, `${provider} 对话补齐群`)
              assert.equal(namedReply.groupNameUpdate?.actor.senderId, 'admin')
              assert.ok(namedReply.toolDetails?.some(item => item.name === 'set_group_name' && item.result?.includes('saved')))
              assert.deepEqual(named.members.map(item => ({ botId: item.botId, sessionId: item.sessionId })), before.members.map(item => ({ botId: item.botId, sessionId: item.sessionId })))
              assert.equal(named.defaultBot, before.defaultBot)
              await service.submitExternalMessage({ roomId: imRoom.id, sourceAccountId: 'im-app', targets: [imHost.id], text: 'Guest checking tools.', external: { id: `guest-group-${provider}`, sender: { id: 'guest', name: 'Guest' } } })
              await settled(imRoom.id)
              assert.ok(!JSON.stringify(requests.at(-1)!.tools).includes('set_group_name'))
              assert.equal(service.snapshot().rooms.find(item => item.id === imRoom.id)!.title, named.title)
            }
          }
          const guestRoom = await service.ensureExternalRoom({ conversation: { provider, accountId: 'im-app', kind: 'private', id: provider === 'feishu' ? 'oc_guest_chat' : 'guest' }, title: 'Non-admin fixture', botIds: [imHost.id], defaultBot: imHost.id })
          await service.submitExternalMessage({ roomId: guestRoom.id, text: 'Please create a Bot.', external: { id: 'guest-receipt', sender: { id: 'guest', name: 'Guest' } } })
          assert.equal((await settled(guestRoom.id)).messages.at(-1)!.status, 'complete')
          assert.ok(!JSON.stringify(requests.at(-1)!.tools).includes('create_bot'))
        } finally { detachIM() }
      }
      assert.equal(service.teamView().audit.length, 6)
      const cardBot = await service.createBot({ id: 'card-bot', name: 'Card Bot', instructions: 'Use native cards.' }), cardRoom = await service.openDirect(cardBot.id)
      await service.send({ roomId: cardRoom.id, text: 'CARD_VIEW_FIXTURE Ask for the next detail.' })
      const cardMessage = (await settled(cardRoom.id)).messages.at(-1)!
      assert.equal(cardMessage.status, 'complete', JSON.stringify(cardMessage))
      assert.equal(cardMessage.cards?.[0]?.content.kind, 'form')
      const submission = { roomId: cardRoom.id, messageId: cardMessage.id, cardId: 'followup', revision: 1, values: { detail: 'NATIVE_FORM_ANSWER' } }
      const submittedId = await service.submitCard(submission)
      assert.equal(await service.submitCard(submission), submittedId)
      assert.equal((await settled(cardRoom.id)).messages.filter(item => item.id === submittedId).length, 1)
      assert.ok(JSON.stringify(requests.at(-1)).includes('NATIVE_FORM_ANSWER'))
      assert.ok((await service.exportChat({ roomId: cardRoom.id, format: 'markdown' })).includes('Native form fixture'))
      const owner = await service.createBot({ id: 'access-owner', name: 'Access owner', instructions: 'Use only granted capabilities.' })
      const outsider = await service.createBot({ id: 'access-outsider', name: 'Access outsider', instructions: 'No capability grants.' })
      const ownerRoom = await service.openDirect(owner.id), otherRoom = await service.openDirect(outsider.id)
      const script = process.env.BOT_TEST_RESULT! + '.mcp.cjs'
      await writeFile(script, `const {createInterface}=require('node:readline');
createInterface({input:process.stdin}).on('line', line=>{
 const request=JSON.parse(line); if(request.id===undefined)return;
 let result=request.method==='initialize'?{protocolVersion:request.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}:
 request.method==='tools/list'?{tools:[{name:'inspect',description:'Inspect the fixture credential transport',inputSchema:{type:'object',properties:{}}}]}:
 request.method==='tools/call'?{content:[{type:'text',text:'transport-ok '+process.env.FIXTURE_TOKEN}]}:{};
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\\n');
});`)
      await service.saveBotCredential({ name: 'FIXTURE_TOKEN', description: 'Scoped fixture', value: 'ONLY_GRANTED_FIXTURE_TOKEN_123', botIds: [owner.id], shellBotIds: [owner.id] })
      await service.saveCapability({ name: 'access-fixture', kind: 'mcp', transport: 'stdio', command: process.execPath, args: [script], env: { FIXTURE_TOKEN: '$DSH_SECRET_FIXTURE_TOKEN' }, description: 'Scoped MCP fixture', botIds: [owner.id] })
      await service.saveCapability({ name: 'fixture-guide', kind: 'skill', content: 'ACCESS_SKILL_BODY Never share private credentials.', description: 'ACCESS_SKILL_DESCRIPTION', botIds: [owner.id] })
      const initial = requests.length
      await service.send({ roomId: ownerRoom.id, text: 'ACCESS_TOOL_FIXTURE inspect the granted transport.' })
      const result = (await settled(ownerRoom.id)).messages.at(-1)!
      assert.equal(result.status, 'complete', JSON.stringify(result))
      assert.ok(result.toolDetails?.some(tool => tool.name === 'mcp__bot_access-fixture__inspect' && tool.result?.includes('transport-ok')), JSON.stringify(result))
      assert.ok(JSON.stringify(requests.slice(initial)).includes('ACCESS_SKILL_DESCRIPTION'), 'Assigned skill must enter only its Bot catalog')
      assert.ok(!JSON.stringify(requests.slice(initial)).includes('ONLY_GRANTED_FIXTURE_TOKEN_123'), 'MCP credential values must be redacted before the next model request')
      assert.ok(!JSON.stringify(result).includes('ONLY_GRANTED_FIXTURE_TOKEN_123'), 'Public transcript cannot retain a returned credential')
      const beforeConcurrent = requests.length
      await service.send({ roomId: ownerRoom.id, text: 'WAIT_FOR_STOP_ACCESS Keep this granted mount active.' })
      const concurrentDeadline = Date.now() + 10000
      while (requests.length === beforeConcurrent) { if (Date.now() > concurrentDeadline) throw new Error('Granted mount did not start'); await new Promise(resolve => setTimeout(resolve, 20)) }
      await service.send({ roomId: otherRoom.id, text: 'ACCESS_ISOLATION_FIXTURE ordinary response.' })
      assert.equal((await settled(otherRoom.id)).messages.at(-1)!.status, 'complete')
      assert.ok(!JSON.stringify(requests.at(-1)).includes('mcp__bot_access-fixture__inspect'))
      assert.ok(!JSON.stringify(requests.at(-1)).includes('ACCESS_SKILL_DESCRIPTION'))
      const ownerMember = service.snapshot().rooms.find(room => room.id === ownerRoom.id)!.members[0]!
      const ownerAgent = ctx.agents.get(ownerMember.sessionId)!, otherAgent = ctx.agents.get(service.snapshot().rooms.find(room => room.id === otherRoom.id)!.members[0]!.sessionId)!
      const shell = Reflect.get(ctx, 'get').call(ctx, 'shellEnv') as { collect(exec: { agent: unknown; arguments: unknown }): Record<string, string> }
      assert.equal(shell.collect({ agent: ownerAgent, arguments: { command: 'echo $DSH_SECRET_FIXTURE_TOKEN' } }).DSH_SECRET_FIXTURE_TOKEN, 'ONLY_GRANTED_FIXTURE_TOKEN_123')
      assert.equal(shell.collect({ agent: ownerAgent, arguments: { command: 'echo $env:DSH_SECRET_FIXTURE_TOKEN' } }).DSH_SECRET_FIXTURE_TOKEN, 'ONLY_GRANTED_FIXTURE_TOKEN_123')
      assert.equal(shell.collect({ agent: ownerAgent, arguments: { command: 'echo no-secret-needed' } }).DSH_SECRET_FIXTURE_TOKEN, undefined)
      assert.equal(shell.collect({ agent: otherAgent, arguments: { command: 'echo $DSH_SECRET_FIXTURE_TOKEN' } }).DSH_SECRET_FIXTURE_TOKEN, undefined)
      const running = service.snapshot().rooms.find(room => room.id === ownerRoom.id)!.messages.find(message => message.status === 'running')!
      await service.stop({ roomId: ownerRoom.id, messageId: running.id }); await settled(ownerRoom.id)
      await service.removeAccess({ kind: 'credential', name: 'FIXTURE_TOKEN', revision: 1 })
      const beforeRevoked = requests.length
      await service.send({ roomId: ownerRoom.id, text: 'ACCESS_REVOKED_FIXTURE' })
      assert.equal((await settled(ownerRoom.id)).messages.at(-1)!.status, 'failed')
      assert.equal(requests.length, beforeRevoked, 'A missing credential blocks MCP activation before a model call')
      await service.saveBotCredential({ name: 'FIXTURE_TOKEN', description: 'Restored scoped fixture', value: 'ONLY_GRANTED_FIXTURE_TOKEN_123', botIds: [owner.id], shellBotIds: [owner.id] })
    } else if (process.env.BOT_TEST_PHASE === 'resume') {
      assert.equal(service.teamView().settings.botId, 'team-main')
      assert.equal(service.teamView().audit.length, 6)
      assert.equal(service.teamView().audit.filter(item => item.actor).length, 4)
      for (const provider of ['feishu', 'infoflow']) assert.equal(service.snapshot().rooms.find(room => room.external?.provider === provider && room.external.id === 'im-group')?.title, `${provider} 对话补齐群`)
      for (const id of ['im-feishu-private', 'im-feishu-group', 'im-infoflow-private', 'im-infoflow-group']) assert.equal(service.snapshot().bots.find(bot => bot.id === id)?.capabilities, 'Research requested from IM')
      const cards = service.snapshot().rooms.find(room => room.defaultBot === 'card-bot')!.messages.flatMap(message => message.cards ?? [])
      assert.equal(cards[0]!.submitted!.values.detail, 'NATIVE_FORM_ANSWER')
      assert.ok((await service.accessCatalog()).credentials.some(item => item.name === 'FIXTURE_TOKEN' && item.configured))
      const room = service.snapshot().rooms.find(room => room.kind === 'dm' && room.defaultBot === 'access-owner')!
      await service.send({ roomId: room.id, text: 'ACCESS_TOOL_FIXTURE after restart.' })
      const result = (await settled(room.id)).messages.at(-1)!
      assert.equal(result.status, 'complete', JSON.stringify(result))
      assert.ok(result.toolDetails?.some(tool => tool.name === 'mcp__bot_access-fixture__inspect'))
    }
    await writeFile(process.env.BOT_TEST_RESULT!, JSON.stringify({ ok: true, requests: requests.length, state: service.snapshot() }))
  } catch (error) {
    await writeFile(process.env.BOT_TEST_RESULT!, JSON.stringify({ ok: false, error: String(error), stack: error instanceof Error ? error.stack : '' }))
  }
}
