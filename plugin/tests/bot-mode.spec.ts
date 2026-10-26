/** Exercise the real owner transactions and execution with controllable native I/O. */
import { expect, it, vi } from 'vitest'
import { Service } from '@deepseek-ai/cordis'
import { BotMode } from '../src/index.ts'
import type { BotState, RoomId, ChatMessageId, BotId } from '../src/types.ts'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
function bench() {
  const state = {
    bots: [{ id: 'sage', name: 'Sage', instructions: 'Be helpful', preset: 'standard' }],
    rooms: [{ id: 'room', title: 'Chat', kind: 'dm', defaultBot: 'sage',
      external: { provider: 'infoflow', accountId: 'app', kind: 'private', id: 'alice' },
      members: [{ botId: 'sage', sessionId: 'session', cursor: 0 }],
      messages: [
        { id: 'user', botId: null, text: 'UNTRUSTED_REQUEST', replyTo: null, status: 'complete', error: null, time: 0 },
        { id: 'attempt', botId: 'sage', text: '', replyTo: 'user', status: 'running', error: null, time: 0 },
      ] }],
  } as BotState
  const set = vi.fn(async (_next: BotState) => {})
  const close = vi.fn(async () => {})
  const assemble = vi.fn(async () => ({ sections: [{ name: 'bot-mode.identity' }] }))
  const followup = vi.fn(), wake = vi.fn()
  const variable = vi.fn(), section = vi.fn()
  const agent = { session: { id: 'session' }, status: 'idle', inbox: { nextTurn: [], nextStep: [] },
    ctx: { systemPrompt: { assemble, variable, section } }, followup, whenIdle: vi.fn(async () => {}), cancel: vi.fn() }
  const ctx = { storageDomain: { open: async () => ({ global: { get: () => state, set }, close }) },
    agents: { get: () => agent }, sessionController: { create: vi.fn(async () => {}) }, sessions: { flush: vi.fn(async () => {}) },
    on: vi.fn((_event: string, _listener: (...args: unknown[]) => void) => () => {}), effect: vi.fn((action: () => unknown) => action()), logger: { error: vi.fn() } }
  // Bypass Cordis registration only; all methods under test are the actual service implementation.
  const service: BotMode = Object.create(BotMode.prototype)
  Object.assign(service, { ctx, state, config: { cwd: '.', historyMessages: 80, maxBots: 8, maxMessages: 1000 },
    domain: { global: { get: () => state, set }, close }, tail: Promise.resolve(), running: new Map(), watchers: new Set([wake]), closing: false, live: new Map(), approvals: new Map(), queues: new Map(), governanceControllers: new Set(), maintenanceDone: new Set(), ownAuxiliary: new WeakSet() })
  const run = { task: Promise.resolve(), canceled: false }
  const execute = () => {
    run.task = Reflect.get(service, 'execute').call(service, 'room', state.rooms[0]!.messages.find(message => message.id === 'attempt')!, run)
    return run.task
  }
  return { service, state, set, close, assemble, followup, wake, ctx, variable, execute, run }
}

it.each(['feishu', 'infoflow'] as const)('syncs %s group names from a receiving app without replacing history or its default Bot', async provider => {
  const b = bench(), room = b.state.rooms[0]!
  room.kind = 'group'
  room.external = { provider, accountId: 'group:existing-group', kind: 'group', id: 'existing-group' }
  room.title = `${provider === 'feishu' ? '飞书' : '如流'} · existing-group`
  const members = structuredClone(room.members), messages = structuredClone(room.messages)
  const request = { conversation: { ...room.external, accountId: 'receiving-app' }, title: '产品讨论群', botIds: [room.defaultBot], defaultBot: room.defaultBot }
  await b.service.ensureExternalRoom({ ...request, conversation: room.external, title: '创建时填写的群名', preserveTitle: true })
  expect(b.service.snapshot().rooms[0]!.title).toBe('创建时填写的群名')
  await b.service.ensureExternalRoom(request)
  expect(b.service.snapshot().rooms[0]!.title).toBe('产品讨论群')
  await b.service.ensureExternalRoom({ ...request, title: '产品讨论二组' })
  expect(b.service.snapshot().rooms[0]).toMatchObject({ id: room.id, title: '产品讨论二组', members, messages, defaultBot: room.defaultBot })
  await b.service.ensureExternalRoom({ ...request, title: room.title })
  expect(b.service.snapshot().rooms[0]!.title).toBe('产品讨论二组')
  await b.service.ensureExternalRoom({ ...request, conversation: room.external, title: '最初建群名称', preserveTitle: true })
  expect(b.service.snapshot().rooms[0]!.title).toBe('产品讨论二组')
  const configured = { title: '最初建群名称', groupId: room.external.id, chatId: room.external.id }
  Reflect.set(b.service, provider, { snapshot: () => ({ available: true, bindings: [], groups: [configured], registrations: [] }) })
  expect((provider === 'feishu' ? b.service.feishuSnapshot() : b.service.infoflowSnapshot()).groups[0]!.title).toBe('产品讨论二组')
  expect(configured.title).toBe('最初建群名称')
})

it('persists a separate public capability description and preserves it when older callers omit it', async () => {
  const b = bench()
  const bot = await b.service.createBot({ id: 'writer', name: 'Writer', instructions: 'PRIVATE_INSTRUCTIONS', capabilities: '  Write product announcements  ' })
  expect(bot.capabilities).toBe('Write product announcements')
  await b.service.updateBot({ id: bot.id, name: 'Writer 2', instructions: 'PRIVATE_INSTRUCTIONS_2' })
  expect(b.service.snapshot().bots.find(item => item.id === bot.id)?.capabilities).toBe('Write product announcements')
  await expect(b.service.updateBot({ id: bot.id, name: 'Bad update', instructions: '', capabilities: 'x'.repeat(501) })).rejects.toThrow('500')
  expect(b.service.snapshot().bots.find(item => item.id === bot.id)?.name).toBe('Writer 2')
  await b.service.updateBot({ id: bot.id, name: 'Writer 2', instructions: 'PRIVATE_INSTRUCTIONS_2', capabilities: '' })
  expect(b.service.snapshot().bots.find(item => item.id === bot.id)?.capabilities).toBe('')
})

