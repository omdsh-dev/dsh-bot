/** Metadata-only dispatch intents. A tool return is NOT proof of an external business outcome. */
import { z } from 'zod'

import type { OperationKey, OperationScope, OperationState, ResolveOperationRequest, TaskOperationLedger, ToolOperation } from './task-operation-types.ts'
export type * from './task-operation-types.ts'

/**
 * Refuse new dispatches rather than silently evict uncertain operations or duplicate protection.
 * There is deliberately no runtime GC or rotation, including for returned/reconciled receipts:
 * deleting them would lose duplicate protection. Capacity requires operator maintenance or a
 * future durable archive; increasing capacity must preserve the journal, never clear unknown work.
 */
export const MAX_OPERATIONS_PER_ATTEMPT = 512
export const MAX_OPERATION_RECORDS = 50000
const identity = z.string().min(1).max(1024)
const timestamp = z.number().finite().nonnegative()
const scopeSchema = z.object({ roomIds: z.array(identity), messageIds: z.array(identity).optional() }).strict()
export const taskOperationSchema: z.ZodType<ToolOperation> = z.object({
  id: z.string(), roomId: identity, messageId: identity, callId: identity, name: identity,
  status: z.enum(['started', 'returned', 'unknown']), startedAt: timestamp, finishedAt: timestamp.optional(),
  resolution: z.object({ outcome: z.enum(['verified_applied', 'verified_not_applied']), time: timestamp }).optional(),
}).superRefine((operation, ctx) => {
  if (operation.id !== operationId(operation)) ctx.addIssue({ code: 'custom', message: 'Operation identity does not match its scope' })
  if (operation.status === 'started' && operation.finishedAt !== undefined || operation.status !== 'started' && operation.finishedAt === undefined) {
    ctx.addIssue({ code: 'custom', message: 'Invalid operation settlement timestamp' })
  }
  if (operation.finishedAt !== undefined && operation.finishedAt < operation.startedAt) ctx.addIssue({ code: 'custom', message: 'Invalid operation time ordering' })
  if (operation.resolution && (operation.status !== 'unknown' || operation.resolution.time < operation.finishedAt!)) {
    ctx.addIssue({ code: 'custom', message: 'Only settled unknown operations can be reconciled' })
  }
})
export const taskOperationLedgerSchema: z.ZodType<TaskOperationLedger> = z.object({
  version: z.literal(1), operations: z.array(taskOperationSchema).max(MAX_OPERATION_RECORDS),
}).superRefine((ledger, ctx) => {
  const ids = new Set<string>(), attempts = new Map<string, number>()
  for (const operation of ledger.operations) {
    if (ids.has(operation.id)) ctx.addIssue({ code: 'custom', message: 'Duplicate operation identity' })
    ids.add(operation.id)
    const key = JSON.stringify([operation.roomId, operation.messageId]), count = (attempts.get(key) ?? 0) + 1
    attempts.set(key, count)
    if (count === MAX_OPERATIONS_PER_ATTEMPT + 1) ctx.addIssue({ code: 'custom', message: 'Too many operations in one attempt' })
  }
})

/** JSON tuple avoids separator collisions and object-key/prototype hazards. */
export function operationId(key: OperationKey): string { return JSON.stringify([key.roomId, key.messageId, key.callId]) }
function validateKey(key: OperationKey): void { for (const value of [key.roomId, key.messageId, key.callId]) identity.parse(value) }
function findOperation(state: OperationState, key: OperationKey): ToolOperation {
  validateKey(key)
  const operation = state.taskOperations?.operations.find(item => item.id === operationId(key))
  if (!operation) throw new Error('Tool operation not found in this chat and response')
  return operation
}

/** Call inside an atomic state transaction and AWAIT ITS COMMIT before dispatching any tool body. */
export function beginOperation(state: OperationState, input: OperationKey & { name: string }, now = Date.now()): ToolOperation {
  validateKey(input); identity.parse(input.name); timestamp.parse(now)
  const operations = state.taskOperations?.operations ?? [], id = operationId(input)
  if (operations.some(item => item.id === id)) throw new Error('This tool operation was already dispatched; inspect its receipt instead of replaying it')
  if (operations.length >= MAX_OPERATION_RECORDS) throw new Error('Tool operation journal is full; new dispatches are blocked to preserve reconciliation records')
  if (operations.filter(item => item.roomId === input.roomId && item.messageId === input.messageId).length >= MAX_OPERATIONS_PER_ATTEMPT) {
    throw new Error('This response reached the tool-operation limit')
  }
  // Explicit field copy: arguments, outputs, exception text and credentials must never enter this ledger.
  const operation: ToolOperation = { id, roomId: input.roomId, messageId: input.messageId, callId: input.callId,
    name: input.name, status: 'started', startedAt: now }
  state.taskOperations ??= { version: 1, operations: [] }
  state.taskOperations.operations.push(operation)
  return structuredClone(operation)
}

