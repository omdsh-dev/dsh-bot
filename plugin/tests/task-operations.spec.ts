import { expect, it } from 'vitest'
import { assertOperationsReconciled, beginOperation, finishOperation, hasUnknownOperations, interruptOperations, MAX_OPERATION_RECORDS, MAX_OPERATIONS_PER_ATTEMPT,
  operationId, operationsFor, resolveOperation, taskOperationLedgerSchema, taskOperationSchema, type OperationState } from '../src/task-operations.ts'

const key = { roomId: 'chat', messageId: 'response', callId: 'call' }
const input = { ...key, name: 'create_pr' }

it('stores only detached metadata and stable collision-free call identities', () => {
  const state: OperationState = {}
  const operation = beginOperation(state, { ...input, arguments: 'SECRET', result: 'SECRET' } as typeof input, 100)
  expect(operation).toEqual({ ...input, id: operationId(key), startedAt: 100, status: 'started' })
  expect(JSON.stringify(state)).not.toContain('SECRET')
  operation.name = 'changed'
  const rows = operationsFor(state, 'chat', 'response'); rows[0]!.name = 'changed'
  expect(operationsFor(state, 'chat')[0]!.name).toBe('create_pr')
  expect(operationsFor(state, 'other')).toEqual([])
  expect(operationsFor(state, 'chat', 'other')).toEqual([])
  expect(operationId({ roomId: 'a:b', messageId: 'c', callId: 'd' })).not.toBe(operationId({ roomId: 'a', messageId: 'b:c', callId: 'd' }))
  beginOperation(state, { ...input, callId: 'call:ptc:1' }, 101)
  beginOperation(state, { ...input, messageId: 'response-2' }, 101)
  expect(state.taskOperations!.operations).toHaveLength(3)
})

it('blocks duplicate dispatch for started, returned, and reconciled unknown operations', () => {
  const state: OperationState = {}
  beginOperation(state, input, 100)
  expect(() => beginOperation(state, input)).toThrow('already dispatched')
  expect(() => assertOperationsReconciled(state, 'chat', 'response')).toThrow('uncertain')
  finishOperation(state, key, 'returned', 101)
  expect(() => beginOperation(state, input)).toThrow('already dispatched')
  expect(() => assertOperationsReconciled(state, 'chat', 'response')).not.toThrow()
  const other = { ...input, callId: 'other' }
  beginOperation(state, other, 102); finishOperation(state, other, 'unknown', 103)
  resolveOperation(state, { ...other, resolution: 'verified_not_applied' }, 104)
  expect(() => beginOperation(state, other)).toThrow('already dispatched')
  expect(() => assertOperationsReconciled(state, 'chat', 'response')).not.toThrow()
})

it('crash recovery preserves uncertainty through schema round-trips without replay', () => {
  const state: OperationState = {}
  beginOperation(state, input, 100)
  beginOperation(state, { ...input, callId: 'returned' }, 101)
  finishOperation(state, { ...key, callId: 'returned' }, 'returned', 102)
  const restarted = { taskOperations: taskOperationLedgerSchema.parse(JSON.parse(JSON.stringify(state.taskOperations))) }
  expect(interruptOperations(restarted, 103)).toBe(1)
  expect(interruptOperations(restarted, 104)).toBe(0)
  expect(restarted.taskOperations.operations.map(item => item.status)).toEqual(['unknown', 'returned'])
  expect(() => assertOperationsReconciled(restarted, 'chat', 'response')).toThrow('uncertain')
  resolveOperation(restarted, { ...key, resolution: 'verified_applied' }, 105)
  expect(() => assertOperationsReconciled(restarted, 'chat', 'response')).not.toThrow()
  expect(taskOperationLedgerSchema.parse(restarted.taskOperations)).toEqual(restarted.taskOperations)
})

it('does not confuse a tool return with verified business success and never rewrites settled receipts', () => {
  const state: OperationState = {}
  beginOperation(state, input, 100); finishOperation(state, key, 'returned', 101)
  finishOperation(state, key, 'returned', 102)
  expect(state.taskOperations!.operations[0]).toMatchObject({ status: 'returned', finishedAt: 101 })
  expect(state.taskOperations!.operations[0]!.resolution).toBeUndefined()
  expect(() => finishOperation(state, key, 'unknown', 102)).toThrow('cannot be overwritten')
  expect(() => resolveOperation(state, { ...key, resolution: 'verified_applied' })).toThrow('Only unknown')
})

