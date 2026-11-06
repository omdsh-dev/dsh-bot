import { expect, it } from 'vitest'
import { botDomain } from '../src/domain.ts'
import { getTask, listTasks, reconcileTasks, requestTaskCancellation, taskLedgerSchema, verifyTask, TASK_EVENT_LIMIT, TASK_TERMINAL_LIMIT, type TaskState } from '../src/task-ledger.ts'
import type { ChatMessage, ChatMessageId } from '../src/types.ts'

function fixture(): TaskState {
  return botDomain.global.schema.parse({ bots: [], rooms: [{ id: 'room', title: 'Chat', kind: 'group', defaultBot: 'worker', members: [], messages: [
    { id: 'root', botId: null, replyTo: null, status: 'complete', text: 'PRIVATE_REQUEST', time: 1, error: null, allowDelegation: true },
    { id: 'run', botId: 'worker', replyTo: 'root', status: 'queued', text: '', time: 2, error: null },
  ] }] })
}
const message = (state: TaskState, id: string) => state.rooms[0]!.messages.find(item => item.id === id)!
function child(state: TaskState, id: string, status: ChatMessage['status'] = 'queued'): ChatMessage {
  const result = { ...message(state, 'run'), id: id as ChatMessageId, botId: 'reviewer' as ChatMessage['botId'], status,
    awaiting: undefined, continuedBy: undefined, continuationOf: undefined, resultIds: undefined, replyTo: 'run' as ChatMessageId, delegation: { rootId: 'root' as ChatMessageId, task: 'PRIVATE_DELEGATION' } }
  state.rooms[0]!.messages.push(result); return result
}

it('records stable task/run identity and only lifecycle changes, not token updates or private payloads', () => {
  const state = fixture()
  reconcileTasks(state, 10)
  const before = structuredClone(state.taskLedger)
  message(state, 'root').text += ' changed'; message(state, 'run').text = 'PRIVATE_ANSWER'
  message(state, 'run').toolDetails = [{ name: 'tool', arguments: 'SECRET_ARGUMENTS', result: 'SECRET_RESULT' }]
  reconcileTasks(state, 11)
  expect(state.taskLedger).toEqual(before)
  expect(getTask(state, 'room', 'root')).toMatchObject({ id: 'root', rootMessageId: 'root', status: 'queued', runs: [{ id: 'run', botId: 'worker', status: 'queued' }] })
  message(state, 'run').status = 'running'
  message(state, 'run').executionSessionId = 'session' as NonNullable<ChatMessage['executionSessionId']>
  reconcileTasks(state, 20)
  expect(getTask(state, 'room', 'root')).toMatchObject({ status: 'running', runs: [{ sessionId: 'session', updatedAt: 20 }] })
  message(state, 'run').status = 'complete'
  reconcileTasks(state, 30)
  expect(getTask(state, 'room', 'root').status).toBe('awaiting_verification')
  const serialized = JSON.stringify(taskLedgerSchema.parse(state.taskLedger))
  for (const secret of ['PRIVATE_REQUEST', 'PRIVATE_ANSWER', 'SECRET_ARGUMENTS', 'SECRET_RESULT']) expect(serialized).not.toContain(secret)
})

it('keeps delegation, callback and retry provenance, never treating a completed dispatcher as a completed task', () => {
  const state = fixture(), parent = message(state, 'run')
  parent.status = 'complete'; parent.awaiting = ['child' as ChatMessageId]
  const delegated = child(state, 'child')
  reconcileTasks(state, 10)
  expect(getTask(state, 'room', 'root')).toMatchObject({ status: 'queued', runs: [{ status: 'waiting' }, { parentRunId: 'run' }] })
  delegated.status = 'failed'
  reconcileTasks(state, 20)
  expect(getTask(state, 'room', 'root').status).toBe('waiting')
  const continuation = child(state, 'callback')
  continuation.continuationOf = parent.id; continuation.resultIds = [delegated.id]; parent.continuedBy = continuation.id
  reconcileTasks(state, 30)
  continuation.status = 'complete'
  reconcileTasks(state, 40)
  expect(getTask(state, 'room', 'root').status).toBe('failed')
  const retry = child(state, 'retry', 'complete') as ChatMessage & { retryOf?: string }
  retry.retryOf = delegated.id
  reconcileTasks(state, 50)
  expect(getTask(state, 'room', 'root')).toMatchObject({ status: 'awaiting_verification' })
  expect(getTask(state, 'room', 'root').runs.find(run => run.id === 'callback')).toMatchObject({ continuationOf: 'run', resultIds: ['child'] })
  expect(getTask(state, 'room', 'root').runs.find(run => run.id === 'retry')).toMatchObject({ retryOf: 'child' })
})

