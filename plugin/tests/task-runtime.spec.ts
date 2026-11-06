/** Exercise task controls and durable tool intents at the actual BotMode transaction seams. */
import { expect, it, vi } from 'vitest'
import { BotMode } from '../src/index.ts'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { botDomain } from '../src/domain.ts'
import { reconcileTasks } from '../src/task-ledger.ts'
import { beginOperation, finishOperation } from '../src/task-operations.ts'
import type { BotState, ChatMessageId, RoomId, BotId } from '../src/types.ts'

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
function bench() {
  const initial = botDomain.global.schema.parse({
    bots: [{ id: 'sage', name: 'Sage', instructions: 'Help', preset: 'standard' }],
    rooms: [{ id: 'room', title: 'Chat', kind: 'dm', defaultBot: 'sage', members: [{ botId: 'sage', sessionId: 'session', cursor: 0 }], messages: [
      { id: 'user', botId: null, text: 'Inspect the project', replyTo: null, status: 'complete', error: null, time: 1 },
      { id: 'attempt', botId: 'sage', text: '', replyTo: 'user', status: 'running', error: null, time: 2 },
    ] }],
  })
  reconcileTasks(initial, 2)
  let durable = structuredClone(initial)
  const set = vi.fn(async (next: BotState) => { durable = botDomain.global.schema.parse(structuredClone(next)) })
  const entered = deferred(), idle = deferred(), hooks = new Map<string, Function>(), hostHooks = new Map<string, Function>()
  const hookRemovals = new Map<string, ReturnType<typeof vi.fn>>(), guardRemovals: ReturnType<typeof vi.fn>[] = []
  const guards: ((exec: { name: string; arguments?: unknown }) => string | undefined)[] = []
  const register = vi.fn((_tool: unknown) => () => {})
  const agent = {
    session: { id: initial.rooms[0]!.members[0]!.sessionId }, status: 'idle', inbox: { nextTurn: [], nextStep: [] },
    ctx: { systemPrompt: { assemble: vi.fn(async () => ({ sections: [{ name: 'bot-mode.identity' }] })), variable: vi.fn(), section: vi.fn() },
      tools: { register, guard: vi.fn((guard: typeof guards[number]) => { guards.push(guard); const remove = vi.fn(); guardRemovals.push(remove); return remove }) },
      on: (event: string, listener: Function) => { hooks.set(event, listener); const remove = vi.fn(); hookRemovals.set(event, remove); return remove } },
    followup: vi.fn((_input: { id: string }) => {}), whenIdle: vi.fn(() => idle.promise), cancel: vi.fn(),
  }
  const emit = (type: string, data: unknown) => hostHooks.get('session/event')?.(agent.session, { type, data })
  agent.followup.mockImplementation(input => {
    emit('agent/inbox/spliced', { inserted: [input] }); emit('turn/start', { turn: 1 }); emit('user/message', { ...input }); entered.resolve()
  })
  const ctx = { agents: { get: () => agent }, sessionController: { create: vi.fn(async () => {}) }, sessions: { flush: vi.fn(async () => {}) },
    on: (event: string, listener: Function) => { hostHooks.set(event, listener); return () => {} }, effect: vi.fn(), logger: { error: vi.fn(), warn: vi.fn() } }
  const service: BotMode = Object.create(BotMode.prototype)
  Object.assign(service, { ctx, state: initial, config: { cwd: '.', historyMessages: 80, maxBots: 8, maxMessages: 1000 },
    domain: { global: { set } }, tail: Promise.resolve(), running: new Map(), watchers: new Set(), closing: false,
    live: new Map(), approvals: new Map(), questions: new Map(), queues: new Map(), governanceControllers: new Set(), maintenanceDone: new Set(), ownAuxiliary: new WeakSet() })
  const state = () => Reflect.get(service, 'state') as BotState
  const run = { task: Promise.resolve(), canceled: false }
  const execute = () => {
    Reflect.get(service, 'running').set('attempt', run)
    run.task = Reflect.get(service, 'execute').call(service, 'room', state().rooms[0]!.messages[1]!, run)
      .finally(() => Reflect.get(service, 'running').delete('attempt'))
    return run.task
  }
  const finish = () => { emit('turn/end', { turn: 1, reason: { kind: 'completed' } }); idle.resolve() }
  const call = (callId: string, next: (exec: { agent: unknown; name: string; callId: string; arguments: unknown; signal: AbortSignal }) => Promise<{ isError: boolean }>,
    tool: { name: string; arguments: unknown } = { name: 'external_write', arguments: { secret: 'NEVER_IN_LEDGER' } }) => {
    const exec = { agent, name: tool.name, callId, arguments: tool.arguments, signal: new AbortController().signal }
    return hooks.get('tools/execute')!(exec, () => next(exec)) as Promise<{ isError: boolean }>
  }
  return { service, state, durable: () => durable, set, ctx, agent, run, entered, execute, finish, call, guards, hooks, hookRemovals, guardRemovals, register }
}
const request = { roomId: 'room' as RoomId, messageId: 'attempt' as ChatMessageId }