it('submits a card atomically and once, queues behind work and keeps external-group forms local', async () => {
  const b = bench(), room = b.state.rooms[0]!, attempt = room.messages[1]!
  room.kind = 'group'; room.external!.kind = 'group'; attempt.status = 'complete'
  attempt.cards = [{ id: 'form', revision: 2, content: { kind: 'form', title: 'Confirm details', submitLabel: 'Continue', fields: [{ name: 'detail', label: 'Detail', type: 'text', required: true }] } }]
  room.messages.push({ ...attempt, cards: undefined, id: 'other-work' as ChatMessageId, status: 'running' })
  const request = { roomId: room.id, messageId: attempt.id, cardId: 'form', revision: 2, values: { detail: 'Chosen by operator' } }
  await expect(b.service.submitCard({ ...request, revision: 1 })).rejects.toThrow('changed')
  b.set.mockRejectedValueOnce(new Error('disk full'))
  await expect(b.service.submitCard(request)).rejects.toThrow('disk full')
  expect(b.service.snapshot().rooms[0]!.messages).toHaveLength(3)
  const ids = await Promise.all([b.service.submitCard(request), b.service.submitCard(request)])
  expect(ids[0]).toBe(ids[1])
  const saved = b.service.snapshot().rooms[0]!
  expect(saved.messages).toHaveLength(5)
  expect(saved.messages.at(-2)).toMatchObject({ id: ids[0], botId: null, replyTo: 'attempt', localOnly: true, allowDelegation: false })
  expect(saved.messages.at(-1)).toMatchObject({ botId: 'sage', status: 'queued', replyTo: ids[0], localOnly: true })
  expect(saved.messages[1]!.cards![0]!.submitted).toMatchObject({ messageId: ids[0], values: request.values })
  await expect(b.service.submitCard({ ...request, values: { detail: 'Different' } })).rejects.toThrow('already')
})

it('applies team commands atomically under current authority and revokes active work when grants change', async () => {
  const b = bench(), room = b.state.rooms[0]!
  delete room.external
  b.state.teamSettings = { revision: 1, botId: 'sage', operations: ['create-bot', 'edit-bot', 'create-group', 'edit-group', 'archive'] }
  Reflect.get(b.service, 'config').defaultPreset = 'standard'
  const manage = (command: import('../src/team-types.ts').TeamCommand, callId: string) => Reflect.get(b.service, 'manageTeam').call(b.service, room.id, 'attempt', 1, command, callId, new AbortController().signal)
  const command = { operation: 'create-bot' as const, id: 'worker', name: 'Worker', instructions: 'Research' }
  b.set.mockRejectedValueOnce(new Error('disk full'))
  await expect(manage(command, 'create')).rejects.toThrow('disk full')
  expect(b.service.snapshot().bots).toHaveLength(1)
  const results = await Promise.all([manage(command, 'create'), manage(command, 'create')])
  expect(results[0]).toEqual(results[1]); expect(b.service.snapshot().bots).toHaveLength(2)
  expect(b.service.teamView().audit).toHaveLength(1)
  await expect(manage({ operation: 'edit-bot', id: 'sage', name: 'New self', instructions: 'Elevate' }, 'self')).rejects.toThrow('itself')
  await manage({ operation: 'edit-bot', id: 'worker', name: 'Researcher', instructions: 'Find evidence' }, 'edit')
  const group = await manage({ operation: 'create-group', title: 'Research', botIds: ['worker'], defaultBot: 'worker' }, 'group')
  await manage({ operation: 'edit-group', id: group.targetId, title: 'Evidence', botIds: ['worker'], defaultBot: 'worker' }, 'group-edit')
  await manage({ operation: 'archive', kind: 'room', id: group.targetId, archived: true }, 'archive')
  expect(b.service.snapshot().rooms.find(item => item.id === group.targetId)).toMatchObject({ title: 'Evidence', archived: true })
  Reflect.get(b.service, 'running').set('attempt', b.run)
  await b.service.configureTeam({ revision: 1, botId: null, operations: [] })
  expect(b.run.canceled).toBe(true)
  await expect(manage({ ...command, id: 'ungranted' }, 'late')).rejects.toThrow('grant')
  await expect(b.service.configureTeam({ revision: 1, botId: 'sage', operations: ['create-bot'] })).rejects.toThrow('changed')
  expect(b.service.snapshot().teamAudit).toBeUndefined()
  expect(b.service.teamView().audit).toHaveLength(5)
})

it('creates IM Bots atomically, deduplicates calls and rejects stale admin authority', async () => {
  const b = bench(), room = b.state.rooms[0]!
  room.messages[0]!.external = { id: 'im-receipt', sender: { id: 'alice', name: 'Alice' } }
  const binding = { botId: 'sage', agentId: 'app', enabled: true, status: 'connected', allowUsers: ['alice'], allowGroups: [], admins: ['alice'] }
  Reflect.set(b.service, 'infoflow', { snapshot: () => ({ bindings: [binding], groups: [] }) })
  Reflect.get(b.service, 'config').defaultPreset = 'standard'
  const actor = { provider: 'infoflow', accountId: 'app', senderId: 'alice' }
  const draft = { id: 'im-worker', name: 'IM worker', instructions: 'PRIVATE_ROLE', capabilities: 'Research' }
  const create = (callId = 'create', signal = new AbortController().signal) => Reflect.get(b.service, 'createIMBot').call(b.service, room.id, 'attempt', actor, draft, callId, signal)
  b.set.mockRejectedValueOnce(new Error('disk full'))
  await expect(create()).rejects.toThrow('disk full')
  expect(b.service.snapshot().bots).toHaveLength(1)
  expect(b.service.teamView().audit).toEqual([])
  const result = await Promise.all([create(), create()])
  expect(result[0]).toEqual(result[1]); expect(result[0]).toMatchObject({ bot: { id: 'im-worker', capabilities: 'Research' }, binding: { status: 'not-bound' } })
  expect(JSON.stringify(result[0])).not.toContain('PRIVATE_ROLE')
  expect(b.service.snapshot().bots).toHaveLength(2)
  expect(b.service.snapshot().rooms.filter(item => item.defaultBot === 'im-worker')).toMatchObject([{ kind: 'dm' }])
  expect(b.service.snapshot().bots[1]).toMatchObject({ preset: 'standard', instructions: 'PRIVATE_ROLE' })
  expect(b.service.snapshot().bots[1]!.policy).toBeUndefined()
  expect(b.service.teamView().audit).toMatchObject([{ actor, operation: 'create-bot', targetId: 'im-worker' }])
  binding.admins = []; await expect(create()).rejects.toThrow('administrator')
  binding.admins = ['alice']; await expect(create('aborted', AbortSignal.abort())).rejects.toThrow()
  expect(b.service.teamView().audit).toHaveLength(1)
})

