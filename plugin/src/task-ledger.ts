/** Durable task identity and bounded lifecycle metadata; never duplicate prompts or tool payloads. */
import { z } from 'zod'
import { isDeepStrictEqual } from 'node:util'
import type { BotState, ChatMessage, Room } from './types.ts'

import type { TaskLedger, TaskRecord, TaskRun, TaskEvent, TaskStatus, RunStatus } from './task-types.ts'
import type { OperationState } from './task-operation-types.ts'
export type * from './task-types.ts'

export type TaskState = BotState & OperationState & { taskLedger?: TaskLedger | undefined }
export const TASK_EVENT_LIMIT = 256
export const TASK_TERMINAL_LIMIT = 256
const taskStatuses = ['queued', 'running', 'waiting', 'awaiting_verification', 'verified', 'failed', 'canceled', 'interrupted'] as const
const runStatuses = ['queued', 'running', 'waiting', 'complete', 'failed', 'canceled', 'interrupted'] as const
const stamp = z.number().finite()
const runSchema: z.ZodType<TaskRun> = z.object({ id: z.string(), botId: z.string(), status: z.enum(runStatuses), createdAt: stamp, updatedAt: stamp,
  sessionId: z.string().optional(), parentRunId: z.string().optional(), continuationOf: z.string().optional(), retryOf: z.string().optional(),
  continuedBy: z.string().optional(), resultIds: z.array(z.string()), awaiting: z.array(z.string()) })
const taskSchema: z.ZodType<TaskRecord> = z.object({ id: z.string(), roomId: z.string(), rootMessageId: z.string(), createdAt: stamp, updatedAt: stamp,
  status: z.enum(taskStatuses), runs: z.array(runSchema), events: z.array(z.object({ sequence: z.number().int().positive(), time: stamp,
    kind: z.enum(['created', 'run', 'status', 'verification', 'cancel_requested', 'merged']), runId: z.string().optional(), status: z.enum([...taskStatuses, 'complete']).optional() })).max(TASK_EVENT_LIMIT),
  nextSequence: z.number().int().positive(), droppedEvents: z.number().int().nonnegative(), cancelRequestedAt: stamp.optional(),
  verification: z.object({ outcome: z.enum(['accepted', 'rejected']), time: stamp }).optional() })
export const taskLedgerSchema: z.ZodType<TaskLedger> = z.object({ version: z.literal(1), tasks: z.array(taskSchema),
  retiredBefore: z.record(z.string(), z.object({ time: stamp, id: z.string() })) })

function event(task: TaskRecord, item: Omit<TaskEvent, 'sequence'>): void {
  task.events.push({ ...item, sequence: task.nextSequence++ })
  if (task.events.length > TASK_EVENT_LIMIT) task.droppedEvents += task.events.splice(0, task.events.length - TASK_EVENT_LIMIT).length
  task.updatedAt = item.time
}
function active(status: TaskStatus | RunStatus): boolean { return ['queued', 'running', 'waiting'].includes(status) }
// Binary ID order is locale-independent: a persisted fence must not change across hosts.
function order(a: { time: number; id: string }, b: { time: number; id: string }): number { return a.time - b.time || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) }
function roomFor(state: TaskState, roomId: string): Room {
  const room = state.rooms.find(item => item.id === roomId || item.aliases?.some(alias => alias === roomId))
  if (!room || room.deleted) throw new Error('Chat is unavailable')
  return room
}
function belongs(task: TaskRecord, room: Room): boolean { return task.roomId === room.id || !!room.aliases?.some(alias => alias === task.roomId) }
function stateOf(message: ChatMessage): RunStatus {
  if (message.status === 'complete' && message.awaiting?.length && !message.continuedBy && message.collaborationCanceled) return 'canceled'
  if (message.status === 'complete' && message.awaiting?.length && !message.continuedBy && !message.collaborationCanceled) return 'waiting'
  return message.status
}
function leafRuns(task: TaskRecord): TaskRun[] {
  // Replaced attempts stay in the audit trail but no longer determine the current outcome.
  const superseded = new Set(task.runs.flatMap(run => [run.continuationOf, run.retryOf].filter((id): id is string => !!id)))
  return task.runs.filter(run => !superseded.has(run.id))
}
function updateStatus(task: TaskRecord, now: number): void {
  const leaves = leafRuns(task), statuses = leaves.map(run => run.status)
  // Cancellation is an intent, not evidence of a stopped tool. A late complete result stays
  // awaiting_verification; failures/interruption remain explicit. This also allows a human retry.
  let next: TaskStatus = statuses.includes('running') ? 'running' : statuses.includes('queued') ? 'queued'
    : statuses.includes('waiting') ? 'waiting'
      : statuses.includes('interrupted') ? 'interrupted' : statuses.includes('failed') ? 'failed'
        : statuses.includes('canceled') ? 'canceled' : leaves.length ? 'awaiting_verification' : 'queued'
  if (next === 'awaiting_verification' && task.verification) next = task.verification.outcome === 'accepted' ? 'verified' : 'failed'
  if (task.status !== next) { task.status = next; event(task, { kind: 'status', status: next, time: now }) }
}

