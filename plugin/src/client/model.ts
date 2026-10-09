/** React-free, identity-stable projection fed only by authoritative Host snapshots. */
import { notifySubscribers } from '@deepseek-ai/dsh-client-store'
import type { BotState } from '../types.ts'

/** Authoritative projection and its transport availability. */
export interface ModelSnapshot { value: BotState; ready: boolean; error: string | null }
/** Identity-stable business source consumed by the slot framework. */
export class BotModel {
  private snapshot: ModelSnapshot = { value: { bots: [], rooms: [] }, ready: false, error: null }
  private readonly listeners = new Set<() => void>()
  /** Current immutable projection, stable until publication. */
  getSnapshot = (): ModelSnapshot => this.snapshot
  /** Register an observer and return its exact disposer. */
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  /**
   * Install a Host snapshot after initial connection or an update.
   * @param value - complete authoritative domain state.
   */
  replace(value: BotState): void { this.publish({ value, ready: true, error: null }) }
  /**
   * Report transport failure while retaining the last accepted state.
   * @param error - transport or protocol diagnostic.
   */
  failed(error: unknown): void { this.publish({ ...this.snapshot, error: error instanceof Error ? error.message : String(error) }) }
  private publish(snapshot: ModelSnapshot): void {
    this.snapshot = snapshot
    notifySubscribers(this.listeners, 'Bot Mode')
  }
}