it('persists interrupted work without replay and does not erase references when history is compacted', () => {
  const state = fixture(); message(state, 'run').status = 'running'; reconcileTasks(state, 10)
  state.taskLedger = taskLedgerSchema.parse(state.taskLedger)
  message(state, 'run').status = 'interrupted'; reconcileTasks(state, 20)
  expect(getTask(state, 'room', 'root').status).toBe('interrupted')
  const ledger = structuredClone(state.taskLedger)
  state.rooms[0]!.messages = []; state.rooms[0]!.historyChunks = ['archive-reference']
  reconcileTasks(state, 30)
  expect(state.taskLedger).toEqual(ledger)
})

it('records explicit human verification only and invalidates acceptance when a new attempt is observed', () => {
  const state = fixture(); reconcileTasks(state, 10)
  expect(() => verifyTask(state, 'room', 'root', 'accepted')).toThrow('Only finished')
  message(state, 'run').status = 'complete'; reconcileTasks(state, 20)
  expect(verifyTask(state, 'room', 'root', 'accepted', 30).status).toBe('verified')
  const verified = structuredClone(state.taskLedger); reconcileTasks(state, 40)
  expect(state.taskLedger).toEqual(verified)
  verifyTask(state, 'room', 'root', 'accepted', 50)
  expect(state.taskLedger).toEqual(verified)
  child(state, 'new-work', 'queued'); reconcileTasks(state, 60)
  expect(getTask(state, 'room', 'root').verification).toBeUndefined()
  message(state, 'new-work').status = 'complete'; reconcileTasks(state, 70)
  expect(verifyTask(state, 'room', 'root', 'rejected', 80).status).toBe('failed')
  expect(() => verifyTask(state, 'room', 'root', 'maybe' as 'accepted')).toThrow('Invalid')
})

it('records idempotent cancellation intent without claiming a still-running tool is stopped', () => {
  const state = fixture(); message(state, 'run').status = 'running'; child(state, 'child'); reconcileTasks(state, 10)
  expect(requestTaskCancellation(state, 'room', 'root', 20)).toEqual(['run', 'child'])
  const before = structuredClone(state.taskLedger)
  requestTaskCancellation(state, 'room', 'root', 30)
  expect(state.taskLedger).toEqual(before)
  expect(getTask(state, 'room', 'root')).toMatchObject({ status: 'running', cancelRequestedAt: 20 })
  message(state, 'run').status = 'canceled'; message(state, 'child').status = 'canceled'; reconcileTasks(state, 40)
  expect(getTask(state, 'room', 'root').status).toBe('canceled')
  expect(requestTaskCancellation(state, 'room', 'root', 50)).toEqual([])
})

it('scopes detached queries to existing authorized room boundaries including room aliases', () => {
  const state = fixture(); reconcileTasks(state, 10)
  state.rooms.push({ ...state.rooms[0]!, id: 'other' as typeof state.rooms[0]['id'], messages: [] })
  expect(listTasks(state, 'other')).toEqual([])
  expect(() => getTask(state, 'other', 'root')).toThrow('unavailable')
  const copy = getTask(state, 'room', 'root'); copy.runs.length = 0
  expect(getTask(state, 'room', 'root').runs).toHaveLength(1)
  state.rooms[0]!.aliases = ['old-room' as typeof state.rooms[0]['id']]
  expect(getTask(state, 'old-room', 'root').id).toBe('root')
  expect(() => listTasks(state, 'room', 0)).toThrow('limit')
  expect(() => listTasks(state, 'missing')).toThrow('unavailable')
  state.rooms[0]!.deleted = true
  expect(() => getTask(state, 'room', 'root')).toThrow('unavailable')
})

it('bounds events while preserving monotonic sequence and avoids inventing tasks from orphan responses or notes', () => {
  const state = fixture()
  for (let i = 0; i < TASK_EVENT_LIMIT * 2; i++) { message(state, 'run').status = i % 2 ? 'running' : 'queued'; reconcileTasks(state, i) }
  const task = getTask(state, 'room', 'root')
  expect(task.events).toHaveLength(TASK_EVENT_LIMIT)
  expect(task.droppedEvents).toBeGreaterThan(0)
  expect(task.events[0]!.sequence).toBe(task.droppedEvents + 1)
  expect(task.events.at(-1)!.sequence).toBe(task.nextSequence - 1)
  const orphan = fixture(); orphan.rooms[0]!.messages.shift(); reconcileTasks(orphan)
  expect(orphan.taskLedger!.tasks).toEqual([])
  const note = fixture(); note.rooms[0]!.messages.pop(); reconcileTasks(note)
  expect(note.taskLedger!.tasks).toEqual([])
})