/** Reconcile inside the owning state transaction BEFORE history compaction. Idempotent on unchanged messages. */
export function reconcileTasks(state: TaskState, now = Date.now()): void {
  const ledger = state.taskLedger ??= { version: 1, tasks: [], retiredBefore: {} }
  for (const room of state.rooms) {
    // Room merges preserve authority through explicit aliases, not matching titles or platform IDs.
    for (const alias of room.aliases ?? []) {
      const oldFence = ledger.retiredBefore[alias]
      if (oldFence && (!ledger.retiredBefore[room.id] || order(ledger.retiredBefore[room.id]!, oldFence) < 0)) ledger.retiredBefore[room.id] = oldFence
      delete ledger.retiredBefore[alias]
    }
    for (const task of ledger.tasks) if (belongs(task, room)) task.roomId = room.id
    // Keep reconciliation reachable even when execution is terminal or its messages have been
    // archived. Scope receipts to explicit room aliases; never mutate their original identity.
    const roomIds = new Set<string>([room.id, ...room.aliases ?? []])
    const unresolvedRuns = new Set((state.taskOperations?.operations ?? [])
      .filter(operation => roomIds.has(operation.roomId) && (operation.status === 'started' || operation.status === 'unknown' && !operation.resolution))
      .map(operation => operation.messageId))
    const byId = new Map(room.messages.map(message => [message.id as string, message]))
    // Observe only actual response attempts; a stored human note is not automatically executable work.
    const groups = new Map<string, ChatMessage[]>()
    for (const message of room.messages) {
      if (message.botId === null) continue
      const rootId = message.delegation?.rootId ?? message.replyTo
      if (!rootId) continue
      const root = byId.get(rootId)
      if (root && root.botId !== null) continue
      if (!root && !ledger.tasks.some(task => belongs(task, room) && task.id === rootId)) continue
      const rows = groups.get(rootId) ?? []; rows.push(message); groups.set(rootId, rows)
    }
    for (const [rootId, messages] of groups) {
      let task = ledger.tasks.find(item => belongs(item, room) && item.id === rootId)
      const root = byId.get(rootId)
      if (!task) {
        if (!root) continue
        const fence = ledger.retiredBefore[room.id]
        if (fence && order(root, fence) <= 0 && !messages.some(message => active(stateOf(message)) || unresolvedRuns.has(message.id))) continue
        task = { id: rootId, rootMessageId: rootId, roomId: room.id, createdAt: root.time, updatedAt: now,
          status: 'queued', runs: [], events: [], nextSequence: 1, droppedEvents: 0 }
        ledger.tasks.push(task); event(task, { kind: 'created', status: 'queued', time: now })
      }
      task.roomId = room.id
      for (const message of messages) {
        const previous = task.runs.find(run => run.id === message.id)
        const retryOf = (message as ChatMessage & { retryOf?: string }).retryOf
        const projected: TaskRun = { id: message.id, botId: message.botId!, status: stateOf(message), createdAt: message.time,
          updatedAt: previous?.updatedAt ?? now, resultIds: [...message.resultIds ?? []], awaiting: [...message.awaiting ?? []],
          ...(message.executionSessionId ? { sessionId: message.executionSessionId } : {}),
          ...(message.delegation && message.replyTo && message.replyTo !== rootId ? { parentRunId: message.replyTo } : {}),
          ...(message.continuationOf ? { continuationOf: message.continuationOf } : {}), ...(retryOf ? { retryOf } : {}),
          ...(message.continuedBy ? { continuedBy: message.continuedBy } : {}) }
        if (!previous || !isDeepStrictEqual(previous, projected)) {
          projected.updatedAt = now
          // New work or a changed execution invalidates acceptance; identical snapshots do not.
          delete task.verification
          if (previous) task.runs[task.runs.indexOf(previous)] = projected
          else task.runs.push(projected)
          event(task, { kind: 'run', runId: message.id, status: projected.status, time: now })
        }
      }
      updateStatus(task, now)
    }
    // Preserve active tasks and every run with an unresolved external operation, including
    // superseded attempts. The terminal cap applies only after reconciliation is settled.
    const terminal = ledger.tasks.filter(task => belongs(task, room) && !active(task.status) && !task.runs.some(run => unresolvedRuns.has(run.id))).sort((a, b) => order({ time: b.createdAt, id: b.id }, { time: a.createdAt, id: a.id }))
    const retired = terminal.slice(TASK_TERMINAL_LIMIT)
    if (retired.length) {
      const fence = retired.map(task => ({ time: task.createdAt, id: task.id })).sort(order).at(-1)!
      if (!ledger.retiredBefore[room.id] || order(ledger.retiredBefore[room.id]!, fence) < 0) ledger.retiredBefore[room.id] = fence
      const removed = new Set(retired); ledger.tasks = ledger.tasks.filter(task => !removed.has(task))
    }
  }
}