it('persists task transitions atomically, excludes the ledger from feed snapshots, and reads controls during a live turn', async () => {
  const b = bench(), execution = b.execute()
  await b.entered.promise
  const before = b.set.mock.calls.length
  const view = await b.service.taskView(request)
  expect(view.task).toMatchObject({ id: 'user', status: 'running', runs: [{ id: 'attempt', sessionId: 'session' }] })
  expect(b.service.tasks({ roomId: 'room' })).toHaveLength(1)
  view.task.runs[0]!.botId = 'modified-copy'
  expect((await b.service.taskView(request)).task.runs[0]!.botId).toBe('sage')
  expect(b.set).toHaveBeenCalledTimes(before)
  expect(b.agent.followup).toHaveBeenCalledOnce()
  expect(b.service.snapshot().taskLedger).toBeUndefined()
  expect(Reflect.get(b.service, 'clientSnapshot').call(b.service).taskLedger).toBeUndefined()
  b.finish(); await execution
  expect((await b.service.taskView(request)).task.status).toBe('awaiting_verification')
  expect(b.durable().taskLedger?.tasks[0]?.status).toBe('awaiting_verification')
  const verified = await b.service.verifyTask({ roomId: 'room', taskId: 'user', outcome: 'accepted' })
  expect(verified.status).toBe('verified')
  expect(b.durable().taskLedger?.tasks[0]?.status).toBe('verified')
})

it('commits cancellation and cancels queued descendants without waiting for the running tool promise', async () => {
  const b = bench(), room = b.state().rooms[0]!, pending = deferred()
  room.messages[0]!.allowDelegation = true
  room.messages.push({ ...room.messages[1]!, id: 'child' as ChatMessageId, replyTo: 'attempt' as ChatMessageId,
    delegation: { rootId: 'user' as ChatMessageId, task: 'Inspect more' }, status: 'queued', time: 3 })
  reconcileTasks(b.state())
  const cancel = vi.fn(), abort = vi.fn()
  Reflect.get(b.service, 'running').set('attempt', { task: pending.promise, canceled: false, agent: { cancel }, deadline: { abort } })
  const result = await b.service.stopTask({ roomId: 'room', taskId: 'user' })
  expect(result.cancelRequestedAt).toBeTypeOf('number')
  expect(result.status).toBe('running') // An acknowledgement does not claim the actual tool has exited.
  expect(b.state().rooms[0]!.messages.find(message => message.id === 'child')!.status).toBe('canceled')
  expect(b.durable().rooms[0]!.messages[0]!.allowDelegation).toBe(false)
  expect(b.durable().rooms[0]!.messages.slice(1).every(message => message.collaborationCanceled)).toBe(true)
  expect(cancel).toHaveBeenCalled(); expect(abort).toHaveBeenCalled(); expect(b.agent.followup).not.toHaveBeenCalled()
  pending.resolve()
})

it('commits tool intent before dispatch and stores only metadata in the durable receipt', async () => {
  const b = bench(), execution = b.execute()
  await b.entered.promise
  const body = vi.fn(async () => {
    expect(b.durable().taskOperations?.operations[0]).toMatchObject({ messageId: 'attempt', callId: 'native-1', status: 'started' })
    return { isError: false }
  })
  expect(await b.call('native-1', body)).toEqual({ isError: false })
  expect(body).toHaveBeenCalledOnce()
  expect(b.durable().taskOperations?.operations[0]).toMatchObject({ name: 'external_write', status: 'returned' })
  expect(JSON.stringify(b.durable().taskOperations)).not.toContain('NEVER_IN_LEDGER')
  expect(b.service.snapshot().taskOperations).toBeUndefined()
  b.finish(); await execution
  expect((await b.service.taskView(request)).operations).toHaveLength(1)
})

it('fails closed before the tool body if intent persistence fails', async () => {
  const b = bench(), execution = b.execute()
  await b.entered.promise
  b.set.mockRejectedValueOnce(new Error('intent storage unavailable'))
  const body = vi.fn(async () => ({ isError: false }))
  await expect(b.call('native-1', body)).rejects.toThrow('intent storage unavailable')
  await execution
  expect(body).not.toHaveBeenCalled()
  expect(b.durable().taskOperations?.operations ?? []).toEqual([])
  expect(b.agent.cancel).toHaveBeenCalled()
  b.finish()
})