it.each(['feishu', 'infoflow'] as const)('saves an explicit %s group name atomically and prevents retries overwriting later metadata', async provider => {
  const b = bench(), room = b.state.rooms[0]!
  room.kind = 'group'; room.external = { provider, accountId: 'group:group', kind: 'group', id: 'group' }
  room.messages[0]!.text = '这个群叫「产品讨论群」，补齐到 Web，也提到了另一个名称。'
  room.messages[0]!.external = { id: 'receipt', sender: { id: 'first-receiver-id', name: 'Admin' }, sources: [{ accountId: 'app', senderId: 'admin' }] }
  const binding = { botId: 'sage', appId: 'app', agentId: 'app', enabled: true, status: 'connected', allowGroups: ['group'], admins: ['admin'] }
  Reflect.set(b.service, provider, { snapshot: () => ({ bindings: [binding], groups: [] }) })
  const actor = { provider, accountId: 'app', senderId: 'admin' }
  const save = (title = '产品讨论群', signal = new AbortController().signal) => Reflect.get(b.service, 'setIMGroupName').call(b.service, room.id, 'attempt', actor, title, 'save', signal)
  await expect(save('模型猜测的名称')).rejects.toThrow('explicitly supply')
  b.set.mockRejectedValueOnce(new Error('disk full'))
  await expect(save()).rejects.toThrow('disk full')
  expect(b.service.snapshot().rooms[0]!.title).toBe('Chat')
  expect(b.service.snapshot().rooms[0]!.messages[1]!.groupNameUpdate).toBeUndefined()
  await Promise.all([save(), save()])
  expect(b.service.snapshot().rooms[0]).toMatchObject({ title: '产品讨论群', members: room.members, defaultBot: room.defaultBot })
  expect(b.service.snapshot().rooms[0]!.messages[1]!.groupNameUpdate).toMatchObject({ title: '产品讨论群', actor })
  await expect(save('另一个名称')).rejects.toThrow('already supplied')
  await b.service.ensureExternalRoom({ conversation: { ...room.external, accountId: 'app' }, title: 'IM 后续实际群名', botIds: [], defaultBot: room.defaultBot })
  expect(await save()).toMatchObject({ status: 'already-saved', title: 'IM 后续实际群名' })
  expect(b.service.snapshot().rooms[0]!.title).toBe('IM 后续实际群名')
  binding.admins = []; await expect(save()).rejects.toThrow('administrator')
  binding.admins = ['admin']; await expect(save('产品讨论群', AbortSignal.abort())).rejects.toThrow()
})

it.each(['private', 'local', 'guest', 'cross-app', 'delegated', 'scheduled', 'archived'] as const)('denies group naming for %s requests', async kind => {
  const b = bench(), room = b.state.rooms[0]!, human = room.messages[0]!, delivery = room.messages[1]!
  room.kind = 'group'; room.external = { provider: 'feishu', accountId: 'group:group', kind: 'group', id: 'group' }
  human.text = '这个群叫产品讨论群，补齐到 Web'
  human.external = { id: 'receipt', sender: { id: 'admin', name: 'Admin' }, sources: [{ accountId: 'app', senderId: 'admin' }] }
  Reflect.set(b.service, 'feishu', { snapshot: () => ({ groups: [], bindings: [{ botId: 'sage', appId: 'app', enabled: true, status: 'connected', admins: ['admin'], allowGroups: ['group'] }] }) })
  if (kind === 'private') { room.kind = 'dm'; room.external.kind = 'private' }
  if (kind === 'local') { human.localOnly = true; delivery.localOnly = true }
  if (kind === 'guest') human.external.sources![0]!.senderId = 'guest'
  if (kind === 'cross-app') human.external.sources![0]!.accountId = 'another-app'
  if (kind === 'delegated') delivery.delegation = { rootId: human.id, task: 'Rename' }
  if (kind === 'scheduled') human.scheduleId = 'schedule'
  if (kind === 'archived') room.archived = true
  await expect(Reflect.get(b.service, 'setIMGroupName').call(b.service, room.id, 'attempt', { provider: 'feishu', accountId: 'app', senderId: 'admin' }, '产品讨论群', 'save', new AbortController().signal)).rejects.toThrow()
  expect(b.set).not.toHaveBeenCalled()
})

it('uses native compaction before rotating and retains the current session when it relieves pressure', async () => {
  const b = bench(), agent = b.ctx.agents.get()
  let chars = 120000
  Object.assign(agent.session, { requestContext: () => ({ provider: 'p', model: 'm', contextWindow: 128000 }), deriveMessages: () => [{ text: 'x'.repeat(chars) }] })
  const compactNow = vi.fn(async () => { chars = 3000; return {} })
  Object.assign(agent.ctx, { compaction: { compactNow } })
  await b.execute()
  expect(compactNow).toHaveBeenCalledOnce()
  expect(b.service.snapshot().rooms[0]!.members[0]).toMatchObject({ sessionId: 'session', contextDecisions: [{ action: 'compact', window: 128000 }] })
  expect(b.followup).toHaveBeenCalledOnce()
})

it('accounts native compaction through the public stream seam without double-counting owned auxiliary calls', async () => {
  const b = bench(), bot = b.state.bots[0]!, agent = b.ctx.agents.get()
  bot.policy = { provider: 'p', model: 'm', inputPrice: 1, outputPrice: 2 }
  Object.assign(agent.session, { requestContext: () => ({ provider: 'p', model: 'm' }) })
  const options: GenerateOptions = { provider: 'p', model: 'm', messages: [], purpose: 'compaction', sessionId: 'session' as never }
  const stream = async function* (): AsyncIterable<StreamChunk> { yield { type: 'usage', usage: { inputTokens: 10, cacheReadTokens: 20, outputTokens: 2 } }; yield { type: 'finish', reason: { kind: 'stop' } } }
  const run = async () => { for await (const _chunk of Reflect.get(b.service, 'meterNativeCompaction').call(b.service, options, stream)) {} }
  await run()
  const report = await b.service.usageReport()
  expect(report.ledger!.totals).toMatchObject({ input: 30, output: 2, cacheRead: 20, records: 1 })
  expect(report.bots[0]!.handoff.records).toBe(1)
  expect(report.budgets[0]!.budget.used).toMatchObject({ input: 30, output: 2 })
  Reflect.get(b.service, 'ownAuxiliary').add(options)
  await run()
  expect((await b.service.usageReport()).ledger!.totals.records).toBe(1)
  expect(b.service.snapshot().usageLedger).toBeUndefined()
})