/** Detached, room-scoped metadata only. Caller must apply the same authorization as reading the room. */
export function listTasks(state: TaskState, roomId: string, limit = 50): TaskRecord[] {
  const room = roomFor(state, roomId)
  if (!Number.isInteger(limit) || limit < 1 || limit > TASK_TERMINAL_LIMIT) throw new Error('Invalid task list limit')
  return structuredClone((state.taskLedger?.tasks ?? []).filter(task => belongs(task, room))
    .sort((a, b) => b.updatedAt - a.updatedAt || b.id.localeCompare(a.id)).slice(0, limit))
}
export function getTask(state: TaskState, roomId: string, taskId: string): TaskRecord {
  const room = roomFor(state, roomId), task = state.taskLedger?.tasks.find(item => belongs(item, room) && item.id === taskId)
  if (!task) throw new Error('Task is unavailable in this chat')
  return structuredClone(task)
}
/** Mark cancellation intent in the same commit as queued-message cancellation; does not replay/abort tools itself. */
export function requestTaskCancellation(state: TaskState, roomId: string, taskId: string, now = Date.now()): string[] {
  const view = getTask(state, roomId, taskId), task = state.taskLedger!.tasks.find(item => item.roomId === view.roomId && item.id === view.id)!
  if (!active(task.status)) return []
  if (task.cancelRequestedAt === undefined) { task.cancelRequestedAt = now; event(task, { kind: 'cancel_requested', time: now }) }
  return leafRuns(task).filter(run => active(run.status)).map(run => run.id)
}
/** Human acceptance only. An explicit rejection is recorded as failed without mutating model response history. */
export function verifyTask(state: TaskState, roomId: string, taskId: string, outcome: 'accepted' | 'rejected', now = Date.now()): TaskRecord {
  if (!['accepted', 'rejected'].includes(outcome)) throw new Error('Invalid verification outcome')
  const view = getTask(state, roomId, taskId), task = state.taskLedger!.tasks.find(item => item.roomId === view.roomId && item.id === view.id)!
  if (task.verification?.outcome === outcome) return structuredClone(task)
  if (task.status !== 'awaiting_verification') throw new Error('Only finished work awaiting verification can be reviewed')
  task.verification = { outcome, time: now }; event(task, { kind: 'verification', status: outcome === 'accepted' ? 'verified' : 'failed', time: now })
  updateStatus(task, now)
  return structuredClone(task)
}