it('retains uncertainty and stops further dispatch when the tool returned but receipt persistence failed', async () => {
  const b = bench(), execution = b.execute()
  await b.entered.promise
  const body = vi.fn(async () => { b.set.mockRejectedValueOnce(new Error('receipt storage unavailable')); return { isError: false } })
  await expect(b.call('native-1', body)).rejects.toThrow('receipt storage unavailable')
  await execution
  expect(body).toHaveBeenCalledOnce()
  expect(b.durable().taskOperations?.operations[0]?.status).toBe('unknown')
  const later = vi.fn(async () => ({ isError: false }))
  await expect(b.call('native-2', later)).rejects.toThrow(/ended|blocked/)
  expect(later).not.toHaveBeenCalled(); expect(b.agent.cancel).toHaveBeenCalled()
  await expect(b.service.retry(request)).rejects.toThrow(/uncertain/)
  b.finish()
})

it('treats a native isError tool result as an unknown external outcome, not a verified failure', async () => {
  const b = bench(), execution = b.execute()
  await b.entered.promise
  expect(await b.call('native-1', async () => ({ isError: true }))).toEqual({ isError: true })
  await execution
  expect((await b.service.taskView(request)).operations[0]?.status).toBe('unknown')
  expect(b.agent.cancel).toHaveBeenCalled()
  b.finish()
})

it('blocks root-wide retries and acceptance until sibling operations are reconciled, without executing reconciliation', async () => {
  const b = bench(), state = b.state(), room = state.rooms[0]!
  room.messages[1]!.status = 'failed'
  room.messages.push({ ...room.messages[1]!, id: 'sibling' as ChatMessageId, status: 'complete' })
  beginOperation(state, { roomId: 'room', messageId: 'sibling', callId: 'remote-create', name: 'create_pr' }, 10)
  finishOperation(state, { roomId: 'room', messageId: 'sibling', callId: 'remote-create' }, 'unknown', 11)
  reconcileTasks(state)
  await expect(b.service.retry(request)).rejects.toThrow(/uncertain/)
  await expect(b.service.verifyTask({ roomId: 'room', taskId: 'user', outcome: 'accepted' })).rejects.toThrow(/Reconcile/)
  await expect(b.service.resolveTaskOperation({ roomId: 'other', messageId: 'sibling', callId: 'remote-create', resolution: 'verified_applied' })).rejects.toThrow(/Chat/)
  await b.service.resolveTaskOperation({ roomId: 'room', messageId: 'sibling', callId: 'remote-create', resolution: 'verified_applied' })
  expect(b.durable().taskOperations?.operations[0]?.resolution?.outcome).toBe('verified_applied')
  expect(b.agent.followup).not.toHaveBeenCalled()
  const launch = vi.fn(); Reflect.set(b.service, 'launch', launch)
  const retry = await b.service.retry(request)
  expect(retry.retryOf).toBe('attempt'); expect(launch).toHaveBeenCalledOnce()
})

it('validates structured constraints before accepting work and preserves a detached policy on the human root', async () => {
  const b = bench(), room = b.state().rooms[0]!
  room.messages[1]!.status = 'complete'
  const launch = vi.fn(); Reflect.set(b.service, 'launch', launch)
  const policy = { toolMode: 'allow' as const, tools: ['search_chat'] }
  const user = await b.service.send({ roomId: room.id, text: 'Only search', taskPolicy: policy })
  policy.tools.push('shell')
  expect(user.taskPolicy).toEqual({ toolMode: 'allow', tools: ['search_chat'] })
  expect(b.durable().rooms[0]!.messages.find(message => message.id === user.id)?.taskPolicy).toEqual(user.taskPolicy)
  const before = b.state().rooms[0]!.messages.length
  await expect(b.service.send({ roomId: room.id, text: 'Bad policy', taskPolicy: { toolMode: 'allow' } })).rejects.toThrow(/allowlist/)
  expect(b.state().rooms[0]!.messages).toHaveLength(before)
})

it('inherits the human tool ceiling for a delegated Bot even when the child has no policy', async () => {
  const b = bench(), room = b.state().rooms[0]!
  room.kind = 'group'; room.messages[0]!.allowDelegation = true; room.messages[0]!.taskPolicy = { toolMode: 'none' }
  room.messages[1]!.delegation = { rootId: room.messages[0]!.id, task: 'Inspect only' }
  const execution = b.execute(); await b.entered.promise
  expect(b.guards.some(guard => guard({ name: 'shell' })?.includes('Blocked'))).toBe(true)
  b.finish(); await execution
  expect(b.state().bots[0]!.policy).toBeUndefined()
})

