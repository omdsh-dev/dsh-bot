/** Segment receipt/notice windows without rewriting the full deduplication history on each send. */
import { createHash } from 'node:crypto'
import { defineDomain, type Domain } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import type { BridgeState } from './domain.ts'
import type { BridgeStore } from './bridge.ts'

const chunkDomain = (hash: string) => defineDomain({ name: `bot_receipts_${hash}`, version: 1, tables: {}, global: { schema: z.array(z.string()), initial: [] } })
type Open = (spec: ReturnType<typeof chunkDomain>) => Promise<Domain<ReturnType<typeof chunkDomain>>>
export class BridgeArchive implements BridgeStore {
  private state!: BridgeState
  private offsets = { receipts: 0, notices: 0 }
  private known = new Set<string>()
  private constructor(private readonly raw: BridgeStore, private readonly open: Open) {}
  static async load(raw: BridgeStore, open: Open): Promise<BridgeArchive> {
    const store = new BridgeArchive(raw, open), state = structuredClone(raw.get())
    for (const field of ['receipts', 'notices'] as const) {
      const prefix: string[] = []
      for (const hash of state.windows?.[field]?.chunks ?? []) {
        if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid receipt archive identity')
        const domain = await open(chunkDomain(hash))
        try {
          const chunk = domain.global.get()
          if (store.hash(chunk) !== hash) throw new Error('Receipt archive missing or corrupted')
          prefix.push(...chunk); store.known.add(hash)
        } finally { await domain.close() }
      }
      state[field] = [...prefix, ...state[field]]
      store.offsets[field] = state.windows?.[field]?.offset ?? 0
    }
    delete state.windows; store.state = state
    return store
  }
  private hash(items: string[]): string { return createHash('sha256').update(JSON.stringify(items)).digest('hex') }
  get(): BridgeState { return structuredClone(this.state) }
  async set(state: BridgeState): Promise<void> {
    const saved = structuredClone(state), offsets = { ...this.offsets }
    saved.windows = {}
    for (const field of ['receipts', 'notices'] as const) {
      const old = this.state[field], items = state[field], chunks: string[] = []
      const dropped = items.length ? old.indexOf(items[0]!) : old.length
      offsets[field] += dropped < 0 ? old.length : dropped
      let start = 0
      while (items.length - start > 256) {
        // Stable absolute boundaries ensure eviction rewrites only the first chunk.
        const count = 128 - (offsets[field] + start) % 128
        const chunk = items.slice(start, start + count), hash = this.hash(chunk)
        if (!this.known.has(hash)) {
          const domain = await this.open(chunkDomain(hash))
          try { await domain.global.set(chunk); this.known.add(hash) } finally { await domain.close() }
        }
        chunks.push(hash); start += count
      }
      saved[field] = items.slice(start); saved.windows[field] = { offset: offsets[field], chunks }
    }
    await this.raw.set(saved)
    this.state = structuredClone(state); delete this.state.windows; this.offsets = offsets
  }
}
