/** Seeded state-machine and crash-window checks. No network, model dispatch, new deps or disk archives. */
import { describe, expect, it } from 'vitest'
import { botDomain, messageSchema } from '../src/domain.ts'
import { HistoryStore } from '../src/history-store.ts'
import { mergeExternalRooms } from '../src/external-rooms.ts'
import {
  getTask, listTasks, reconcileTasks, requestTaskCancellation, verifyTask,
  TASK_EVENT_LIMIT, TASK_TERMINAL_LIMIT, type TaskRecord, type TaskState,
} from '../src/task-ledger.ts'
import {
  beginOperation, finishOperation, hasUnknownOperations, interruptOperations, operationId, operationsFor, resolveOperation,
} from '../src/task-operations.ts'
import type { OperationKey } from '../src/task-operation-types.ts'
import type { ChatMessage, Room } from '../src/types.ts'

const PRIVATE = 'NEVER_COPY_PRIVATE_PAYLOAD'
const active = (status: string) => ['queued', 'running', 'waiting'].includes(status)
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown
const msg = (input: Record<string, unknown>): ChatMessage => messageSchema.parse({
  botId: 'worker', text: '', replyTo: null, status: 'queued', error: null, time: 1, ...input,
})
const read = (state: TaskState, id: string): ChatMessage => state.rooms.flatMap(room => room.messages).find(item => item.id === id)!
const taskLeaves = (task: TaskRecord) => {
  const replaced = new Set(task.runs.flatMap(run => [run.retryOf, run.continuationOf].filter(Boolean)))
  return task.runs.filter(run => !replaced.has(run.id))
}
function fixture(ids = ['room']): TaskState {
  return botDomain.global.schema.parse({ bots: [{ id: 'worker', name: 'Worker', instructions: '', preset: 'default' },
    { id: 'child-worker', name: 'Child', instructions: '', preset: 'default' }], rooms: ids.map(id => ({
    id, title: id, kind: 'group', defaultBot: 'worker', members: [
      { botId: 'worker', sessionId: `session-${id}`, cursor: 0 },
      { botId: 'child-worker', sessionId: `child-session-${id}`, cursor: 0 },
    ], messages: [],
  })) })
}
/** Exercise the actual persistence contract, including strict operation identity/time refinements. */
function roundTrip(state: TaskState): TaskState {
  const wire = json(state), restored = botDomain.global.schema.parse(wire)
  expect(json(restored)).toEqual(wire) // No silent stripping of a field introduced by a test transition.
  return restored
}
function assertInvariants(state: TaskState): void {
  const tasks = state.taskLedger?.tasks ?? []
  expect(new Set(tasks.map(task => JSON.stringify([task.roomId, task.id]))).size).toBe(tasks.length)
  for (const task of tasks) {
    expect(task.id).toBe(task.rootMessageId)
    expect(new Set(task.runs.map(run => run.id)).size).toBe(task.runs.length)
    expect(task.events.length).toBeLessThanOrEqual(TASK_EVENT_LIMIT)
    expect(task.events.every((event, index) => index === 0 || event.sequence > task.events[index - 1]!.sequence)).toBe(true)
    if (task.events.length) expect(task.nextSequence).toBe(task.events.at(-1)!.sequence + 1)
    const leaves = taskLeaves(task)
    if (task.status === 'verified') {
      expect(task.verification?.outcome).toBe('accepted')
      expect(leaves.length).toBeGreaterThan(0)
      expect(leaves.every(run => run.status === 'complete')).toBe(true)
    }
    if (leaves.some(run => active(run.status) || ['failed', 'interrupted', 'canceled'].includes(run.status))) {
      expect(task.status).not.toBe('verified')
      expect(task.status).not.toBe('awaiting_verification')
    }
  }
  for (const operation of state.taskOperations?.operations ?? []) expect(operation.id).toBe(operationId(operation))
  expect(JSON.stringify([state.taskLedger, state.taskOperations])).not.toContain(PRIVATE)
}
/** A transaction boundary, not a mock BotMode implementation: caller owns message/tool transitions. */
class Harness {
  state: TaskState
  now = 1000
  constructor(state = fixture()) { this.state = roundTrip(state) }
  step(mutate: (state: TaskState, now: number) => void = () => {}): void {
    const next = structuredClone(this.state)
    mutate(next, ++this.now)
    this.state = roundTrip(next)
    reconcileTasks(this.state, this.now)
    this.state = roundTrip(this.state)
    assertInvariants(this.state)
    const before = json(this.state)
    reconcileTasks(this.state, this.now + 0.5)
    expect(json(this.state)).toEqual(before) // Unchanged reconciliation adds no events or receipts.
    this.state = roundTrip(this.state)
  }
  rejected(mutate: (state: TaskState) => void, error?: string): void {
    const before = json(this.state)
    expect(() => mutate(this.state)).toThrow(error)
    expect(json(this.state)).toEqual(before)
    this.state = roundTrip(this.state)
  }
}
function addTask(room: Room, id: string, time: number, status: ChatMessage['status'] = 'queued'): void {
  room.messages.push(msg({ id: `root-${id}`, botId: null, text: PRIVATE, allowDelegation: true, time, status: 'complete' }),
    msg({ id: `run-${id}`, replyTo: `root-${id}`, status, time: time + 0.1 }))
}
function scope(state: TaskState, task: TaskRecord) {
  const room = state.rooms.find(room => room.id === task.roomId)!
  return { roomIds: [room.id, ...room.aliases ?? []], messageIds: task.runs.map(run => run.id) }
}
function prng(seed: number): () => number {
  let value = seed >>> 0
  return () => { value ^= value << 13; value ^= value >>> 17; value ^= value << 5; return (value >>> 0) / 4294967296 }
}
function pick<T>(rows: readonly T[], random: () => number): T | undefined { return rows[Math.floor(random() * rows.length)] }
function retry(state: TaskState, oldId: string, newId: string, time: number): void {
  const room = state.rooms.find(room => room.messages.some(message => message.id === oldId))!, old = read(state, oldId)
  // Same provenance and resets as an explicit retry; only unsuccessful, settled leaf attempts are selected.
  room.messages.push(msg({ ...old, id: newId, retryOf: old.id, status: 'running', time, text: '', error: null,
    executionSessionId: undefined, toolDetails: undefined, awaiting: undefined, continuedBy: undefined,
    requestedTasks: undefined, collaborationCanceled: undefined }))
}
function stop(state: TaskState, taskId: string, time: number): void {
  const task = state.taskLedger!.tasks.find(task => task.id === taskId)!, room = state.rooms.find(room => room.id === task.roomId)!
  const ids = requestTaskCancellation(state, room.id, taskId, time)
  const root = read(state, taskId)
  if (root) root.allowDelegation = false
  for (const message of room.messages) if (task.runs.some(run => run.id === message.id)) {
    message.collaborationCanceled = true
    if (message.status === 'queued') message.status = 'canceled'
  }
  expect(ids.every(id => taskLeaves(task).some(run => run.id === id && active(run.status)))).toBe(true)
}