it('preserves original constraints when resuming an expired question as a new human delivery', async () => {
  const b = bench(), room = b.state().rooms[0]!
  room.messages[0]!.taskPolicy = { toolMode: 'none' }
  room.messages[1]!.status = 'complete'
  room.messages[1]!.questions = [{ id: 'pending', callId: 'ask-1', questions: [{ id: 'question', question: 'Which file?' }] }]
  Reflect.set(b.service, 'launch', vi.fn())
  await b.service.answerQuestion({ roomId: room.id, id: 'pending', answer: { answers: [{ id: 'question', selected: [], custom: 'README' }] } })
  const next = b.state().rooms[0]!.messages.at(-2)!
  expect(next.taskPolicy).toEqual({ toolMode: 'none' })
  expect(next.questionReply?.callId).toBe('ask-1')
})

it('keeps task constraints on submitted cards and on explicit retries of delegated attempts', async () => {
  const b = bench(), room = b.state().rooms[0]!
  room.messages[0]!.taskPolicy = { toolMode: 'allow', tools: ['search_chat'] }
  room.messages[1]!.status = 'complete'
  room.messages[1]!.cards = [{ id: 'choice', revision: 1, content: { kind: 'form', title: 'Choose a file', submitLabel: 'Continue', fields: [{ name: 'path', label: 'Path', type: 'text', required: true }] } }]
  Reflect.set(b.service, 'launch', vi.fn())
  const id = await b.service.submitCard({ ...request, cardId: 'choice', revision: 1, values: { path: 'README.md' } })
  const state = b.state(), newRoot = state.rooms[0]!.messages.find(message => message.id === id)!
  expect(newRoot.taskPolicy).toEqual({ toolMode: 'allow', tools: ['search_chat'] })
  const attempt = state.rooms[0]!.messages.at(-1)!
  attempt.status = 'failed'
  const retry = await b.service.retry({ roomId: room.id, messageId: attempt.id })
  expect(retry.retryOf).toBe(attempt.id)
  expect(Reflect.get(b.service, 'requestPolicy').call(b.service, b.state().rooms[0], retry)).toEqual(newRoot.taskPolicy)
})

it('does not publish or dispatch a request whose atomic state commit failed', async () => {
  const b = bench(), room = b.state().rooms[0]!
  room.messages[1]!.status = 'complete'
  const before = structuredClone(b.state()), launch = vi.fn()
  Reflect.set(b.service, 'launch', launch)
  b.set.mockRejectedValueOnce(new Error('atomic commit failed'))
  await expect(b.service.send({ roomId: room.id, text: 'New task', taskPolicy: { toolMode: 'none' } })).rejects.toThrow('atomic commit failed')
  expect(b.state()).toEqual(before)
  expect(launch).not.toHaveBeenCalled()
})

it('rejects duplicate native call IDs rather than dispatching the external effect twice', async () => {
  const b = bench(), execution = b.execute()
  await b.entered.promise
  const body = vi.fn(async () => ({ isError: false }))
  await b.call('native-1', body)
  await expect(b.call('native-1', body)).rejects.toThrow(/already dispatched/)
  await execution
  expect(body).toHaveBeenCalledOnce()
  expect(b.durable().taskOperations?.operations).toHaveLength(1)
  expect(b.durable().taskOperations?.operations[0]?.status).toBe('returned')
  b.finish()
})

it('rejects cross-room task reads even when an attempt ID is known', async () => {
  const b = bench(), original = b.state().rooms[0]!
  b.state().rooms.push({ ...original, id: 'other' as RoomId, messages: [] })
  await expect(b.service.taskView({ roomId: 'other' as RoomId, messageId: request.messageId })).rejects.toThrow(/Task/)
  expect(b.service.tasks({ roomId: 'other' })).toEqual([])
  expect(b.agent.followup).not.toHaveBeenCalled()
})

function sandbox(b: ReturnType<typeof bench>) {
  let mode = 'danger-full-access'
  Object.assign(b.agent.ctx, { sandboxPolicy: { resolve: () => ({ mode }) } })
  const append = vi.fn((type: string, data: { mode: string }) => {
    mode = data.mode
    b.hooks.get('session/event')?.(b.agent.session, { type, data })
  })
  Object.assign(b.agent.session, { append })
  return { mode: () => mode, append }
}