it('forgetting scoped memory leaves unrelated runs and membership generations intact', async () => {
  const b = bench()
  const bot = await b.service.createBot({ id: 'other', name: 'Other', instructions: '' })
  const otherRoom = b.service.snapshot().rooms.find(room => room.defaultBot === bot.id)!
  const affected = { task: Promise.resolve(), canceled: false, agent: { cancel: vi.fn() } }
  const unrelated = { task: Promise.resolve(), canceled: false, agent: { cancel: vi.fn() } }
  Reflect.get(b.service, 'running').set('attempt', affected)
  await Reflect.get(b.service, 'change').call(b.service, (state: BotState) => {
    state.rooms.find(room => room.id === otherRoom.id)!.messages.push({ id: 'other-attempt' as ChatMessageId, botId: bot.id, text: '', replyTo: null, status: 'running', time: 0, error: null })
  })
  Reflect.get(b.service, 'running').set('other-attempt', unrelated)
  const memory = await b.service.saveMemory({ scope: 'bot', ownerId: 'sage', kind: 'preference', subject: 'reply', topic: 'style', body: 'Be concise', evidence: '' })
  await b.service.memoryAction({ id: memory.id, revision: 1, action: 'forget' })
  expect(affected.canceled).toBe(true)
  expect(unrelated.canceled).toBe(false)
  const snapshot = b.service.snapshot()
  expect(snapshot.rooms[0]!.members[0]!.requiredMemoryEpoch).toBe(1)
  expect(snapshot.rooms.find(room => room.id === otherRoom.id)!.members[0]!.requiredMemoryEpoch).toBeUndefined()
})

it('commits memory atomically, excludes it from ordinary feeds and loads it into durable Session input', async () => {
  const b = bench()
  const item = await b.service.saveMemory({ scope: 'global', ownerId: '*', kind: 'preference', subject: 'response', topic: 'format', body: 'MEMORY_GLOBAL_BULLETS', evidence: '' })
  expect(b.set.mock.calls.at(-1)![0].memories).toContainEqual(item)
  expect(b.service.snapshot().memories).toBeUndefined()
  expect(Reflect.get(b.service, 'clientSnapshot').call(b.service).memories).toBeUndefined()
  await b.execute()
  expect(b.followup.mock.calls[0]![0].content[0].text).toContain('MEMORY_GLOBAL_BULLETS')
  expect(b.followup.mock.calls[0]![0].content[0].text).toContain(item.id)
  expect((await b.service.contextView({ roomId: 'room' as RoomId, messageId: 'attempt' as ChatMessageId })).memories[0]).toMatchObject({ id: item.id, body: 'MEMORY_GLOBAL_BULLETS', revision: 1 })
  b.set.mockRejectedValueOnce(new Error('disk full'))
  await expect(b.service.memoryAction({ id: item.id, revision: 1, action: 'forget' })).rejects.toThrow('disk full')
  expect(b.service.listMemories({})[0]!.status).toBe('active')
  await b.service.memoryAction({ id: item.id, revision: 1, action: 'forget' })
  expect(b.service.listMemories({})).toEqual([])
  expect((await b.service.contextView({ roomId: 'room' as RoomId, messageId: 'attempt' as ChatMessageId })).memories[0]).toMatchObject({ id: item.id, body: '', status: 'forgotten' })
})

it('rejects the second of concurrent stale memory updates', async () => {
  const b = bench()
  const request = { scope: 'global' as const, ownerId: '*', kind: 'preference' as const, subject: 'response', topic: 'format', body: 'First', evidence: '' }
  const item = await b.service.saveMemory(request)
  const results = await Promise.allSettled(['Second', 'Third'].map(body => b.service.saveMemory({ ...request, body, id: item.id, revision: item.revision })))
  expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
  expect(b.service.listMemories({ status: 'active' }).map(item => item.body)).toEqual(['Second'])
})

it('does not write or notify subscribers when external admission is busy or the room is unchanged', async () => {
  const b = bench()
  const room = b.state.rooms[0]!
  await b.service.ensureExternalRoom({ conversation: room.external!, title: room.title, botIds: [room.defaultBot], defaultBot: room.defaultBot })
  for (let i = 0; i < 5; i++) expect(await b.service.submitExternalMessage({ roomId: room.id,
    text: 'queued', external: { id: 'queued', sender: { id: 'alice', name: 'Alice' } } })).toEqual({ status: 'busy' })
  expect(b.set).not.toHaveBeenCalled()
  expect(b.wake).not.toHaveBeenCalled()
})

it('never submits a turn canceled while system prompt assembly is pending', async () => {
  const b = bench(), gate = deferred(), entered = deferred()
  b.assemble.mockImplementationOnce(async () => { entered.resolve(); await gate.promise; return { sections: [{ name: 'bot-mode.identity' }] } })
  Reflect.get(b.service, 'running').set('attempt', b.run)
  const execution = b.execute()
  await entered.promise
  const stopped = b.service.stop({ roomId: 'room' as RoomId, messageId: 'attempt' as ChatMessageId })
  gate.resolve()
  await execution; await stopped
  expect(b.followup).not.toHaveBeenCalled()
  expect(b.service.snapshot().rooms[0]!.messages[1]!.status).toBe('canceled')
})

it('releases the room and notifies readers even when all settlement writes fail', async () => {
  const b = bench()
  b.set.mockRejectedValue(new Error('disk full'))
  await b.execute().catch(() => {})
  const message = b.service.snapshot().rooms[0]!.messages[1]!
  expect(message.status).toBe('failed')
  expect(message.error).toMatch(/persist|storage/i)
  expect(b.wake).toHaveBeenCalled()
  b.set.mockResolvedValue()
  await expect(b.service.submitExternalMessage({ roomId: 'room' as RoomId, text: ' ',
    external: { id: 'new', sender: { id: 'alice', name: 'Alice' } } })).resolves.toMatchObject({ status: 'rejected' })
})

it('keeps the current human request out of system identity', () => {
  const b = bench()
  Reflect.get(b.service, 'installIdentity').call(b.service, b.ctx.agents.get())
  const identity = b.variable.mock.calls[0]![1] as () => string
  expect(identity()).not.toContain('UNTRUSTED_REQUEST')
})

