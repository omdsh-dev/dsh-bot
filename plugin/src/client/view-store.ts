/** Transient navigation survives opening a native execution Session. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { RoomId } from '../types.ts'
interface ViewState { roomId: RoomId | null }
type ViewActions = { select: (draft: ViewState, roomId: RoomId) => void }
/**
 * Declare panel selection owned by the slot runtime, with no business records.
 * @returns a fresh non-persisted view store handle.
 */
export function createBotViewStore(): EngineStoreHandle<ViewState, ViewActions> {
  return defineStore({ init: (): ViewState => ({ roomId: null }), actions: {
    select: (draft, roomId) => { draft.roomId = roomId },
  } })
}