it('enforces a task filesystem ceiling and restores the prior mode after success without self-aborting', async () => {
  const b = bench(), native = sandbox(b)
  b.state().rooms[0]!.messages[0]!.taskPolicy = { fileMode: 'read-only' }
  const execution = b.execute(); await b.entered.promise
  expect(native.mode()).toBe('read-only')
  expect(b.guards.some(guard => guard({ name: 'bash', arguments: { sandbox_permissions: 'workspace-write', justification: 'Write files' } })?.includes('exceeds'))).toBe(true)
  expect(b.guards.every(guard => guard({ name: 'read_file', arguments: { path: 'README' } }) === undefined)).toBe(true)
  b.finish(); await execution
  expect(native.mode()).toBe('danger-full-access')
  expect(b.agent.cancel).not.toHaveBeenCalled()
  expect((await b.service.taskView(request)).task.status).toBe('awaiting_verification')
  expect(b.guardRemovals.every(remove => remove.mock.calls.length === 1)).toBe(true)
})

it('aborts the active task if a native sandbox event broadens its immutable ceiling', async () => {
  const b = bench(), native = sandbox(b)
  b.state().rooms[0]!.messages[0]!.taskPolicy = { fileMode: 'read-only' }
  const execution = b.execute(); await b.entered.promise
  native.append('sandbox/mode', { mode: 'workspace-write' })
  await execution
  expect(b.agent.cancel).toHaveBeenCalled()
  expect(b.state().rooms[0]!.messages[1]!.status).toBe('failed')
  expect(b.state().rooms[0]!.messages[1]!.error).toMatch(/broadened/)
  b.finish()
})

it('retains guards after a deadline and holds the next request until native tools have actually drained', async () => {
  const b = bench(), native = sandbox(b), toolEntered = deferred(), toolGate = deferred()
  b.state().rooms[0]!.messages[0]!.taskPolicy = { fileMode: 'read-only' }
  const execution = b.execute(); await b.entered.promise
  const operation = b.call('slow-write', async () => { toolEntered.resolve(); await toolGate.promise; return { isError: false } })
  await toolEntered.promise
  Reflect.get(b.run, 'deadline').abort('Fixture deadline')
  await execution
  expect(b.state().rooms[0]!.messages[1]!.status).toBe('failed')
  expect(b.durable().taskOperations?.operations[0]?.status).toBe('unknown')
  expect(native.mode()).toBe('read-only')
  expect(b.hookRemovals.get('tools/execute')).not.toHaveBeenCalled()
  expect(b.guardRemovals.every(remove => remove.mock.calls.length === 0)).toBe(true)
  await expect(b.service.resolveTaskOperation({ roomId: 'room', messageId: 'attempt', callId: 'slow-write', resolution: 'verified_applied' })).rejects.toThrow(/native tools/)
  const launch = vi.fn(); Reflect.set(b.service, 'launch', launch)
  await b.service.send({ roomId: request.roomId, text: 'Next independent request' })
  expect(b.state().rooms[0]!.messages.at(-1)!.status).toBe('queued')
  await Reflect.get(b.service, 'drain').call(b.service, 'room')
  expect(launch).not.toHaveBeenCalled()
  b.finish(); toolGate.resolve(); await operation
  await vi.waitFor(() => expect(launch).toHaveBeenCalledOnce())
  expect(native.mode()).toBe('danger-full-access')
  expect(b.hookRemovals.get('tools/execute')).toHaveBeenCalledOnce()
  expect(b.guardRemovals.every(remove => remove.mock.calls.length === 1)).toBe(true)
})

it('rejects operator reconciliation while the original native Session remains active', async () => {
  const b = bench(), state = b.state(), attempt = state.rooms[0]!.messages[1]!
  attempt.status = 'failed'; attempt.executionSessionId = b.agent.session.id
  beginOperation(state, { roomId: 'room', messageId: 'attempt', callId: 'uncertain', name: 'write' }, 1)
  finishOperation(state, { roomId: 'room', messageId: 'attempt', callId: 'uncertain' }, 'unknown', 2)
  b.agent.status = 'running'
  const reconcile = () => b.service.resolveTaskOperation({ roomId: 'room', messageId: 'attempt', callId: 'uncertain', resolution: 'verified_not_applied' })
  await expect(reconcile()).rejects.toThrow(/native tools/)
  expect(state.taskOperations!.operations[0]!.resolution).toBeUndefined()
  b.agent.status = 'idle'
  await reconcile()
  expect(b.durable().taskOperations!.operations[0]!.resolution?.outcome).toBe('verified_not_applied')
  expect(b.agent.followup).not.toHaveBeenCalled()
})