// Every run is reproducible without monkey-patching clocks or randomUUID. There are no real workers.
describe('deterministic task/operation state machine', () => {
  for (const seed of [1, 7, 42, 203, 8191, 0x12345678, 0x9e3779b9, 0xffffffff]) {
    it(`preserves invariants through mixed lifecycle commands (seed ${seed})`, () => {
      const random = prng(seed), h = new Harness(fixture(['room', 'other'])), visited = new Set<string>()
      let serial = 0
      for (let step = 0; step < 100; step++) {
        const command = step < 12 ? step : Math.floor(random() * 12)
        const tasks = h.state.taskLedger?.tasks ?? []
        const messages = h.state.rooms.flatMap(room => room.messages).filter(message => message.botId !== null)
        switch (command) {
          case 0: { // independent task identity and room scope
            const roomIndex = random() < 0.3 ? 1 : 0, id = `${seed}-${serial++}`
            h.step(state => addTask(state.rooms[roomIndex]!, id, h.now, 'queued')); visited.add('create'); break
          }
          case 1: {
            const target = pick(messages.filter(message => message.status === 'queued'), random)
            if (target) { h.step(state => { read(state, target.id).status = 'running' }); visited.add('start') }
            break
          }
          case 2: { // durable intent first; never write arbitrary hand-built operation records
            const target = pick(messages.filter(message => message.status === 'running'), random)
            if (target) {
              const room = h.state.rooms.find(room => room.messages.some(message => message.id === target.id))!
              const key = { roomId: room.id, messageId: target.id, callId: `call-${serial++}`, name: 'external_write' }
              h.step((state, now) => { beginOperation(state, key, now) })
              h.rejected(state => beginOperation(state, key, h.now), 'already dispatched')
              visited.add('intent')
            }
            break
          }
          case 3: {
            const operation = pick((h.state.taskOperations?.operations ?? []).filter(item => item.status === 'started'), random)
            if (operation) {
              const outcome = random() < 0.5 ? 'returned' : 'unknown'
              // A backwards wall clock cannot produce an invalid receipt time ordering.
              h.step(state => finishOperation(state, operation, outcome, operation.startedAt - 10))
              const receipt = json(h.state.taskOperations)
              h.step((state, now) => finishOperation(state, operation, outcome, now))
              expect(json(h.state.taskOperations)).toEqual(receipt); visited.add('receipt')
            }
            break
          }
          case 4: {
            const target = pick(messages.filter(message => message.status === 'running'), random)
            if (target) {
              const terminal = pick(['complete', 'failed', 'interrupted'] as const, random)!
              h.step((state, now) => {
                read(state, target.id).status = terminal
                const room = state.rooms.find(room => room.messages.some(message => message.id === target.id))!
                interruptOperations(state, now, { roomIds: [room.id], messageIds: [target.id] })
              }); visited.add('settle')
            }
            break
          }
          case 5: {
            const candidate = pick(tasks.filter(task => active(task.status)), random)
            if (candidate) { h.step((state, now) => stop(state, candidate.id, now)); visited.add('stop') }
            break
          }
          case 6: { // explicit human evidence, not a tool retry
            const operation = pick((h.state.taskOperations?.operations ?? []).filter(item => item.status === 'unknown' && !item.resolution
              && !['running', 'queued'].includes(read(h.state, item.messageId)?.status ?? 'complete')), random)
            if (operation) {
              const resolution = random() < 0.5 ? 'verified_applied' : 'verified_not_applied'
              h.step(state => resolveOperation(state, { ...operation, resolution }, operation.finishedAt! - 5))
              const before = json(h.state.taskOperations)
              h.step((state, now) => resolveOperation(state, { ...operation, resolution }, now))
              expect(json(h.state.taskOperations)).toEqual(before)
              h.rejected(state => resolveOperation(state, { ...operation, resolution: resolution === 'verified_applied' ? 'verified_not_applied' : 'verified_applied' }, h.now), 'cannot be changed')
              visited.add('resolve')
            }
            break
          }
          case 7: {
            const candidate = pick(tasks.filter(task => !active(task.status) && !hasUnknownOperations(h.state, scope(h.state, task))
              && !h.state.rooms.find(room => room.id === task.roomId)!.messages.some(message => message.status === 'running')).flatMap(task => taskLeaves(task))
              .filter(run => ['failed', 'interrupted', 'canceled'].includes(run.status)), random)
            if (candidate) { h.step((state, now) => retry(state, candidate.id, `retry-${seed}-${serial++}`, now)); visited.add('retry') }
            break
          }
          case 8: {
            const candidate = pick(tasks.filter(task => task.status === 'awaiting_verification' && !hasUnknownOperations(h.state, scope(h.state, task))), random)
            if (candidate) {
              const outcome = random() < 0.75 ? 'accepted' : 'rejected'
              h.step((state, now) => { verifyTask(state, candidate.roomId, candidate.id, outcome, now) }); visited.add('review')
            }
            break
          }
          case 9: { // startup recovery: mark interrupted; no automatic run or tool replay
            const ids = messages.filter(message => message.status === 'running').map(message => message.id)
            const operationCount = h.state.taskOperations?.operations.length ?? 0
            h.step((state, now) => {
              for (const id of ids) read(state, id).status = 'interrupted'
              interruptOperations(state, now)
            })
            expect(h.state.taskOperations?.operations.length ?? 0).toBe(operationCount)
            expect(ids.every(id => read(h.state, id).status === 'interrupted')).toBe(true)
            visited.add('restart'); break
          }
          case 10: { // streaming text and tool argument changes never become lifecycle events
            const target = pick(messages, random), before = json(h.state.taskLedger)
            if (target) {
              h.step(state => { const message = read(state, target.id); message.text += PRIVATE
                message.toolDetails = [{ name: 'external_write', arguments: PRIVATE, result: PRIVATE }] })
              expect(json(h.state.taskLedger)).toEqual(before); visited.add('tokens')
            }
            break
          }
          case 11: {
            h.step()
            const candidate = pick(tasks, random)
            if (candidate) {
              h.rejected(state => getTask(state, candidate.roomId === 'room' ? 'other' : 'room', candidate.id), 'unavailable')
              const before = json(h.state), views = listTasks(h.state, candidate.roomId)
              if (views[0]) views[0].events.length = 0
              const operations = operationsFor(h.state, candidate.roomId)
              if (operations[0]) operations[0].name = PRIVATE
              expect(json(h.state)).toEqual(before)
            }
            visited.add('read'); break
          }
        }
      }
      expect([...visited]).toEqual(expect.arrayContaining(['create', 'start', 'intent', 'restart', 'read', 'tokens']))
    })
  }
})