it('keeps a deleted chat’s retained native Session usable without stale group routing', async () => {
  const b = bench()
  b.state.rooms[0]!.messages[1]!.status = 'complete'
  Reflect.get(b.service, 'installIdentity').call(b.service, b.ctx.agents.get())
  const identity = b.variable.mock.calls[0]![1] as () => string
  await b.service.lifecycle({ kind: 'room', id: 'room', action: 'delete' })
  expect(identity()).toContain('deleted')
  expect(identity()).not.toContain('Be helpful')
})

it('drains an already-started scheduler operation before closing storage', async () => {
  const b = bench(), gate = deferred()
  await Reflect.get(b.service, Service.init).call(b.service)
  Reflect.set(b.service, 'schedulerTask', gate.promise)
  const cleanup = b.ctx.effect.mock.results.at(-1)!.value as () => Promise<void>
  const closing = cleanup()
  await Promise.resolve(); expect(b.close).not.toHaveBeenCalled()
  gate.resolve(); await closing
  expect(b.close).toHaveBeenCalledOnce()
})

it('keeps the unread cursor before a running sibling when a delegated response is consumed', async () => {
  const b = bench(), room = b.state.rooms[0]!
  const root = room.messages[0]!, attempt = room.messages[1]!
  const sibling = { ...attempt, id: 'sibling' as ChatMessageId, botId: 'other' as typeof attempt.botId }
  const parent = { ...sibling, id: 'parent' as ChatMessageId, status: 'complete' as const, text: '@sage review' }
  attempt.replyTo = parent.id
  attempt.delegation = { rootId: root.id, task: 'review' }
  room.messages = [root, sibling, parent, attempt]
  Reflect.set(b.service, 'delegationRoster', () => b.state.bots)
  b.followup.mockImplementation(input => {
    const listener = b.ctx.on.mock.calls.find(call => call[0] === 'session/event')![1] as (...args: unknown[]) => void
    listener(b.ctx.agents.get().session, { type: 'agent/inbox/spliced', data: { inserted: [input] } })
  })
  await b.execute()
  expect(b.service.snapshot().rooms[0]!.members[0]!.cursor).toBe(1)
  expect(b.followup.mock.calls[0]![0].content[0].text.match(/UNTRUSTED_REQUEST/g)).toHaveLength(1)
})

it('closes the opened domain when startup persistence fails', async () => {
  const b = bench()
  b.set.mockRejectedValue(new Error('disk full'))
  await expect(Reflect.get(b.service, Service.init).call(b.service)).rejects.toThrow('disk full')
  expect(b.close).toHaveBeenCalledOnce()
})

it('durably queues local input, cancels one queued attempt, and drains the next request only after the active turn', async () => {
  const b = bench(), room = b.state.rooms[0]!
  delete room.external
  const launch = vi.fn(); Reflect.set(b.service, 'launch', launch)
  const first = await b.service.send({ roomId: room.id, text: 'queued one' })
  const second = await b.service.send({ roomId: room.id, text: 'queued two' })
  expect(launch).not.toHaveBeenCalled()
  const queued = b.service.snapshot().rooms[0]!.messages.find(message => message.replyTo === first.id)!
  expect(queued.status).toBe('queued')
  await b.service.stop({ roomId: room.id, messageId: queued.id })
  const state = Reflect.get(b.service, 'state') as BotState
  state.rooms[0]!.messages.find(message => message.id === 'attempt')!.status = 'complete'
  await Reflect.get(b.service, 'drain').call(b.service, room.id)
  expect(launch).toHaveBeenCalledOnce()
  expect(launch.mock.calls[0]![1]).toMatchObject({ replyTo: second.id, status: 'running' })
  expect(b.service.snapshot().rooms[0]!.messages.find(message => message.id === queued.id)!.status).toBe('canceled')
})

it('enables bounded web group handoffs only when explicitly selected', async () => {
  const b = bench(), room = b.state.rooms[0]!
  delete room.external; room.kind = 'group'; room.messages = []
  b.state.bots.push({ ...b.state.bots[0]!, id: 'worker' as BotId })
  room.members.push({ ...room.members[0]!, botId: 'worker' as BotId, sessionId: 'worker-session' as typeof room.members[0]['sessionId'] })
  Reflect.set(b.service, 'launch', vi.fn())
  await b.service.send({ roomId: room.id, text: 'delegate review', allowDelegation: true })
  expect(b.service.snapshot().rooms[0]!.messages[0]!.allowDelegation).toBe(true)
  expect(Reflect.get(b.service, 'delegationRoster').call(b.service, room)).toHaveLength(2)
})

it('paginates and searches full history while the browser feed stays bounded, and exports older records', async () => {
  const b = bench(), room = b.state.rooms[0]!
  room.messages = Array.from({ length: 150 }, (_, i) => ({ ...room.messages[0]!, id: `m${i}` as ChatMessageId, text: i % 10 ? 'other' : `needle ${i}`, time: i }))
  const page = await b.service.history({ roomId: room.id, limit: 10, query: 'needle' })
  expect(page.total).toBe(15); expect(page.messages[0]!.text).toBe('needle 50')
  expect((await b.service.history({ roomId: room.id, query: 'needle', before: page.before!, limit: 10 })).messages).toHaveLength(5)
  const controller = new AbortController(), feed = b.service.follow(controller.signal)[Symbol.asyncIterator]()
  const frame = await feed.next()
  expect(frame.value.value.rooms[0].messages).toHaveLength(50)
  expect(await b.service.exportChat({ roomId: room.id, format: 'json' })).toContain('needle 0')
  controller.abort(); await feed.return?.()
})

it('archives without destroying history and blocks new external work until restored', async () => {
  const b = bench(), room = b.state.rooms[0]!
  room.messages[1]!.status = 'complete'
  await b.service.lifecycle({ kind: 'room', id: room.id, action: 'archive' })
  await expect(b.service.submitExternalMessage({ roomId: room.id, text: 'hello', external: { id: 'next', sender: { id: 'alice', name: '' } } })).rejects.toThrow('archived')
  expect(b.service.snapshot().rooms[0]!.messages).toHaveLength(2)
  await b.service.lifecycle({ kind: 'room', id: room.id, action: 'restore' })
  expect(b.service.snapshot().rooms[0]!.archived).toBe(false)
  await b.service.lifecycle({ kind: 'room', id: room.id, action: 'delete' })
  expect(b.service.snapshot().rooms[0]!.deleted).toBe(true)
})