it('quarantines queued task descendants on uncertainty and reconciliation does not resume them', async () => {
  const b = bench(), room = b.state().rooms[0]!
  room.kind = 'group'; room.messages[0]!.allowDelegation = true
  room.messages.push({ ...room.messages[1]!, id: 'child' as ChatMessageId, replyTo: 'attempt' as ChatMessageId,
    delegation: { rootId: room.messages[0]!.id, task: 'More work' }, status: 'queued' })
  reconcileTasks(b.state())
  const execution = b.execute(); await b.entered.promise
  await b.call('uncertain', async () => ({ isError: true })); await execution
  const saved = b.durable().rooms[0]!
  expect(saved.messages[0]!.allowDelegation).toBe(false)
  expect(saved.messages.find(message => message.id === 'child')).toMatchObject({ status: 'canceled', collaborationCanceled: true })
  const launch = vi.fn(); Reflect.set(b.service, 'launch', launch)
  await b.service.resolveTaskOperation({ roomId: 'room', messageId: 'attempt', callId: 'uncertain', resolution: 'verified_not_applied' })
  await Reflect.get(b.service, 'drain').call(b.service, 'room')
  expect(launch).not.toHaveBeenCalled()
  expect(b.state().rooms[0]!.messages.find(message => message.id === 'child')!.status).toBe('canceled')
  b.finish()
})

it('rejects redelivery that drops or broadens an accepted external task policy', async () => {
  const b = bench(), room = b.state().rooms[0]!, user = room.messages[0]!
  room.external = { provider: 'infoflow', accountId: 'app', kind: 'private', id: 'alice' }
  user.taskPolicy = { toolMode: 'none' }
  user.external = { id: 'receipt', sender: { id: 'alice', name: 'Alice' } }
  const delivery = { roomId: room.id, text: user.text, external: user.external }
  await expect(b.service.submitExternalMessage(delivery)).rejects.toThrow(/Conflicting task policy/)
  await expect(b.service.submitExternalMessage({ ...delivery, taskPolicy: { toolMode: 'inherit' } })).rejects.toThrow(/Conflicting task policy/)
  expect(await b.service.submitExternalMessage({ ...delivery, taskPolicy: { toolMode: 'none' } })).toMatchObject({ status: 'accepted', messageId: user.id, attemptIds: ['attempt'] })
  expect(b.agent.followup).not.toHaveBeenCalled()
})

it('permits a successful handoff while a healthy sibling tool operation is still running', async () => {
  const b = bench(), room = b.state().rooms[0]!
  room.kind = 'group'; room.messages[0]!.allowDelegation = true
  const sibling = botDomain.global.schema.parse({ bots: [
    { id: 'sibling-bot', name: 'Sibling', instructions: '', preset: 'standard' },
    { id: 'reviewer', name: 'Reviewer', instructions: '', preset: 'standard' },
  ], rooms: [] }).bots
  b.state().bots.push(...sibling)
  room.members.push(...sibling.map(bot => ({ botId: bot.id, sessionId: b.agent.session.id, cursor: 0 })))
  room.messages.push({ ...room.messages[1]!, id: 'sibling' as ChatMessageId, botId: sibling[0]!.id })
  room.messages[1]!.requestedTasks = [{ botId: sibling[1]!.id, task: 'Review the plan' }]
  beginOperation(b.state(), { roomId: 'room', messageId: 'sibling', callId: 'healthy', name: 'long_read' }, 1)
  Reflect.get(b.service, 'running').set('sibling', { task: Promise.resolve(), canceled: false, deadline: { signal: new AbortController().signal } })
  const launch = vi.fn(); Reflect.set(b.service, 'launch', launch)
  const execution = b.execute(); await b.entered.promise
  b.finish(); await execution
  expect(launch).toHaveBeenCalledOnce()
  expect(b.state().rooms[0]!.messages.at(-1)).toMatchObject({ botId: 'reviewer', status: 'running', delegation: { rootId: 'user', task: 'Review the plan' } })
  expect(b.state().rooms[0]!.messages[0]!.allowDelegation).toBe(true)
})

it('does not spawn a recorded handoff when task cancellation races turn completion', async () => {
  const b = bench(), room = b.state().rooms[0]!
  room.kind = 'group'; room.messages[0]!.allowDelegation = true
  const reviewer = botDomain.global.schema.parse({ bots: [{ id: 'reviewer', name: 'Reviewer', instructions: '', preset: 'standard' }], rooms: [] }).bots[0]!
  b.state().bots.push(reviewer); room.members.push({ botId: reviewer.id, sessionId: b.agent.session.id, cursor: 0 })
  room.messages[1]!.requestedTasks = [{ botId: reviewer.id, task: 'Review when ready' }]
  const launch = vi.fn(); Reflect.set(b.service, 'launch', launch)
  const execution = b.execute(); await b.entered.promise
  const stopping = b.service.stopTask({ roomId: 'room', taskId: 'user' })
  b.finish(); await stopping; await execution
  expect(launch).not.toHaveBeenCalled()
  expect(b.state().rooms[0]!.messages).toHaveLength(2)
  expect(b.durable().rooms[0]!.messages[0]!.allowDelegation).toBe(false)
  expect(b.durable().rooms[0]!.messages[1]!.status).toBe('canceled')
})