it('never verifies active or failed delegated leaves; retry/continuation only supersede their own attempts', () => {
  const h = new Harness()
  h.step(state => addTask(state.rooms[0]!, 'tree', 1, 'running'))
  h.step((state, now) => {
    const parent = read(state, 'run-tree')
    const children = [0, 1, 2].map(index => msg({ id: `child-${index}`, botId: 'child-worker', replyTo: parent.id,
      delegation: { rootId: 'root-tree', task: PRIVATE }, status: 'queued', time: now }))
    state.rooms[0]!.messages.push(...children); parent.status = 'complete'; parent.awaiting = children.map(child => child.id)
  })
  h.rejected(state => verifyTask(state, 'room', 'root-tree', 'accepted', h.now), 'Only finished')
  for (let index = 0; index < 3; index++) {
    h.step(state => { read(state, `child-${index}`).status = 'running' })
    h.step(state => { read(state, `child-${index}`).status = index === 1 ? 'failed' : 'complete' })
  }
  h.step((state, now) => {
    const parent = read(state, 'run-tree'), callback = msg({ id: 'callback', replyTo: parent.id, botId: parent.botId,
      delegation: { rootId: 'root-tree', task: PRIVATE }, continuationOf: parent.id, resultIds: parent.awaiting, time: now })
    parent.continuedBy = callback.id; state.rooms[0]!.messages.push(callback)
  })
  h.step(state => { read(state, 'callback').status = 'running' })
  h.step(state => { read(state, 'callback').status = 'complete' })
  expect(getTask(h.state, 'room', 'root-tree').status).toBe('failed')
  h.rejected(state => verifyTask(state, 'room', 'root-tree', 'accepted', h.now), 'Only finished')
  h.step((state, now) => retry(state, 'child-1', 'child-retry', now))
  h.rejected(state => verifyTask(state, 'room', 'root-tree', 'accepted', h.now), 'Only finished')
  h.step(state => { read(state, 'child-retry').status = 'complete' })
  expect(getTask(h.state, 'room', 'root-tree').status).toBe('awaiting_verification')
  h.step((state, now) => { verifyTask(state, 'room', 'root-tree', 'accepted', now) })
  // An additional explicitly requested attempt must invalidate earlier acceptance.
  h.step((state, now) => state.rooms[0]!.messages.push(msg({ id: 'late-child', replyTo: 'run-tree', delegation: { rootId: 'root-tree', task: PRIVATE }, time: now })))
  expect(getTask(h.state, 'room', 'root-tree').verification).toBeUndefined()
  expect(getTask(h.state, 'room', 'root-tree').status).toBe('queued')
  h.step((state, now) => stop(state, 'root-tree', now))
  expect(getTask(h.state, 'room', 'root-tree').status).toBe('canceled')
})

