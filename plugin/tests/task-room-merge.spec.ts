/** External-room merges keep one task per canonical human message without losing audit or restrictions. */
import { expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mergeExternalRooms } from '../src/external-rooms.ts'
import { mergeRoomTasks, reconcileTasks, requestTaskCancellation, verifyTask, TASK_EVENT_LIMIT, type TaskRecord, type TaskState } from '../src/task-ledger.ts'
import type { BotId, ChatMessageId, Room, RoomId } from '../src/types.ts'

const bot = (id: string) => brandString<BotId>(id)
const msg = (id: string) => brandString<ChatMessageId>(id)
function room(id: string, target: string, answered = true): Room {
  return { id: brandString<RoomId>(id), title: `Team · ${target}`, kind: 'group', defaultBot: bot(target),
    external: { provider: 'feishu', accountId: `cli_${target}`, kind: 'group', id: 'oc_shared' },
    members: [{ botId: bot(target), sessionId: SessionId(`session-${target}`), cursor: 2 }],
    messages: [
      { id: msg(`user-${target}`), botId: null, text: 'same human message', replyTo: null, status: 'complete', error: null, time: 10,
        external: { id: 'om_shared', sender: { id: `ou_${target}_owner`, name: 'Owner' } } },
      ...answered ? [{ id: msg(`answer-${target}`), botId: bot(target), text: `answer ${target}`, replyTo: msg(`user-${target}`), status: 'complete' as const, error: null, time: target === 'alpha' ? 11 : 12 }] : [],
    ] }
}
const answer = (state: TaskState, roomIndex: number) => state.rooms[roomIndex]!.messages.find(item => item.botId !== null)!

it('rejects a merge whose duplicate deliveries carry different task policies, leaving state untouched', () => {
  const one = room('one', 'alpha'), two = room('two', 'beta')
  one.messages[0]!.taskPolicy = { fileMode: 'read-only' }
  const state: TaskState = { bots: [], rooms: [one, two] }
  reconcileTasks(state, 20)
  const saved = structuredClone(state)
  expect(() => mergeExternalRooms(state, 'oc_shared', 'feishu', 30)).toThrow('Conflicting task policy')
  expect(state).toEqual(saved)
  two.messages[0]!.taskPolicy = { fileMode: 'workspace-write' }
  expect(() => mergeExternalRooms(state, 'oc_shared', 'feishu', 30)).toThrow('Conflicting task policy')
  expect(state.rooms).toHaveLength(2)
})

it('merges equal policies and moves a task tracked only under the eliminated root to the canonical root', () => {
  const one = room('one', 'alpha', false), two = room('two', 'beta')
  one.messages[0]!.taskPolicy = { fileMode: 'read-only', tools: ['read_chat'] }
  two.messages[0]!.taskPolicy = { fileMode: 'read-only', tools: ['read_chat'] }
  const state: TaskState = { bots: [], rooms: [one, two] }
  reconcileTasks(state, 20)
  expect(state.taskLedger!.tasks.map(task => [task.roomId, task.id])).toEqual([['two', 'user-beta']])
  const merged = mergeExternalRooms(state, 'oc_shared', 'feishu', 30)!
  expect(merged.messages.filter(item => item.botId === null)).toMatchObject([{ id: 'user-alpha', taskPolicy: { fileMode: 'read-only', tools: ['read_chat'] } }])
  expect(state.taskLedger!.tasks).toMatchObject([{ id: 'user-alpha', rootMessageId: 'user-alpha', roomId: 'one', status: 'awaiting_verification', runs: [{ id: 'answer-beta' }] }])
  const settled = structuredClone(state.taskLedger)
  reconcileTasks(state, 40)
  expect(state.taskLedger).toEqual(settled)
})