it('requires explicit scoped reconciliation and refuses mutable or contradictory operator decisions', () => {
  const state: OperationState = {}
  beginOperation(state, input, 100)
  expect(() => resolveOperation(state, { ...key, resolution: 'verified_applied' })).toThrow('Only unknown')
  finishOperation(state, key, 'unknown', 101)
  expect(() => resolveOperation(state, { ...key, roomId: 'other', resolution: 'verified_applied' })).toThrow('not found')
  expect(() => finishOperation(state, { ...key, messageId: 'other' }, 'returned')).toThrow('not found')
  resolveOperation(state, { ...key, resolution: 'verified_not_applied' }, 102)
  resolveOperation(state, { ...key, resolution: 'verified_not_applied' }, 103)
  expect(state.taskOperations!.operations[0]!.resolution).toEqual({ outcome: 'verified_not_applied', time: 102 })
  expect(() => resolveOperation(state, { ...key, resolution: 'verified_applied' })).toThrow('cannot be changed')
  expect(() => resolveOperation(state, { ...key, resolution: 'ignored' as never })).toThrow('Invalid operation resolution')
})

it('rejects excess dispatches without evicting pending records', () => {
  const state: OperationState = {}
  for (let i = 0; i < MAX_OPERATIONS_PER_ATTEMPT; i++) beginOperation(state, { ...input, callId: String(i) }, i)
  const before = structuredClone(state)
  expect(() => beginOperation(state, { ...input, callId: 'overflow' })).toThrow('limit')
  expect(state).toEqual(before)
  expect(taskOperationLedgerSchema.parse(state.taskOperations)).toEqual(state.taskOperations)
  beginOperation(state, { ...input, messageId: 'next' }, 1000)
})

it('fails closed on malformed metadata and journals, and tolerates wall-clock rollback monotonically', () => {
  const state: OperationState = {}
  expect(() => beginOperation(state, { ...input, callId: '' })).toThrow()
  expect(() => beginOperation(state, input, NaN)).toThrow()
  expect(state.taskOperations).toBeUndefined()
  beginOperation(state, input, 100)
  expect(() => finishOperation(state, key, 'failed' as never)).toThrow('Invalid tool operation outcome')
  finishOperation(state, key, 'unknown', 90)
  resolveOperation(state, { ...key, resolution: 'verified_applied' }, 80)
  const row = state.taskOperations!.operations[0]!
  expect(row.finishedAt).toBe(100); expect(row.resolution!.time).toBe(100)
  expect(() => taskOperationSchema.parse({ ...row, id: 'forged' })).toThrow()
  expect(() => taskOperationSchema.parse({ ...row, status: 'started' })).toThrow()
  expect(() => taskOperationSchema.parse({ ...row, finishedAt: 90 })).toThrow()
  expect(() => taskOperationSchema.parse({ ...row, resolution: { outcome: 'verified_applied', time: 90 } })).toThrow()
  expect(() => taskOperationLedgerSchema.parse({ version: 1, operations: [row, row] })).toThrow()
})


it('interrupts only the selected root-task attempts across explicit room aliases', () => {
  const state: OperationState = {}
  const child = { ...input, roomId: 'old-chat', messageId: 'child' }
  const sibling = { ...input, messageId: 'sibling' }
  const elsewhere = { ...input, roomId: 'unrelated' }
  for (const value of [input, child, sibling, elsewhere]) beginOperation(state, value, 100)
  const settled = { ...input, callId: 'returned' }
  beginOperation(state, settled, 100); finishOperation(state, settled, 'returned', 101)
  const scope = { roomIds: ['chat', 'old-chat'], messageIds: ['response', 'child'] }
  expect(interruptOperations(state, 102, scope)).toBe(2)
  expect(interruptOperations(state, 103, scope)).toBe(0)
  expect(operationsFor(state, 'chat', 'response').map(item => item.status)).toEqual(['unknown', 'returned'])
  expect(operationsFor(state, 'old-chat', 'child')[0]!.status).toBe('unknown')
  expect(operationsFor(state, 'chat', 'sibling')[0]!.status).toBe('started')
  expect(operationsFor(state, 'unrelated')[0]!.status).toBe('started')
})