it('bounds audit events under repeated explicit retries without losing cancellation or claiming a late success was stopped', () => {
  const h = new Harness()
  h.step(state => addTask(state.rooms[0]!, 'chain', 1, 'running'))
  h.step((state, now) => stop(state, 'root-chain', now))
  const requested = getTask(h.state, 'room', 'root-chain').cancelRequestedAt
  h.step(state => { read(state, 'run-chain').status = 'complete' })
  expect(getTask(h.state, 'room', 'root-chain')).toMatchObject({ status: 'awaiting_verification', cancelRequestedAt: requested })
  // A separate unsuccessful branch is retried many times; no terminal attempt is reset in place.
  h.step((state, now) => state.rooms[0]!.messages.push(msg({ id: 'branch', replyTo: 'root-chain', time: now, status: 'running' })))
  let previous = 'branch'
  for (let index = 0; index < 70; index++) {
    h.step(state => { read(state, previous).status = 'failed' })
    const next = `chain-retry-${index}`
    h.step((state, now) => retry(state, previous, next, now)); previous = next
  }
  h.step(state => { read(state, previous).status = 'complete' })
  const task = getTask(h.state, 'room', 'root-chain')
  expect(task.events).toHaveLength(TASK_EVENT_LIMIT)
  expect(task.droppedEvents).toBeGreaterThan(0)
  expect(task.events[0]!.sequence).toBe(task.droppedEvents + 1)
  expect(task.nextSequence).toBe(task.droppedEvents + task.events.length + 1)
  expect(task.cancelRequestedAt).toBe(requested)
  expect(task.status).toBe('awaiting_verification')
  expect(task.runs).toHaveLength(72)
})