it('coalesces both root tasks, keeps the cancellation audit and invalidates partial verification', () => {
  const state: TaskState = { bots: [], rooms: [room('one', 'alpha'), room('two', 'beta')] }
  answer(state, 1).status = 'running'
  reconcileTasks(state, 20)
  verifyTask(state, 'one', 'user-alpha', 'accepted', 21)
  expect(requestTaskCancellation(state, 'two', 'user-beta', 22)).toEqual(['answer-beta'])
  answer(state, 1).status = 'complete'
  reconcileTasks(state, 23)
  const before = structuredClone(state.taskLedger!.tasks)
  const merged = mergeExternalRooms(state, 'oc_shared', 'feishu', 30)!
  const tasks = state.taskLedger!.tasks
  expect(tasks).toHaveLength(1)
  const task = tasks[0]!
  expect(task).toMatchObject({ id: 'user-alpha', rootMessageId: 'user-alpha', roomId: merged.id, status: 'awaiting_verification', cancelRequestedAt: 22 })
  expect(task.verification).toBeUndefined()
  expect(task.runs.map(run => run.id)).toEqual(['answer-alpha', 'answer-beta'])
  expect(task.events.map(item => item.sequence)).toEqual(task.events.map((_, index) => index + 1))
  expect(task.nextSequence).toBe(task.events.length + 1)
  expect(task.events.filter(item => item.kind === 'cancel_requested')).toEqual([expect.objectContaining({ time: 22 })])
  expect(task.events.filter(item => item.kind === 'verification')).toHaveLength(1)
  expect(task.events.at(-2)).toMatchObject({ kind: 'merged', time: 30 })
  expect(task.events.at(-1)).toMatchObject({ kind: 'status', status: 'awaiting_verification', time: 30 })
  expect(task.events.length).toBe(before.reduce((sum, item) => sum + item.events.length, 0) + 2)
  const settled = structuredClone(state.taskLedger)
  reconcileTasks(state, 40)
  expect(state.taskLedger).toEqual(settled)
  expect(state.taskOperations).toBeUndefined()
})

it('keeps operation receipts in their original room and the merged task protected from pruning', () => {
  const state: TaskState = { bots: [], rooms: [room('one', 'alpha'), room('two', 'beta')],
    taskOperations: { version: 1, operations: [{ id: 'op', roomId: 'two', messageId: 'answer-beta', callId: 'call', name: 'send', status: 'unknown', startedAt: 12 }] } }
  reconcileTasks(state, 20)
  mergeExternalRooms(state, 'oc_shared', 'feishu', 30)
  expect(state.taskOperations!.operations[0]).toMatchObject({ roomId: 'two', messageId: 'answer-beta' })
  expect(state.taskLedger!.tasks).toMatchObject([{ id: 'user-alpha', roomId: 'one' }])
  expect(state.taskLedger!.tasks[0]!.runs.map(run => run.id)).toContain('answer-beta')
})

it('caps coalesced events while summing what each side had already dropped', () => {
  const task = (id: string, start: number, dropped: number): TaskRecord => ({ id, rootMessageId: id, roomId: id === 'a' ? 'one' : 'two', createdAt: start, updatedAt: start + 200,
    status: 'awaiting_verification', runs: [{ id: `run-${id}`, botId: 'worker', status: 'complete', createdAt: start, updatedAt: start, resultIds: [], awaiting: [] }], droppedEvents: dropped, nextSequence: 201,
    events: Array.from({ length: 200 }, (_, index) => ({ sequence: index + 1, time: start + index, kind: 'run' as const })) })
  const ledger = { version: 1 as const, tasks: [task('a', 0, 3), task('b', 1, 4)], retiredBefore: {} }
  const result = mergeRoomTasks(ledger, new Set(['one', 'two']), 'one', new Map([['b', 'a']]), 500)
  expect(ledger.tasks).toHaveLength(2)
  const merged = result.tasks[0]!
  expect(result.tasks).toHaveLength(1)
  expect(merged.events).toHaveLength(TASK_EVENT_LIMIT)
  // 400 combined events plus the merge marker exceed the cap by 145; 7 were already dropped.
  expect(merged.droppedEvents).toBe(3 + 4 + 401 - TASK_EVENT_LIMIT)
  expect(merged.events.at(-1)).toMatchObject({ kind: 'merged', time: 500 })
  expect(merged.events.at(-1)!.sequence).toBe(merged.nextSequence - 1)
})

it('merges legacy state without creating a ledger', () => {
  const state: TaskState = { bots: [], rooms: [room('one', 'alpha'), room('two', 'beta')] }
  mergeExternalRooms(state, 'oc_shared')
  expect(state.rooms).toHaveLength(1)
  expect('taskLedger' in state).toBe(false)
})