it('claims a schedule once atomically with its prompt and coalesces missed intervals', async () => {
  const b = bench(), room = b.state.rooms[0]!
  delete room.external; room.messages = []
  const launch = vi.fn(); Reflect.set(b.service, 'launch', launch)
  const schedule = await b.service.saveSchedule({ roomId: room.id, name: 'Check', text: 'check status', targets: [room.defaultBot], nextAt: 1, intervalMinutes: 10, enabled: true, allowDelegation: false, notify: false })
  await Reflect.get(b.service, 'tick').call(b.service)
  await Reflect.get(b.service, 'tick').call(b.service)
  expect(launch).toHaveBeenCalledOnce()
  expect(b.service.snapshot().rooms[0]!.messages[0]!.scheduleId).toBe(schedule.id)
  expect(b.service.snapshot().schedules![0]!.nextAt).toBeGreaterThan(Date.now())
})

it('keeps active group members usable when another Bot is archived', async () => {
  const b = bench(), room = b.state.rooms[0]!
  room.kind = 'group'; room.messages = []
  room.external = { provider: 'infoflow', accountId: 'app', kind: 'group', id: 'group' }
  const worker = { ...b.state.bots[0]!, id: 'worker' as BotId }
  b.state.bots.push(worker)
  room.members.push({ botId: worker.id, sessionId: 'worker-session' as typeof room.members[0]['sessionId'], cursor: 0 })
  const launch = vi.fn(); Reflect.set(b.service, 'launch', launch)
  await b.service.lifecycle({ kind: 'bot', id: 'sage', action: 'archive' })
  await b.service.ensureExternalRoom({ conversation: room.external, title: 'Group', botIds: [worker.id], defaultBot: worker.id })
  await b.service.send({ roomId: room.id, text: '@all still work' })
  expect(launch).toHaveBeenCalledOnce()
  expect(launch.mock.calls[0]![1].botId).toBe(worker.id)
})

it('does not execute a scheduled occurrence when its atomic reservation fails', async () => {
  const b = bench(), room = b.state.rooms[0]!
  delete room.external; room.messages = []
  const launch = vi.fn(); Reflect.set(b.service, 'launch', launch)
  await b.service.saveSchedule({ roomId: room.id, name: 'Once', text: 'work', targets: [room.defaultBot], nextAt: 1, intervalMinutes: 0, enabled: true, allowDelegation: false, notify: false })
  b.set.mockRejectedValue(new Error('disk full'))
  await expect(Reflect.get(b.service, 'tick').call(b.service)).rejects.toThrow('disk full')
  expect(launch).not.toHaveBeenCalled()
  expect(b.service.snapshot().schedules![0]!.enabled).toBe(true)
  expect(b.service.snapshot().rooms[0]!.messages).toHaveLength(0)
})

it('enforces model selection, tool restrictions and exhausted budgets at native execution seams', async () => {
  const b = bench(), agent = b.ctx.agents.get()
  b.state.bots[0]!.policy = { provider: 'fixture', model: 'selected', toolMode: 'allow', tools: ['read_file'] }
  const listeners = new Map<string, Function>(), guard = vi.fn((_guard: (exec: { name: string }) => string | undefined) => () => {})
  Object.assign(agent.ctx, { tools: { guard }, on: (event: string, listener: Function) => { listeners.set(event, listener); return () => {} } })
  b.followup.mockImplementation(() => {})
  await b.execute()
  const hook = listeners.get('agent/request')!
  expect(await hook({}, async () => ({ provider: 'default', model: 'other' }))).toMatchObject({ provider: 'fixture', model: 'selected' })
  const policy = guard.mock.calls[0]![0] as unknown as (exec: { name: string }) => string | undefined
  expect(policy({ name: 'read_file' })).toBeUndefined()
  expect(policy({ name: 'shell' })).toContain('Blocked')
  const state = Reflect.get(b.service, 'state') as BotState
  state.budget = { tokenLimit: 10, costLimit: 0, currency: 'USD', since: 0, used: { input: 10, output: 0, cost: 0 } }
  await expect(hook({}, async () => ({}))).rejects.toThrow('exhausted')
})

it('requires native sandbox enforcement and never broadens an existing read-only session', async () => {
  const missing = bench()
  missing.state.bots[0]!.policy = { fileMode: 'read-only' }
  await missing.execute()
  expect(missing.followup).not.toHaveBeenCalled()
  expect(missing.service.snapshot().rooms[0]!.messages[1]!.error).toContain('sandbox policy')

  const b = bench(), agent = b.ctx.agents.get()
  b.state.bots[0]!.policy = { fileMode: 'workspace-write' }
  let mode = 'read-only'
  Object.assign(agent.ctx, { sandboxPolicy: { resolve: () => ({ mode }) } })
  Object.assign(agent.session, { append: (_event: string, value: { mode: string }) => { mode = value.mode } })
  b.followup.mockImplementation(() => expect(mode).toBe('read-only'))
  await b.execute()
  expect(b.followup).toHaveBeenCalledOnce()
  expect(mode).toBe('read-only')
})

it('preserves a new native sandbox choice made while the Bot runs', async () => {
  const b = bench(), agent = b.ctx.agents.get()
  b.state.bots[0]!.policy = { fileMode: 'workspace-write' }
  let mode = 'danger-full-access', listener: Function | undefined
  Object.assign(agent.ctx, { sandboxPolicy: { resolve: () => ({ mode }) },
    on: (event: string, fn: Function) => { if (event === 'session/event') listener = fn; return () => {} } })
  Object.assign(agent.session, { append: (type: string, data: { mode: string }) => { mode = data.mode; listener?.(agent.session, { type, data }) } })
  b.followup.mockImplementation(() => {
    expect(mode).toBe('workspace-write')
    Reflect.get(agent.session, 'append')('sandbox/mode', { mode: 'read-only' })
  })
  await b.execute()
  expect(mode).toBe('read-only')
})