it('records a known Host-local tool failure as returned while a later external error still halts the run', async () => {
  const b = bench(), execution = b.execute()
  await b.entered.promise
  const tool = b.register.mock.calls.map(([definition]) => definition as { name?: string; execute?: (args: unknown, exec: unknown) => Promise<unknown> })
    .find(definition => definition.name === 'read_chat')
  expect(tool?.execute).toBeTypeOf('function')
  // Mirror the native registry: a thrown tool body becomes an error result for the model.
  const dispatch = async (exec: { arguments: unknown }) => {
    try { await tool!.execute!(exec.arguments, exec); return { isError: false } } catch { return { isError: true } }
  }
  expect(await b.call('local-1', dispatch, { name: 'read_chat', arguments: { messageId: 'missing' } })).toEqual({ isError: true })
  expect(b.durable().taskOperations?.operations[0]).toMatchObject({ callId: 'local-1', name: 'read_chat', status: 'returned' })
  expect(b.agent.cancel).not.toHaveBeenCalled()
  expect(b.state().rooms[0]!.messages[1]!.status).toBe('running')
  // The evidence is consumed per call ID; an external error without it remains uncertain.
  expect(await b.call('external-1', async () => ({ isError: true }))).toEqual({ isError: true })
  expect(b.durable().taskOperations?.operations.find(operation => operation.callId === 'external-1')?.status).toBe('unknown')
  await execution
  expect(b.agent.cancel).toHaveBeenCalled()
  b.finish()
})

it('keeps chats and Bots with unresolved tool receipts, and blocks lifecycle changes while native work is busy', async () => {
  const b = bench(), key = { roomId: 'room', messageId: 'attempt', callId: 'write-1' }
  b.state().rooms[0]!.messages[1]!.status = 'canceled'
  beginOperation(b.state(), { ...key, name: 'external_write' }, 3)
  await expect(b.service.lifecycle({ kind: 'room', id: 'room', action: 'delete' })).rejects.toThrow(/Reconcile uncertain/)
  await expect(b.service.lifecycle({ kind: 'bot', id: 'sage', action: 'delete' })).rejects.toThrow(/Reconcile uncertain/)
  finishOperation(b.state(), key, 'unknown')
  await expect(b.service.lifecycle({ kind: 'room', id: 'room', action: 'delete' })).rejects.toThrow(/Reconcile uncertain/)
  expect(b.state().rooms.map(room => room.id)).toEqual(['room'])
  expect(b.state().bots.map(bot => bot.id)).toEqual(['sage'])
  expect(b.state().taskOperations?.operations[0]).toMatchObject({ ...key, status: 'unknown' })

  b.agent.status = 'running'
  await expect(b.service.lifecycle({ kind: 'room', id: 'room', action: 'archive' })).rejects.toThrow(/native tools/)
  expect(b.state().rooms[0]!.archived).toBeFalsy()
  b.agent.status = 'idle'

  const settled = bench()
  settled.state().rooms[0]!.messages[1]!.status = 'canceled'
  beginOperation(settled.state(), { ...key, name: 'external_write' }, 3)
  finishOperation(settled.state(), key, 'returned')
  await settled.service.lifecycle({ kind: 'room', id: 'room', action: 'delete' })
  expect(settled.durable().rooms).toEqual([])
  expect(settled.durable().taskOperations?.operations.filter(operation => operation.status === 'started' || operation.status === 'unknown') ?? []).toEqual([])
})

