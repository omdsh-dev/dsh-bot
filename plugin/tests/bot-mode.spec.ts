/** Exercise the real owner transactions and execution with controllable native I/O. */
import { expect, it, vi } from 'vitest'
import { Service } from '@deepseek-ai/cordis'
import { BotMode } from '../src/index.ts'
import type { BotState, RoomId, ChatMessageId } from '../src/types.ts'

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
    domain: { global: { get: () => state, set }, close }, tail: Promise.resolve(), running: new Map(), watchers: new Set([wake]), closing: false })
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