it('allows an approval once, rejects stale decisions, and cancels signal-less approvals on stop', async () => {
  const b = bench(), agent = b.ctx.agents.get(), entered = deferred(), end = deferred()
  const listeners = new Map<string, Function>()
  Object.assign(agent.ctx, { on: (event: string, listener: Function) => { listeners.set(event, listener); return () => {} } })
  agent.whenIdle.mockImplementation(async () => { entered.resolve(); await end.promise })
  Reflect.get(b.service, 'running').set('attempt', b.run)
  const execution = b.execute(); await entered.promise
  const hook = listeners.get('approval/request')!, next = vi.fn()
  const question = hook({ agent, toolName: 'write_file', reason: 'write requested' }, next)
  const firstId = [...(Reflect.get(b.service, 'approvals') as Map<string, unknown>).keys()][0]!
  b.service.decideApproval({ roomId: 'room' as RoomId, id: firstId, allow: true })
  expect(await question).toBe('allowed-once')
  expect(() => b.service.decideApproval({ roomId: 'room' as RoomId, id: firstId, allow: true })).toThrow('no longer')
  const second = hook({ agent, toolName: 'write_file' }, next)
  const stop = b.service.stop({ roomId: 'room' as RoomId, messageId: 'attempt' as ChatMessageId })
  expect(await second).toBe('cancelled')
  end.resolve(); await stop; await execution
  expect(next).not.toHaveBeenCalled()
})

it('reserves quota atomically across concurrent rooms and preserves it across failed writes', async () => {
  const b = bench()
  await b.service.configureBudget({ tokenLimit: 12, costLimit: 0, currency: 'USD', reservationTokens: 8 })
  const reserve = (id: string) => Reflect.get(b.service, 'reserveCall').call(b.service, id, b.state.bots[0])
  const results = await Promise.allSettled([reserve('first'), reserve('second')])
  expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
  expect(Object.keys(b.service.snapshot().budgetReservations!)).toEqual(['first'])
  b.set.mockRejectedValueOnce(new Error('disk full'))
  await expect(b.service.configureBudget({ tokenLimit: 100, costLimit: 0, currency: 'USD' })).rejects.toThrow('disk full')
  expect(b.service.snapshot().budget!.tokenLimit).toBe(12)
})

it('returns attachment bytes only for the referenced room message', async () => {
  const b = bench(), read = vi.fn(async () => ({ data: Buffer.from('png') }))
  const item = { type: 'image' as const, attachment: { attachmentId: 'sha256:' + 'a'.repeat(64), name: 'image.png', bytes: 3 } }
  b.state.rooms[0]!.messages[0]!.attachments = [item]
  Object.assign(b.ctx, { attachments: { readImage: read } })
  expect(await b.service.attachment({ roomId: 'room' as RoomId, messageId: 'user' as ChatMessageId, attachmentId: item.attachment.attachmentId })).toMatchObject({ name: 'image.png', base64: Buffer.from('png').toString('base64') })
  await expect(b.service.attachment({ roomId: 'room' as RoomId, messageId: 'attempt' as ChatMessageId, attachmentId: item.attachment.attachmentId })).rejects.toThrow('not part')
  expect(read).toHaveBeenCalledOnce()
})

it('answers inline questions, validates choices, and cancels outstanding questions on stop', async () => {
  const b = bench(), agent = b.ctx.agents.get(), entered = deferred(), end = deferred()
  const listeners = new Map<string, Function>()
  Object.assign(agent.ctx, { on: (event: string, listener: Function) => { listeners.set(event, listener); return () => {} } })
  agent.whenIdle.mockImplementation(async () => { entered.resolve(); await end.promise })
  Reflect.get(b.service, 'running').set('attempt', b.run)
  const execution = b.execute(); await entered.promise
  const hook = listeners.get('user-questions/request')!, next = vi.fn()
  const answer = hook({ agent, questions: [{ id: 'choice', question: 'Proceed?', options: [{ label: 'Yes' }, { label: 'No' }] }] }, next)
  const id = [...(Reflect.get(b.service, 'questions') as Map<string, unknown>).keys()][0]!
  await expect(b.service.answerQuestion({ roomId: 'room' as RoomId, id, answer: { answers: [{ id: 'choice', selected: ['invalid'] }] } })).rejects.toThrow('Invalid')
  await b.service.answerQuestion({ roomId: 'room' as RoomId, id, answer: { answers: [{ id: 'choice', selected: ['Yes'] }] } })
  expect(await answer).toEqual({ answers: [{ id: 'choice', selected: ['Yes'] }] })
  const second = hook({ agent, questions: [{ id: 'free', question: 'Details?' }] }, next).catch((error: Error) => error.message)
  const stopping = b.service.stop({ roomId: 'room' as RoomId, messageId: 'attempt' as ChatMessageId })
  expect(await second).toContain('canceled')
  end.resolve(); await stopping; await execution
})

it('resumes an expired native question once through an owned response without replaying the earlier turn', async () => {
  const b = bench(), room = b.state.rooms[0]!
  room.messages[1]!.status = 'complete'
  room.messages[1]!.questions = [{ id: 'pending', callId: 'tool-call', questions: [{ id: 'q', question: 'Details?' }] }]
  const launch = vi.fn(); Reflect.set(b.service, 'launch', launch)
  await b.service.answerQuestion({ roomId: room.id, id: 'pending', answer: { answers: [{ id: 'q', selected: [], custom: 'details' }] } })
  expect(launch).toHaveBeenCalledOnce()
  expect(b.service.snapshot().rooms[0]!.messages.at(-2)!.questionReply?.callId).toBe('tool-call')
  await expect(b.service.answerQuestion({ roomId: room.id, id: 'pending', answer: { answers: [] } })).rejects.toThrow('no longer')
})


it('releases a stalled native Session creation at the deadline and never submits late input', async () => {
  vi.useFakeTimers()
  const b = bench(), gate = deferred()
  Reflect.set(Reflect.get(b.service, 'config'), 'idleTimeoutMs', 1000)
  b.ctx.sessionController.create.mockImplementationOnce(() => gate.promise)
  try {
    const execution = b.execute()
    await vi.advanceTimersByTimeAsync(1250); await execution
    expect(b.service.snapshot().rooms[0]!.messages[1]).toMatchObject({ status: 'failed', error: expect.stringContaining('No execution progress') })
    gate.resolve(); await Promise.resolve()
    expect(b.followup).not.toHaveBeenCalled()
  } finally { vi.useRealTimers() }
})