function archiveHarness() {
  const chunks = new Map<string, unknown>()
  let writes = 0
  const open = () => new HistoryStore(async spec => ({ global: {
    get: () => spec.global.schema.parse(chunks.get(spec.name) ?? []),
    set: async (value: unknown) => { chunks.set(spec.name, spec.global.schema.parse(json(value))); writes++ },
  }, close: async () => {} }) as never)
  return { open, chunks, writes: () => writes }
}
function protect(state: TaskState, roomId: string, messageId: string, now: number): OperationKey {
  const key = { roomId, messageId, callId: `call-${messageId}` }
  beginOperation(state, { ...key, name: 'external_write' }, now)
  return key
}

for (const seed of [7, 42, 8191]) {
  it(`preserves uncertain references through terminal caps, real HistoryStore compaction and hydration (seed ${seed})`, async () => {
    const h = new Harness(), random = prng(seed), archive = archiveHarness(), store = archive.open()
    h.step(state => { addTask(state.rooms[0]!, 'pending', 0, 'running'); addTask(state.rooms[0]!, 'unknown', 1, 'running') })
    let pending!: OperationKey, unknown!: OperationKey
    h.step((state, now) => { pending = protect(state, 'room', 'run-pending', now) })
    h.step((state, now) => { unknown = protect(state, 'room', 'run-unknown', now) })
    h.step((state, now) => { finishOperation(state, unknown, 'unknown', now); read(state, 'run-unknown').status = 'interrupted' })
    // A response can settle before a final cleanup transaction; the outstanding intent must stay pinned.
    h.step(state => { read(state, 'run-pending').status = 'complete' })
    h.step(state => {
      // Equal timestamps plus arbitrary input order exercise the binary time/ID retention fence.
      const ids = Array.from({ length: TASK_TERMINAL_LIMIT + 20 }, (_, index) => `bulk-${String(index).padStart(4, '0')}`)
      for (let index = ids.length - 1; index > 0; index--) {
        const swap = Math.floor(random() * (index + 1)); [ids[index], ids[swap]] = [ids[swap]!, ids[index]!]
      }
      for (const id of ids) addTask(state.rooms[0]!, id, 100, 'complete')
    })
    expect(h.state.taskLedger!.tasks).toHaveLength(TASK_TERMINAL_LIMIT + 2)
    expect(getTask(h.state, 'room', 'root-pending').runs[0]!.id).toBe('run-pending')
    expect(getTask(h.state, 'room', 'root-unknown').runs[0]!.id).toBe('run-unknown')
    expect(h.state.taskLedger!.retiredBefore.room).toEqual({ time: 100, id: 'root-bulk-0019' })
    let manifest = h.state
    await store.persist(h.state, async next => { manifest = roundTrip(next) })
    expect(manifest.rooms[0]!.historyChunks!.length).toBeGreaterThan(0)
    expect(manifest.rooms[0]!.messages.length).toBeLessThanOrEqual(256)
    expect(manifest.rooms[0]!.messages.some(message => message.id === 'run-pending')).toBe(false)
    const stable = json(h.state.taskLedger)
    h.state = manifest; h.step()
    expect(json(h.state.taskLedger)).toEqual(stable)
    for (let pass = 0; pass < 3; pass++) {
      h.state = roundTrip(await archive.open().hydrate(h.state)); h.step()
      expect(json(h.state.taskLedger)).toEqual(stable)
      const beforeWrites = archive.writes()
      await store.persist(h.state, async next => { h.state = roundTrip(next) })
      expect(archive.writes()).toBe(beforeWrites)
      h.step()
    }
    // No live worker is present, but pending intent and unknown receipt remain unsafe to replay.
    expect(hasUnknownOperations(h.state, { roomIds: ['room'], messageIds: ['run-pending', 'run-unknown'] })).toBe(true)
    h.step((state, now) => { interruptOperations(state, now, { roomIds: ['room'], messageIds: ['run-pending'] }) })
    h.step((state, now) => resolveOperation(state, { ...pending, resolution: 'verified_not_applied' }, now))
    h.rejected(state => getTask(state, 'room', 'root-pending'), 'unavailable')
    expect(getTask(h.state, 'room', 'root-unknown').id).toBe('root-unknown')
    h.step((state, now) => resolveOperation(state, { ...unknown, resolution: 'verified_applied' }, now))
    expect(h.state.taskLedger!.tasks).toHaveLength(TASK_TERMINAL_LIMIT)
    h.rejected(state => getTask(state, 'room', 'root-unknown'), 'unavailable')
    h.state = roundTrip(await store.hydrate(h.state)); h.step()
    // Archive hydration must not resurrect terminal summaries behind the persisted fence.
    expect(h.state.taskLedger!.tasks).toHaveLength(TASK_TERMINAL_LIMIT)
    h.rejected(state => getTask(state, 'room', 'root-pending'), 'unavailable')
    h.rejected(state => getTask(state, 'room', 'root-unknown'), 'unavailable')
  })
}

