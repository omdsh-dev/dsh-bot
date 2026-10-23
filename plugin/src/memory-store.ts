import { createHash } from 'node:crypto'
import { defineDomain, type Domain } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { memorySchema } from './memory.ts'
import type { BotState } from './types.ts'

const chunkDomain = (hash: string) => defineDomain({ name: `bot_memory_${hash}`, version: 1, tables: {}, global: { schema: z.array(memorySchema), initial: [] } })
/** Immutable memory chunks share the Bot manifest's commit. Unchanged memory is not rewritten by chat updates. */
export class MemoryStore {
  private known = new Set<string>()
  private referenced = new Set<string>()
  private retired = new Set<string>()
  constructor(private readonly open: (spec: ReturnType<typeof chunkDomain>) => Promise<Domain<ReturnType<typeof chunkDomain>>>) {}
  async hydrate(state: BotState): Promise<BotState> {
    if ((state.retiredMemoryChunks ?? []).some(hash => !/^[a-f0-9]{64}$/.test(hash))) throw new Error('Invalid retired memory chunk identity')
    this.retired = new Set(state.retiredMemoryChunks ?? [])
    delete state.retiredMemoryChunks
    if (!state.memoryChunks) return state
    const records = []
    for (const hash of state.memoryChunks) {
      if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid memory chunk identity')
      const domain = await this.open(chunkDomain(hash))
      try {
        const chunk = domain.global.get()
        if (this.hash(chunk) !== hash) throw new Error('Memory chunk is missing or corrupted')
        records.push(...chunk); this.known.add(hash)
      } finally { await domain.close() }
    }
    this.referenced = new Set(state.memoryChunks)
    state.memories = records; delete state.memoryChunks; return state
  }
  private hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)).digest('hex') }
  async persist(state: BotState, commit: (manifest: BotState) => Promise<void>): Promise<void> {
    const chunks: string[] = []
    for (let start = 0; start < (state.memories?.length ?? 0); start += 128) {
      const chunk = state.memories!.slice(start, start + 128), hash = this.hash(chunk)
      if (!this.known.has(hash)) {
        const domain = await this.open(chunkDomain(hash))
        try { await domain.global.set(chunk); this.known.add(hash) } finally { await domain.close() }
      }
      chunks.push(hash)
    }
    const retiring = new Set([...this.retired, ...[...this.referenced].filter(hash => !chunks.includes(hash))])
    const manifest = { ...state, memoryChunks: chunks, retiredMemoryChunks: [...retiring].filter(hash => !chunks.includes(hash)) }; delete manifest.memories
    await commit(manifest)
    // Only after the new manifest commits can old chunk contents be erased.
    this.retired = retiring
    this.referenced = new Set(chunks)
    for (const hash of this.retired) {
      if (this.referenced.has(hash)) { this.retired.delete(hash); continue }
      try {
        const domain = await this.open(chunkDomain(hash))
        try { await domain.global.set([]); this.known.delete(hash); this.retired.delete(hash) } finally { await domain.close() }
      } catch { /* The committed manifest is authoritative; retry physical cleanup on the next write. */ }
    }
  }
}