/** isError returns, thrown failures and cancellation are all unknown, not verified no-op failures. */
export function finishOperation(state: OperationState, key: OperationKey, outcome: 'returned' | 'unknown', now = Date.now()): void {
  timestamp.parse(now)
  if (outcome !== 'returned' && outcome !== 'unknown') throw new Error('Invalid tool operation outcome')
  const operation = findOperation(state, key)
  if (operation.status === outcome) return // Idempotent receipt persistence; never change an operator decision.
  if (operation.status !== 'started') throw new Error('A settled tool operation cannot be overwritten')
  operation.status = outcome; operation.finishedAt = Math.max(now, operation.startedAt)
}

function scopeMatcher(scope: OperationScope): (operation: ToolOperation) => boolean {
  const validated = scopeSchema.parse(scope), rooms = new Set(validated.roomIds)
  const messages = validated.messageIds === undefined ? undefined : new Set(validated.messageIds)
  return operation => rooms.has(operation.roomId) && (messages === undefined || messages.has(operation.messageId))
}

/**
 * Startup recovery never executes tools. Omit scope ONLY for whole-process startup; on run
 * cancellation/settlement pass the authorized room IDs (including aliases) and attempt IDs.
 * This closes pending intents conservatively, not proof that an external tool stopped. A late
 * returned receipt cannot overwrite unknown/reconciled state; finishOperation rejects it.
 */
export function interruptOperations(state: OperationState, now = Date.now(), scope?: OperationScope): number {
  timestamp.parse(now)
  const matches = scope === undefined ? () => true : scopeMatcher(scope)
  let changed = 0
  for (const operation of state.taskOperations?.operations ?? []) if (operation.status === 'started' && matches(operation)) {
    operation.status = 'unknown'; operation.finishedAt = Math.max(now, operation.startedAt); changed++
  }
  return changed
}

/** Includes still-running intents, since neither pending nor unresolved unknown work is safe to replay. */
export function hasUnknownOperations(state: OperationState, scope: OperationScope): boolean {
  const matches = scopeMatcher(scope)
  return (state.taskOperations?.operations ?? []).some(operation => matches(operation)
    && (operation.status === 'started' || operation.status === 'unknown' && !operation.resolution))
}

/** Detached and scoped: no cross-room operation lookup and no live mutable ledger returned to clients. */
export function operationsFor(state: OperationState, roomId: string, messageId?: string): ToolOperation[] {
  identity.parse(roomId); if (messageId !== undefined) identity.parse(messageId)
  return structuredClone((state.taskOperations?.operations ?? []).filter(item => item.roomId === roomId && (messageId === undefined || item.messageId === messageId)))
}

/** Acknowledgment records operator evidence only; it grants neither replay nor any extra capability. */
export function resolveOperation(state: OperationState, request: ResolveOperationRequest, now = Date.now()): void {
  timestamp.parse(now)
  if (request.resolution !== 'verified_applied' && request.resolution !== 'verified_not_applied') throw new Error('Invalid operation resolution')
  const operation = findOperation(state, request)
  if (operation.status !== 'unknown') throw new Error('Only unknown tool operations need reconciliation')
  if (operation.resolution) {
    if (operation.resolution.outcome !== request.resolution) throw new Error('A tool operation reconciliation cannot be changed')
    return
  }
  operation.resolution = { outcome: request.resolution, time: Math.max(now, operation.finishedAt!) }
}

/** Retry remains explicit. Even an applied operation may be repeated by a new model turn. */
export function assertOperationsReconciled(state: OperationState, roomId: string, messageId: string): void {
  if (hasUnknownOperations(state, { roomIds: [roomId], messageIds: [messageId] })) {
    throw new Error('This response has uncertain tool operations; inspect external effects and reconcile them before retrying')
  }
}