it('merged room aliases retain archived unknown receipts beyond the cap, cancel intent, and invalidate partial verification', async () => {
  const h = new Harness(fixture(['left', 'right', 'private-other'])), archive = archiveHarness()
  h.step(state => {
    for (const [index, id] of ['left', 'right'].entries()) {
      const room = state.rooms[index]!
      room.external = { provider: 'feishu', accountId: `cli-${id}`, kind: 'group', id: 'shared-chat' }
      // Same Bot has different Sessions across rooms, which is an invalid merge; use distinct members.
      room.members = [room.members[index]!]
      if (index) room.defaultBot = room.members[0]!.botId
      addTask(room, id, 1, index ? 'running' : 'complete')
      room.messages[0]!.external = { id: 'same-receipt', sender: { id: `sender-${id}`, name: 'Owner' } }
      room.messages[0]!.taskPolicy = { fileMode: 'read-only', toolMode: 'none' }
      room.messages[1]!.botId = room.defaultBot
    }
    addTask(state.rooms[2]!, 'private', 1, 'complete')
  })
  let uncertain!: OperationKey
  h.step((state, now) => { uncertain = protect(state, 'right', 'run-right', now) })
  h.step((state, now) => { verifyTask(state, 'left', 'root-left', 'accepted', now) })
  h.step((state, now) => stop(state, 'root-right', now))
  const cancelAt = getTask(h.state, 'right', 'root-right').cancelRequestedAt
  h.step((state, now) => { read(state, 'run-right').status = 'complete'; interruptOperations(state, now, { roomIds: ['right'] }) })
  const receipt = json(h.state.taskOperations)
  h.step((state, now) => { mergeExternalRooms(state, 'shared-chat', 'feishu', now) })
  expect(h.state.rooms).toHaveLength(2)
  const task = getTask(h.state, 'right', 'root-left')
  expect(task).toMatchObject({ roomId: 'left', id: 'root-left', status: 'awaiting_verification', cancelRequestedAt: cancelAt })
  expect(task.runs.map(run => run.id)).toEqual(['run-left', 'run-right'])
  expect(task.verification).toBeUndefined()
  expect(task.events.some(event => event.kind === 'cancel_requested')).toBe(true)
  expect(task.events.some(event => event.kind === 'verification')).toBe(true)
  expect(json(h.state.taskOperations)).toEqual(receipt)
  expect(hasUnknownOperations(h.state, scope(h.state, task))).toBe(true)
  h.rejected(state => getTask(state, 'private-other', 'root-left'), 'unavailable')
  h.step(state => {
    for (let index = 0; index < TASK_TERMINAL_LIMIT + 12; index++) addTask(state.rooms[0]!, `after-merge-${index}`, 100 + index, 'complete')
  })
  expect(h.state.taskLedger!.tasks.filter(task => task.roomId === 'left')).toHaveLength(TASK_TERMINAL_LIMIT + 1)
  await archive.open().persist(h.state, async next => { h.state = roundTrip(next) })
  h.step()
  expect(getTask(h.state, 'right', 'root-left').runs.map(run => run.id)).toContain('run-right')
  expect(hasUnknownOperations(h.state, { roomIds: ['right'], messageIds: ['run-right'] })).toBe(true)
  // The exact original room key remains required for external operation reconciliation.
  h.rejected(state => resolveOperation(state, { ...uncertain, roomId: 'left', resolution: 'verified_applied' }, h.now), 'not found')
  h.step((state, now) => resolveOperation(state, { ...uncertain, resolution: 'verified_applied' }, now))
  h.rejected(state => getTask(state, 'right', 'root-left'), 'unavailable')
  h.state = roundTrip(await archive.open().hydrate(h.state)); h.step()
  h.rejected(state => getTask(state, 'left', 'root-left'), 'unavailable')
  expect(getTask(h.state, 'private-other', 'root-private').status).toBe('awaiting_verification')
})