it('uses a fresh Session without an old memory handoff after access is revoked', async () => {
  const b = bench(), room = b.state.rooms[0]!, oldAgent = b.ctx.agents.get()
  Reflect.set(b.state, 'memoryEpoch', 1)
  const sessions = new Map<string, typeof oldAgent>([['session', oldAgent]])
  Object.assign(b.ctx.agents, { get: (id: string) => sessions.get(id) })
  b.ctx.sessionController.create.mockImplementation(async (...args: unknown[]) => {
    const id = (args[0] as { sessionId: string }).sessionId
    sessions.set(id, { ...oldAgent, session: { id } })
  })
  const next = await Reflect.get(b.service, 'prepareContext').call(b.service, room, room.members[0], b.state.bots[0], oldAgent, room.messages[1], new AbortController().signal)
  const member = b.service.snapshot().rooms[0]!.members[0]!
  expect(member.sessionId).not.toBe('session'); expect(next.session.id).toBe(member.sessionId)
  expect(member).toMatchObject({ memoryEpoch: 1, cursor: room.messages.length, segments: [{ sessionId: 'session', reason: 'memory-access-changed' }] })
  expect(member.handoff).toBeUndefined()
})


it('claims a pending memory review once when maintenance wakes overlap', async () => {
  const b = bench(), agent = b.ctx.agents.get()
  b.state.rooms[0]!.messages[1]!.status = 'complete'
  b.state.memoryReviews = [{ id: 'review', roomId: 'room', messageId: 'user', botId: 'sage', status: 'pending', attempts: 0, nextAt: 0, createdAt: 0 }]
  b.state.bots[0]!.policy = { provider: 'fixture', model: 'fixture' }
  let calls = 0
  Object.assign(agent.ctx, { llm: { async *stream() {
    calls++; yield { type: 'text-delta', text: '{"candidates":[]}' }
    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  } } })
  const review = () => Reflect.get(b.service, 'reviewNext').call(b.service)
  await Promise.all([review(), review()])
  expect(calls).toBe(1)
  expect(b.service.knowledgeStatus().reviews[0]).toMatchObject({ status: 'complete', attempts: 1 })
  expect(b.service.knowledgeStatus().usage[0]).toMatchObject({ calls: 1, input: 1, output: 1 })
})

it('releases idle archived bodies, reads old pages on demand and retains historic receipt and identity isolation', async () => {
  const b = bench(), { HistoryStore } = await import('../src/history-store.ts'), docs = new Map<string, unknown>()
  Reflect.set(b.service, 'historyStore', new HistoryStore(async spec => ({ global: {
    get: () => spec.global.schema.parse(docs.get(spec.name) ?? []), set: async (value: unknown) => { docs.set(spec.name, structuredClone(value)) },
  }, close: async () => {} }) as never))
  const room = b.state.rooms[0]!
  room.messages = Array.from({ length: 600 }, (_, i) => ({ id: ('old-' + i) as ChatMessageId, botId: null, text: 'archive ' + i,
    external: { id: 'receipt-' + i, sender: { id: i === 0 ? 'historic-user' : 'recent-user', name: 'User' } }, replyTo: null, status: 'complete', error: null, time: i }))
  await b.service.setInfoflowVisible(false)
  expect(b.service.snapshot().rooms[0]!.messages.length).toBeLessThanOrEqual(256)
  expect(b.service.snapshot().rooms[0]!.messageCount).toBe(600)
  expect(b.service.memoryCatalog().users.some(user => user.id.includes('historic-user'))).toBe(true)
  expect((await b.service.history({ roomId: room.id, query: 'archive 0' })).messages.map(message => message.id)).toEqual(['old-0'])
  expect(await b.service.submitExternalMessage({ roomId: room.id, text: 'archive 0', external: { id: 'receipt-0', sender: { id: 'historic-user', name: 'User' } } })).toMatchObject({ status: 'accepted', messageId: 'old-0', attemptIds: [] })
  expect(b.followup).not.toHaveBeenCalled()
  expect(b.service.snapshot().rooms[0]!.messages.length).toBeLessThanOrEqual(256)
  expect((await b.service.connectorNotifications(room.id, 600)).offset).toBeGreaterThan(0)
  expect((await b.service.connectorNotifications(room.id, 0)).room.messages).toHaveLength(600)
})

it('stores credential values only in native records and rolls back failed/stale grant changes without exposing or replacing the active value', async () => {
  const b = bench(), values = new Map<string, { kind: 'api-key'; key: string }>()
  Object.assign(b.ctx, { credentials: {
    modifyRecord: async (key: string, mutate: () => Promise<{ kind: 'api-key'; key: string }>) => { values.set(key, await mutate()) },
    deleteRecord: async (key: string) => { values.delete(key) }, describeRecord: async (key: string) => ({ configured: values.has(key) }),
  } })
  await b.service.saveBotCredential({ name: 'API_TOKEN', value: 'INITIAL_PRIVATE_CREDENTIAL', description: 'Fixture', botIds: ['sage'], shellBotIds: [] })
  expect(values.size).toBe(1)
  expect(JSON.stringify(b.service.snapshot())).not.toContain('PRIVATE_CREDENTIAL')
  expect(JSON.stringify(await b.service.accessCatalog())).not.toContain('bot-mode/')
  expect(JSON.stringify(b.set.mock.calls)).not.toContain('INITIAL_PRIVATE_CREDENTIAL')
  b.set.mockRejectedValueOnce(new Error('disk full'))
  await expect(b.service.saveBotCredential({ name: 'API_TOKEN', revision: 1, value: 'NEW_PRIVATE_CREDENTIAL', description: '', botIds: ['sage'], shellBotIds: [] })).rejects.toThrow('disk full')
  expect([...values.values()].map(item => item.key)).toEqual(['INITIAL_PRIVATE_CREDENTIAL'])
  expect((await b.service.accessCatalog()).credentials[0]!.revision).toBe(1)
  await b.service.saveBotCredential({ name: 'API_TOKEN', revision: 1, description: '', botIds: [], shellBotIds: [] })
  expect((await b.service.accessCatalog()).credentials[0]!.botIds).toEqual([])
  await expect(b.service.saveBotCredential({ name: 'API_TOKEN', revision: 1, value: 'STALE_PRIVATE_CREDENTIAL', description: '', botIds: ['sage'], shellBotIds: [] })).rejects.toThrow('changed')
  expect([...values.values()].map(item => item.key)).toEqual(['INITIAL_PRIVATE_CREDENTIAL'])
  await b.service.removeAccess({ name: 'API_TOKEN', revision: 2, kind: 'credential' })
  expect(values.size).toBe(0)
})
