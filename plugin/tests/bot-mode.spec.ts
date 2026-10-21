/** Exercise the real owner transactions and execution with controllable native I/O. */
import { expect, it, vi } from 'vitest'
import { Service } from '@deepseek-ai/cordis'
import { BotMode } from '../src/index.ts'
import type { BotState, RoomId, ChatMessageId, BotId } from '../src/types.ts'

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
    on: vi.fn(() => () => {}), effect: vi.fn((action: () => unknown) => action()), logger: { error: vi.fn() } }
  // Bypass Cordis registration only; all methods under test are the actual service implementation.
  const service: BotMode = Object.create(BotMode.prototype)
  Object.assign(service, { ctx, state, config: { cwd: '.', historyMessages: 80, maxBots: 8, maxMessages: 1000 },
    domain: { global: { get: () => state, set }, close }, tail: Promise.resolve(), running: new Map(), watchers: new Set([wake]), closing: false, live: new Map(), approvals: new Map(), queues: new Map() })
  const run = { task: Promise.resolve(), canceled: false }
  const execute = () => {
    run.task = Reflect.get(service, 'execute').call(service, 'room', state.rooms[0]!.messages.find(message => message.id === 'attempt')!, run)
    return run.task
  }
  return { service, state, set, close, assemble, followup, wake, ctx, variable, execute, run }
}

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
  const page = b.service.history({ roomId: room.id, limit: 10, query: 'needle' })
  expect(page.total).toBe(15); expect(page.messages[0]!.text).toBe('needle 50')
  expect(b.service.history({ roomId: room.id, query: 'needle', before: page.before!, limit: 10 }).messages).toHaveLength(5)
  const controller = new AbortController(), feed = b.service.follow(controller.signal)
  const frame = await feed.next()
  expect(frame.value.value.rooms[0].messages).toHaveLength(50)
  expect(b.service.exportChat({ roomId: room.id, format: 'json' })).toContain('needle 0')
  controller.abort(); await feed.return()
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
  const listeners = new Map<string, Function>(), guard = vi.fn(() => () => {})
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