it('treats empty scopes as no matches and validates filters before mutating anything', () => {
  const state: OperationState = {}
  beginOperation(state, input, 100)
  const before = structuredClone(state)
  expect(interruptOperations(state, 101, { roomIds: [] })).toBe(0)
  expect(interruptOperations(state, 101, { roomIds: ['chat'], messageIds: [] })).toBe(0)
  expect(hasUnknownOperations(state, { roomIds: [], messageIds: ['response'] })).toBe(false)
  expect(hasUnknownOperations(state, { roomIds: ['chat'], messageIds: [] })).toBe(false)
  expect(() => interruptOperations(state, 101, {} as never)).toThrow()
  expect(() => interruptOperations(state, 101, { roomIds: ['chat'], messageIds: [''] })).toThrow()
  expect(() => interruptOperations(state, 101, { roomIds: 'chat' } as never)).toThrow()
  expect(() => interruptOperations(state, 101, { roomIds: ['chat'], unexpected: true } as never)).toThrow()
  expect(() => hasUnknownOperations(state, {} as never)).toThrow()
  expect(state).toEqual(before)
})

it('detects unresolved operations for an entire root without widening scope to other tasks or chats', () => {
  const state: OperationState = {}
  const child = { ...input, roomId: 'alias', messageId: 'child' }
  beginOperation(state, input, 100); finishOperation(state, key, 'returned', 101)
  beginOperation(state, child, 100)
  beginOperation(state, { ...input, roomId: 'unrelated' }, 100)
  beginOperation(state, { ...input, messageId: 'different-root' }, 100)
  const scope = { roomIds: ['chat', 'alias'], messageIds: ['response', 'child'] }
  expect(hasUnknownOperations(state, scope)).toBe(true)
  finishOperation(state, child, 'unknown', 102)
  expect(hasUnknownOperations(state, scope)).toBe(true)
  resolveOperation(state, { ...child, resolution: 'verified_applied' }, 103)
  expect(hasUnknownOperations(state, scope)).toBe(false)
  expect(hasUnknownOperations(state, { roomIds: ['unrelated'] })).toBe(true)
  expect(hasUnknownOperations(state, { roomIds: ['chat'] })).toBe(true)
})

it('never lets late receipts overwrite cancellation uncertainty or a subsequent operator decision', () => {
  const state: OperationState = {}
  beginOperation(state, input, 100)
  interruptOperations(state, 101, { roomIds: ['chat'], messageIds: ['response'] })
  const interrupted = structuredClone(state)
  expect(() => finishOperation(state, key, 'returned', 102)).toThrow('cannot be overwritten')
  expect(state).toEqual(interrupted)
  resolveOperation(state, { ...key, resolution: 'verified_not_applied' }, 103)
  const reconciled = structuredClone(state)
  expect(() => finishOperation(state, key, 'returned', 104)).toThrow('cannot be overwritten')
  finishOperation(state, key, 'unknown', 104) // A repeated failure receipt is harmless.
  expect(interruptOperations(state, 105)).toBe(0)
  expect(state).toEqual(reconciled)
})

it('does not garbage-collect settled receipts to make room when the global journal is full', () => {
  const state: OperationState = {}
  const sample = beginOperation(state, input, 100)
  state.taskOperations!.operations = Array.from({ length: MAX_OPERATION_RECORDS }, (_, index) => {
    const key = { roomId: 'chat', messageId: `response-${index}`, callId: 'call' }
    return { ...sample, ...key, id: operationId(key), status: 'returned' as const, finishedAt: 101 }
  })
  const oldest = structuredClone(state.taskOperations!.operations[0])
  expect(() => beginOperation(state, { ...input, messageId: 'next' }, 102)).toThrow('journal is full')
  expect(state.taskOperations!.operations).toHaveLength(MAX_OPERATION_RECORDS)
  expect(state.taskOperations!.operations[0]).toEqual(oldest)
  expect(interruptOperations(state, 103)).toBe(0)
  expect(state.taskOperations!.operations).toHaveLength(MAX_OPERATION_RECORDS)
})