/** Return a merged copy of the ledger for an external-room merge; the caller commits it atomically.
 * Tasks owned by `roomIds` move to `targetRoomId`. Eliminated duplicate roots fold into their canonical
 * root: runs are unioned, events re-sequenced in time order within the retention cap, the earliest
 * cancellation intent is kept, and any prior human verification is invalidated.
 */
export function mergeRoomTasks(ledger: TaskLedger, roomIds: ReadonlySet<string>, targetRoomId: string,
  rootAliases: ReadonlyMap<string, string>, now = Date.now()): TaskLedger {
  const next = structuredClone(ledger), groups = new Map<string, TaskRecord[]>(), kept: TaskRecord[] = []
  for (const task of next.tasks) {
    if (!roomIds.has(task.roomId)) { kept.push(task); continue }
    const id = rootAliases.get(task.id) ?? task.id
    const rows = groups.get(id) ?? []; rows.push(task); groups.set(id, rows)
  }
  for (const [id, rows] of groups) {
    const renamed = rows.some(task => task.id !== id)
    if (!renamed && rows.length === 1) { rows[0]!.roomId = targetRoomId; kept.push(rows[0]!); continue }
    const base = rows.find(task => task.id === id) ?? [...rows].sort((a, b) => order({ time: a.createdAt, id: a.id }, { time: b.createdAt, id: b.id }))[0]!
    const runs = new Map<string, TaskRun>()
    for (const run of rows.flatMap(task => task.runs)) {
      const prior = runs.get(run.id)
      if (!prior || prior.updatedAt < run.updatedAt) runs.set(run.id, run)
    }
    // Keep each task's own sequence order while interleaving by time; ties follow the canonical task.
    const events = rows.flatMap((task, rank) => task.events.map(item => ({ item, rank: task === base ? -1 : rank })))
      .sort((a, b) => a.item.time - b.item.time || a.rank - b.rank || a.item.sequence - b.item.sequence)
    const cancels = rows.map(task => task.cancelRequestedAt).filter((time): time is number => time !== undefined)
    const merged: TaskRecord = { id, rootMessageId: id, roomId: targetRoomId, createdAt: Math.min(...rows.map(task => task.createdAt)),
      updatedAt: Math.max(...rows.map(task => task.updatedAt)), status: base.status,
      runs: [...runs.values()].sort((a, b) => order({ time: a.createdAt, id: a.id }, { time: b.createdAt, id: b.id })),
      events: events.map(({ item }, index) => ({ ...item, sequence: index + 1 })), nextSequence: events.length + 1,
      droppedEvents: rows.reduce((sum, task) => sum + task.droppedEvents, 0),
      ...(cancels.length ? { cancelRequestedAt: Math.min(...cancels) } : {}) }
    if (merged.events.length > TASK_EVENT_LIMIT) merged.droppedEvents += merged.events.splice(0, merged.events.length - TASK_EVENT_LIMIT).length
    // A review covered only part of the coalesced attempts, so it can no longer stand for the whole task.
    event(merged, { kind: 'merged', time: now })
    updateStatus(merged, now)
    kept.push(merged)
  }
  next.tasks = kept
  return next
}
