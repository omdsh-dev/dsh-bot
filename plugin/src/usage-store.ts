import { createHash } from 'node:crypto'
import { defineDomain, type Domain } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { usageRecordSchema } from './usage-ledger.ts'
import type { UsageLedger, UsageRecord } from './usage-types.ts'
import type { BotState } from './types.ts'

const chunkDomain = (hash: string) => defineDomain({ name: `bot_usage_${hash}`, version: 1, tables: {}, global: { schema: z.array(usageRecordSchema), initial: [] } })
const hashRecords = (rows: UsageRecord[]) => createHash('sha256').update(JSON.stringify(rows, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)).digest('hex')

/** Independent immutable ledger. The manifest and budgets commit atomically; history deletion does not touch it. */
export class UsageStore {
  private opening = new Map<string, Promise<UsageRecord[]>>()
  constructor(private readonly open: (spec: ReturnType<typeof chunkDomain>) => Promise<Domain<ReturnType<typeof chunkDomain>>>) {}
  async persist(state: BotState, commit: (manifest: BotState) => Promise<void>): Promise<void> {
    if (!state.usageLedger || state.usageLedger.tail.length <= 128) return commit(state)
    const ledger = structuredClone(state.usageLedger)
    while (ledger.tail.length > 128) {
      const chunk = ledger.tail.splice(0, 128), hash = hashRecords(chunk)
      const domain = await this.open(chunkDomain(hash))
      try { await domain.global.set(chunk) } finally { await domain.close() }
      ledger.chunks.push(hash)
    }
    await commit({ ...state, usageLedger: ledger })
    // Never expose uncommitted chunk references after a failed manifest write.
    state.usageLedger = ledger
  }
  async *read(ledger: UsageLedger): AsyncIterable<UsageRecord> {
    for (const hash of ledger.chunks) {
      if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid usage chunk identity')
      let load = this.opening.get(hash)
      if (!load) {
        load = (async () => {
          const domain = await this.open(chunkDomain(hash))
          try {
            const rows = domain.global.get()
            if (hashRecords(rows) !== hash) throw new Error('Usage ledger chunk is missing or corrupted')
            return rows
          } finally { await domain.close() }
        })()
        this.opening.set(hash, load)
        void load.finally(() => this.opening.delete(hash)).catch(() => {})
      }
      for (const record of await load) yield record
    }
    yield* ledger.tail
  }
}