for (const crash of ['before-intent-commit', 'after-intent-before-dispatch', 'after-effect-before-receipt', 'after-receipt-commit'] as const) {
  it(`recovers without replay at the ${crash} fault window`, async () => {
    const h = new Harness(), archive = archiveHarness(), store = archive.open()
    let effects = 0
    h.step(state => addTask(state.rooms[0]!, 'crash', 1, 'running'))
    let disk = roundTrip(h.state)
    const key = { roomId: 'room', messageId: 'run-crash', callId: 'call-crash' }
    h.step((state, now) => { beginOperation(state, { ...key, name: 'external_write' }, now) })
    if (crash === 'before-intent-commit') {
      await expect(store.persist(h.state, async () => { throw new Error('injected manifest failure') })).rejects.toThrow('manifest failure')
    } else {
      await store.persist(h.state, async next => { disk = roundTrip(next) })
      if (crash !== 'after-intent-before-dispatch') effects++ // External effect, intentionally outside the local commit.
      if (crash === 'after-receipt-commit') {
        h.step((state, now) => { finishOperation(state, key, 'returned', now); read(state, 'run-crash').status = 'complete' })
        await store.persist(h.state, async next => { disk = roundTrip(next) })
      }
    }
    const beforeRecoveryEffects = effects
    h.state = roundTrip(disk)
    h.step((state, now) => {
      for (const room of state.rooms) for (const message of room.messages) if (message.status === 'running') message.status = 'interrupted'
      interruptOperations(state, now)
    })
    expect(effects).toBe(beforeRecoveryEffects)
    const receipt = h.state.taskOperations?.operations[0]
    if (crash === 'before-intent-commit') {
      expect(receipt).toBeUndefined(); expect(effects).toBe(0)
    } else {
      expect(receipt!.status).toBe(crash === 'after-receipt-commit' ? 'returned' : 'unknown')
      h.rejected(state => beginOperation(state, { ...key, name: 'external_write' }, h.now), 'already dispatched')
      if (receipt!.status === 'unknown') {
        h.rejected(state => finishOperation(state, key, 'returned', h.now), 'cannot be overwritten')
        expect(hasUnknownOperations(h.state, { roomIds: ['room'], messageIds: [key.messageId] })).toBe(true)
      }
    }
    expect(getTask(h.state, 'room', 'root-crash').status).toBe(crash === 'after-receipt-commit' ? 'awaiting_verification' : 'interrupted')
  })
}

it('failed history manifest commits cannot expose new task events or chunk edits through the old snapshot', async () => {
  const h = new Harness(), archive = archiveHarness(), store = archive.open()
  h.step(state => { for (let index = 0; index < 180; index++) addTask(state.rooms[0]!, `saved-${index}`, index, 'complete') })
  let disk = h.state
  await store.persist(h.state, async next => { disk = roundTrip(next) })
  const original = roundTrip(disk), originalLedger = json(disk.taskLedger)
  h.state = roundTrip(await archive.open().hydrate(disk))
  h.step((state, now) => { verifyTask(state, 'room', 'root-saved-0', 'accepted', now); read(state, 'root-saved-0').text = 'uncommitted-private-edit' })
  await expect(store.persist(h.state, async () => { throw new Error('injected commit failure') })).rejects.toThrow('commit failure')
  expect(json(disk)).toEqual(json(original))
  h.state = roundTrip(await archive.open().hydrate(disk)); h.step()
  expect(json(h.state.taskLedger)).toEqual(originalLedger)
  expect(read(h.state, 'root-saved-0').text).toBe(PRIVATE)
  expect(getTask(h.state, 'room', 'root-saved-0').status).toBe('awaiting_verification')
  const oldChunk = original.rooms[0]!.historyChunks![0]!
  archive.chunks.delete(`bot_history_${oldChunk}`)
  await expect(archive.open().hydrate(original)).rejects.toThrow('missing or corrupted')
  expect(json(original.taskLedger)).toEqual(originalLedger)
})

