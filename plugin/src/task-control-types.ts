/** Operator view: execution completion, acceptance, and uncertain external effects are distinct. */
import type { TaskRecord } from './task-types.ts'
import type { ToolOperation } from './task-operation-types.ts'
export interface TaskInspection { task: TaskRecord; operations: ToolOperation[] }