it('caps terminal summaries and fences hydrated old messages while retaining active or explicitly retried old work', () => {
  const state = fixture(), room = state.rooms[0]!, root = message(state, 'root'), run = message(state, 'run')
  room.messages = []
  for (let i = 0; i < TASK_TERMINAL_LIMIT + 10; i++) {
    room.messages.push({ ...root, id: `root-${i}` as ChatMessageId, time: i * 2 },
      { ...run, id: `run-${i}` as ChatMessageId, replyTo: `root-${i}` as ChatMessageId, time: i * 2 + 1, status: 'complete' })
  }
  room.messages[1]!.status = 'running'
  reconcileTasks(state, 1000)
  expect(state.taskLedger!.tasks).toHaveLength(TASK_TERMINAL_LIMIT + 1)
  expect(getTask(state, 'room', 'root-0').status).toBe('running')
  expect(() => getTask(state, 'room', 'root-1')).toThrow('unavailable')
  const snapshot = structuredClone(state.taskLedger)
  reconcileTasks(state, 2000)
  expect(state.taskLedger).toEqual(snapshot)
  room.messages[3]!.status = 'queued'; reconcileTasks(state, 3000)
  expect(getTask(state, 'room', 'root-1').status).toBe('queued')
  expect(state.taskLedger!.tasks).toHaveLength(TASK_TERMINAL_LIMIT + 2)
})

it('retains source-room aliases after merge and reflects a canceled coordinator instead of claiming completed work', () => {
  const state = fixture(); message(state, 'run').status = 'complete'; message(state, 'run').awaiting = ['child' as ChatMessageId]
  child(state, 'child', 'complete'); reconcileTasks(state, 10)
  message(state, 'run').collaborationCanceled = true; reconcileTasks(state, 20)
  expect(getTask(state, 'room', 'root').status).toBe('canceled')
  const room = state.rooms[0]!; room.aliases = [room.id]; room.id = 'merged' as typeof room.id
  room.messages = []; reconcileTasks(state, 30)
  expect(getTask(state, 'room', 'root').roomId).toBe('merged')
  expect(listTasks(state, 'merged')).toHaveLength(1)
})

it('does not turn late completion after a cancellation request into proof the tool stopped', () => {
  const state = fixture(); message(state, 'run').status = 'running'; reconcileTasks(state, 10)
  requestTaskCancellation(state, 'room', 'root', 20)
  message(state, 'run').status = 'complete'; reconcileTasks(state, 30)
  expect(getTask(state, 'room', 'root')).toMatchObject({ status: 'awaiting_verification', cancelRequestedAt: 20, runs: [{ status: 'complete' }] })
  expect(verifyTask(state, 'room', 'root', 'accepted', 40).status).toBe('verified')
})

it('records interruption after cancellation as uncertain, and an explicit retry can finish without stale cancellation winning', () => {
  const state = fixture(); message(state, 'run').status = 'running'; reconcileTasks(state, 10)
  requestTaskCancellation(state, 'room', 'root', 20)
  message(state, 'run').status = 'interrupted'; reconcileTasks(state, 30)
  expect(getTask(state, 'room', 'root').status).toBe('interrupted')
  const retry = { ...message(state, 'run'), id: 'retry' as ChatMessageId, status: 'queued' as const, retryOf: 'run' as ChatMessageId }
  state.rooms[0]!.messages.push(retry); reconcileTasks(state, 40)
  expect(getTask(state, 'room', 'root').status).toBe('queued')
  message(state, 'retry').status = 'complete'; reconcileTasks(state, 50)
  expect(getTask(state, 'room', 'root').status).toBe('awaiting_verification')
})

it('never lets a future-timestamp retention fence suppress old active work, even with clock skew', () => {
  const state = fixture(); reconcileTasks(state, 1)
  const room = state.rooms[0]!, root = message(state, 'root'), run = message(state, 'run')
  room.messages = []
  for (let i = 0; i < TASK_TERMINAL_LIMIT + 10; i++) {
    room.messages.push({ ...root, id: `future-root-${i}` as ChatMessageId, time: 9e15 + i },
      { ...run, id: `future-run-${i}` as ChatMessageId, replyTo: `future-root-${i}` as ChatMessageId, time: 9e15 + i, status: 'complete' })
  }
  reconcileTasks(state, 2)
  expect(state.taskLedger!.retiredBefore.room!.time).toBeGreaterThan(8e15)
  // Previously tracked and newly observed active roots survive a misleading timestamp fence.
  room.messages.push(root, run, { ...root, id: 'fresh-root' as ChatMessageId, time: 0 },
    { ...run, id: 'fresh-run' as ChatMessageId, replyTo: 'fresh-root' as ChatMessageId, time: 0, status: 'running' })
  reconcileTasks(state, 3)
  expect(getTask(state, 'room', 'root').status).toBe('queued')
  expect(getTask(state, 'room', 'fresh-root').status).toBe('running')
  expect(state.taskLedger!.tasks.filter(task => task.status === 'awaiting_verification')).toHaveLength(TASK_TERMINAL_LIMIT)
  const saved = structuredClone(state.taskLedger); reconcileTasks(state, 4)
  expect(state.taskLedger).toEqual(saved)
})

