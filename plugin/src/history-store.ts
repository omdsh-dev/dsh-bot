/** Immutable chunks precede the atomic manifest commit. Unreferenced chunks are harmless. */
import { createHash } from 'node:crypto'
import { defineDomain, type Domain } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { messageSchema } from './domain.ts'
import type { BotState } from './types.ts'

const chunkDomain = (hash: string) => defineDomain({ name: `bot_history_${hash}`, version: 1, tables: {}, global: { schema: z.array(messageSchema), initial: [] } })
export class HistoryStore {
  private known = new Set<string>()
  constructor(private readonly open: (spec: ReturnType<typeof chunkDomain>) => Promise<Domain<ReturnType<typeof chunkDomain>>>) {}

  async hydrate(saved: BotState): Promise<BotState> {
    const state = structuredClone(saved)
    for (const room of state.rooms) {
      const messages = []
      for (const hash of room.historyChunks ?? []) {
        if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid history chunk identity')
        const domain = await this.open(chunkDomain(hash))
        try {
          const chunk = domain.global.get()
          if (this.hash(chunk) !== hash) throw new Error('History chunk is missing or corrupted')
          messages.push(...chunk); this.known.add(hash)
        } finally { await domain.close() }
      }
      room.messages = [...messages, ...room.messages]; delete room.historyChunks
    }
    return state
  }
  private hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)).digest('hex') }

  async persist(state: BotState, commit: (manifest: BotState) => Promise<void>): Promise<void> {
    const manifest = structuredClone(state)
    for (const room of manifest.rooms) {
      const chunks: string[] = []
      // Retain a bounded tail, while copy-on-write handles any edit to older receipts or attempts.
      let start = 0
      while (room.messages.length - start > 256) {
        const chunk = room.messages.slice(start, start + 128), hash = this.hash(chunk)
        if (!this.known.has(hash)) {
          const domain = await this.open(chunkDomain(hash))
          try { await domain.global.set(chunk); this.known.add(hash) } finally { await domain.close() }
        }
        chunks.push(hash); start += chunk.length
      }
      if (chunks.length) room.historyChunks = chunks
      room.messages = room.messages.slice(start)
    }
    await commit(manifest)
  }
}