it('pins a live delegation tree in the restart tail while pruning unrelated terminal task summaries', async () => {
  const h = new Harness(), archive = archiveHarness()
  h.step(state => addTask(state.rooms[0]!, 'live', 1, 'running'))
  h.step((state, now) => {
    const parent = read(state, 'run-live'), child = msg({ id: 'live-child', botId: 'child-worker', replyTo: parent.id,
      delegation: { rootId: 'root-live', task: PRIVATE }, time: now })
    parent.status = 'complete'; parent.awaiting = [child.id]; state.rooms[0]!.messages.push(child)
  })
  h.step(state => {
    for (let index = 0; index < TASK_TERMINAL_LIMIT + 16; index++) addTask(state.rooms[0]!, `live-tail-${index}`, 2000 + index, 'complete')
  })
  expect(h.state.taskLedger!.tasks).toHaveLength(TASK_TERMINAL_LIMIT + 1)
  await archive.open().persist(h.state, async next => { h.state = roundTrip(next) })
  expect(h.state.rooms[0]!.messages.length).toBeGreaterThan(256)
  for (const id of ['root-live', 'run-live', 'live-child']) expect(read(h.state, id)).toBeDefined()
  const task = getTask(h.state, 'room', 'root-live')
  expect(task.runs.map(run => run.status)).toEqual(['waiting', 'queued'])
  h.step()
  h.rejected(state => verifyTask(state, 'room', 'root-live', 'accepted', h.now), 'Only finished')
  h.step((state, now) => stop(state, 'root-live', now))
  // Once every active leaf is actually stopped, the normal terminal cap may retire the old task.
  expect(read(h.state, 'live-child').status).toBe('canceled')
  expect(read(h.state, 'run-live').collaborationCanceled).toBe(true)
  expect(h.state.taskLedger!.tasks).toHaveLength(TASK_TERMINAL_LIMIT)
  await archive.open().persist(h.state, async next => { h.state = roundTrip(next) })
  expect(h.state.rooms[0]!.messages.length).toBeLessThanOrEqual(256)
  h.step()
  h.state = roundTrip(await archive.open().hydrate(h.state)); h.step()
  expect(read(h.state, 'live-child').status).toBe('canceled')
  h.rejected(state => getTask(state, 'room', 'root-live'), 'unavailable')
})

it('applies scoped interruption only to the authorized room aliases and attempts, keeping decisions immutable', () => {
  const h = new Harness(fixture(['room', 'other']))
  h.step(state => { addTask(state.rooms[0]!, 'scope', 1, 'running'); addTask(state.rooms[1]!, 'scope-other', 2, 'running') })
  h.step(state => { state.rooms[0]!.aliases = ['previous' as Room['id']] })
  const keys = [
    { roomId: 'room', messageId: 'run-scope', callId: 'one' },
    { roomId: 'previous', messageId: 'run-scope', callId: 'two' },
    { roomId: 'other', messageId: 'run-scope-other', callId: 'one' },
  ]
  for (const key of keys) h.step((state, now) => { beginOperation(state, { ...key, name: 'external_write' }, now) })
  const roomScope = scope(h.state, getTask(h.state, 'room', 'root-scope'))
  h.step((state, now) => { expect(interruptOperations(state, now, roomScope)).toBe(2); read(state, 'run-scope').status = 'interrupted' })
  expect(h.state.taskOperations!.operations.map(operation => operation.status)).toEqual(['unknown', 'unknown', 'started'])
  h.step((state, now) => { expect(interruptOperations(state, now, roomScope)).toBe(0) })
  h.step((state, now) => { expect(interruptOperations(state, now, { roomIds: [] })).toBe(0) })
  h.step((state, now) => { expect(interruptOperations(state, now, { roomIds: ['other'], messageIds: [] })).toBe(0) })
  h.step((state, now) => resolveOperation(state, { ...keys[0]!, resolution: 'verified_not_applied' }, now))
  expect(hasUnknownOperations(h.state, roomScope)).toBe(true)
  h.step((state, now) => resolveOperation(state, { ...keys[1]!, resolution: 'verified_applied' }, now))
  expect(hasUnknownOperations(h.state, roomScope)).toBe(false)
  expect(hasUnknownOperations(h.state, { roomIds: ['other'] })).toBe(true)
  h.rejected(state => finishOperation(state, keys[0]!, 'returned', h.now), 'cannot be overwritten')
  h.rejected(state => beginOperation(state, { ...keys[1]!, name: 'external_write' }, h.now), 'already dispatched')
  h.step((state, now) => { interruptOperations(state, now); read(state, 'run-scope-other').status = 'interrupted' })
  expect(h.state.taskOperations!.operations.slice(0, 2).map(operation => operation.resolution?.outcome)).toEqual(['verified_not_applied', 'verified_applied'])
})