it.each(['question', 'card'] as const)('requires root-wide reconciliation before a %s creates a continuation root', async kind => {
  const b = bench(), room = b.state().rooms[0]!, original = room.messages[1]!
  room.messages[0]!.taskPolicy = { fileMode: 'read-only' }
  original.status = 'complete'
  original.questions = [{ id: 'pending', callId: 'ask-1', questions: [{ id: 'question', question: 'Which file?' }] }]
  original.cards = [{ id: 'choice', revision: 1, content: { kind: 'form', title: 'Choose', submitLabel: 'Continue', fields: [{ name: 'path', label: 'Path', type: 'text', required: true }] } }]
  room.messages.push({ ...original, id: 'sibling' as ChatMessageId, questions: undefined, cards: undefined, status: 'failed' })
  const key = { roomId: room.id, messageId: 'sibling', callId: 'write' }
  beginOperation(b.state(), { ...key, name: 'remote_write' })
  finishOperation(b.state(), key, 'unknown')
  reconcileTasks(b.state())
  const launch = vi.fn(); Reflect.set(b.service, 'launch', launch)
  const resume = () => kind === 'question'
    ? b.service.answerQuestion({ roomId: room.id, id: 'pending', answer: { answers: [{ id: 'question', selected: [], custom: 'README' }] } })
    : b.service.submitCard({ ...request, cardId: 'choice', revision: 1, values: { path: 'README' } })
  await expect(resume()).rejects.toThrow(/uncertain/)
  expect(b.state().rooms[0]!.messages).toHaveLength(3)
  expect(launch).not.toHaveBeenCalled()
  await b.service.resolveTaskOperation({ ...key, resolution: 'verified_not_applied' })
  await resume()
  expect(launch).toHaveBeenCalledOnce()
  expect(b.state().rooms[0]!.messages.at(-2)!.taskPolicy).toEqual({ fileMode: 'read-only' })
})


it.each(['running', 'draining'] as const)('cannot detach and re-add a Bot while its canceled native execution is still %s', async mode => {
  const b = bench(), room = b.state().rooms[0]!, sage = 'sage' as BotId, other = 'other' as BotId
  room.kind = 'group'; room.messages[1]!.status = 'canceled'
  b.state().bots.push({ ...b.state().bots[0]!, id: other, name: 'Other' })
  room.members.push({ botId: other, sessionId: 'other-session' as SessionId, cursor: 0 })
  b.agent.status = mode === 'running' ? 'running' : 'idle'
  const draining = new Set(mode === 'draining' ? ['session'] : [])
  Reflect.set(b.service, 'drainingSessions', draining)
  const before = structuredClone(room.members)
  await expect(b.service.setMembers({ roomId: room.id, botIds: [other], defaultBot: other })).rejects.toThrow(/native tools/)
  await expect(b.service.setMembers({ roomId: room.id, botIds: [other, sage], defaultBot: other })).rejects.toThrow(/native tools/)
  await expect(b.service.lifecycle({ kind: 'bot', id: sage, action: 'delete' })).rejects.toThrow(/native tools/)
  expect(b.state().rooms[0]!.members).toEqual(before)
  expect(b.set).not.toHaveBeenCalled()
  // Once the real native execution has drained, deliberate removal and rejoining are safe.
  b.agent.status = 'idle'; draining.clear()
  await b.service.setMembers({ roomId: room.id, botIds: [other], defaultBot: other })
  await b.service.setMembers({ roomId: room.id, botIds: [other, sage], defaultBot: sage })
  const rejoined = b.state().rooms[0]!.members.find(member => member.botId === sage)!
  expect(rejoined.sessionId).not.toBe('session')
})

it.each(['room', 'old-room'] as const)('retains member and Bot recovery references until an uncertain operation in %s is reconciled', async operationRoom => {
  const b = bench(), room = b.state().rooms[0]!, sage = 'sage' as BotId, other = 'other' as BotId
  room.kind = 'group'; room.messages[1]!.status = 'failed'; room.aliases = ['old-room' as RoomId]
  b.state().bots.push({ ...b.state().bots[0]!, id: other, name: 'Other' })
  room.members.push({ botId: other, sessionId: 'other-session' as SessionId, cursor: 0 })
  const key = { roomId: operationRoom, messageId: 'attempt', callId: 'unknown-1' }
  beginOperation(b.state(), { ...key, name: 'external_write' }, 3)
  finishOperation(b.state(), key, 'unknown', 4)
  await expect(b.service.setMembers({ roomId: room.id, botIds: [other], defaultBot: other })).rejects.toThrow(/Reconcile uncertain/)
  await expect(b.service.lifecycle({ kind: 'bot', id: sage, action: 'delete' })).rejects.toThrow(/Reconcile uncertain/)
  expect(b.state().rooms[0]!.members.map(member => member.botId)).toEqual([sage, other])
  expect(b.set).not.toHaveBeenCalled()
  await b.service.resolveTaskOperation({ ...key, resolution: 'verified_applied' })
  await b.service.setMembers({ roomId: room.id, botIds: [other], defaultBot: other })
  await b.service.lifecycle({ kind: 'bot', id: sage, action: 'delete' })
  expect(b.state().bots.map(bot => bot.id)).toEqual([other])
  expect((await b.service.taskView(request)).operations[0]?.resolution?.outcome).toBe('verified_applied')
  expect(b.agent.followup).not.toHaveBeenCalled()
})