it('pins terminal tasks with unresolved operations, including aliased archived and superseded run references', () => {
  const state = fixture(), room = state.rooms[0]!, root = message(state, 'root'), run = message(state, 'run')
  room.aliases = ['old-room' as typeof room.id]; room.messages = []
  for (let i = 0; i < TASK_TERMINAL_LIMIT + 10; i++) {
    room.messages.push({ ...root, id: `root-${i}` as ChatMessageId, time: i * 2 },
      { ...run, id: `run-${i}` as ChatMessageId, replyTo: `root-${i}` as ChatMessageId, time: i * 2 + 1, status: 'complete' })
  }
  // An explicitly retried attempt can have finished while the original external effect is unknown.
  room.messages.push({ ...run, id: 'retry-1' as ChatMessageId, replyTo: 'root-1' as ChatMessageId,
    retryOf: 'run-1' as ChatMessageId, time: 1000, status: 'complete' })
  state.taskOperations = { version: 1, operations: [
    { id: 'started', roomId: 'room', messageId: 'run-0', callId: 'call0', name: 'tool', status: 'started', startedAt: 1 },
    { id: 'unknown', roomId: 'old-room', messageId: 'run-1', callId: 'call1', name: 'tool', status: 'unknown', startedAt: 1, finishedAt: 2 },
    { id: 'resolved', roomId: 'room', messageId: 'run-2', callId: 'call2', name: 'tool', status: 'unknown', startedAt: 1, finishedAt: 2,
      resolution: { outcome: 'verified_applied', time: 3 } },
    { id: 'returned', roomId: 'room', messageId: 'run-3', callId: 'call3', name: 'tool', status: 'returned', startedAt: 1, finishedAt: 2 },
    { id: 'foreign', roomId: 'private-other-room', messageId: 'run-4', callId: 'call4', name: 'tool', status: 'unknown', startedAt: 1, finishedAt: 2 },
  ] }
  const receipts = structuredClone(state.taskOperations)
  reconcileTasks(state, 2000)
  expect(state.taskLedger!.tasks).toHaveLength(TASK_TERMINAL_LIMIT + 2)
  expect(getTask(state, 'room', 'root-0').status).toBe('awaiting_verification')
  expect(getTask(state, 'old-room', 'root-1').runs.map(item => item.id)).toEqual(['run-1', 'retry-1'])
  for (const id of ['root-2', 'root-3', 'root-4']) expect(() => getTask(state, 'room', id)).toThrow('unavailable')
  expect(state.taskOperations).toEqual(receipts)
  const ledger = structuredClone(state.taskLedger)
  room.messages = []; room.historyChunks = ['archived']
  reconcileTasks(state, 3000)
  expect(state.taskLedger).toEqual(ledger)
  // Once reconciliation is explicitly settled, these old terminal summaries are again evictable.
  Object.assign(state.taskOperations.operations[0]!, { status: 'returned', finishedAt: 3500 })
  state.taskOperations.operations[1]!.resolution = { outcome: 'verified_not_applied', time: 3500 }
  reconcileTasks(state, 4000)
  expect(state.taskLedger!.tasks).toHaveLength(TASK_TERMINAL_LIMIT)
  expect(() => getTask(state, 'room', 'root-0')).toThrow('unavailable')
  expect(() => getTask(state, 'room', 'root-1')).toThrow('unavailable')
})

it('bypasses a retention fence to recover old terminal task references needed for operation reconciliation', () => {
  const state = fixture(), room = state.rooms[0]!
  message(state, 'run').status = 'complete'
  state.taskLedger = { version: 1, tasks: [], retiredBefore: { room: { time: 9e15, id: 'retired' } } }
  reconcileTasks(state, 10)
  expect(state.taskLedger.tasks).toEqual([])
  state.taskOperations = { version: 1, operations: [{ id: 'unknown', roomId: room.id, messageId: 'run', callId: 'call', name: 'tool',
    status: 'unknown', startedAt: 2, finishedAt: 3 }] }
  reconcileTasks(state, 20)
  expect(getTask(state, 'room', 'root')).toMatchObject({ status: 'awaiting_verification', runs: [{ id: 'run' }] })
  const ledger = structuredClone(state.taskLedger)
  reconcileTasks(state, 30)
  expect(state.taskLedger).toEqual(ledger)
})
