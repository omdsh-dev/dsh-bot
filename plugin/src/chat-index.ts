import { createHash } from 'node:crypto'
import { defineDomain, type Domain } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { searchTerms, type ChatRead } from './chat-search.ts'
import type { ChatMessage, Room } from './types.ts'
import type { HistoryStore } from './history-store.ts'

const indexSchema = z.object({ source: z.string(), checksum: z.string(),
  documents: z.array(z.object({ id: z.string(), time: z.number(), localOnly: z.boolean() })).max(128),
  postings: z.array(z.tuple([z.string(), z.array(z.number().int().min(0).max(127))])),
})
type Index = z.infer<typeof indexSchema>
// A corrupt derived index can always be reconstructed from the immutable authoritative chunk.
const indexDomain = (hash: string) => defineDomain({ name: `bot_search_${hash}`, version: 1, tables: {}, global: { schema: z.object({}).passthrough(), initial: {} } })
const digest = (index: Omit<Index, 'checksum'>) => createHash('sha256').update(JSON.stringify(index)).digest('hex')
function build(source: string, messages: ChatMessage[]): Index {
  const documents: Index['documents'] = [], postings = new Map<string, number[]>()
  for (const message of messages) {
    if (message.status !== 'complete') continue
    const position = documents.length
    documents.push({ id: message.id, time: message.time, localOnly: !!message.localOnly })
    for (const term of searchTerms(message.text)) { const list = postings.get(term) ?? []; list.push(position); postings.set(term, list) }
  }
  const body = { source, documents, postings: [...postings].sort(([a], [b]) => a.localeCompare(b)) }
  return { ...body, checksum: digest(body) }
}
/** Immutable, persisted inverted indexes. Queries retain bounded candidates and load only matching source chunks. */
export class ChatIndex {
  private pending = new Map<string, Promise<Index>>()
  private cache = new Map<string, Index>()
  constructor(private readonly history: HistoryStore,
    private readonly open: (spec: ReturnType<typeof indexDomain>) => Promise<Domain<ReturnType<typeof indexDomain>>>) {}
  private index(hash: string): Promise<Index> {
    if (!/^[a-f0-9]{64}$/.test(hash)) return Promise.reject(new Error('Invalid search chunk identity'))
    const cached = this.cache.get(hash)
    if (cached) { this.cache.delete(hash); this.cache.set(hash, cached); return Promise.resolve(cached) }
    let pending = this.pending.get(hash)
    if (!pending) {
      pending = (async () => {
        const domain = await this.open(indexDomain(hash))
        let index: Index
        try {
          const saved = indexSchema.safeParse(domain.global.get())
          if (saved.success && saved.data.source === hash && saved.data.checksum === digest({ source: hash, documents: saved.data.documents, postings: saved.data.postings })) index = saved.data
          else { index = build(hash, await this.history.readChunk(hash)); await domain.global.set(index) }
        } finally { await domain.close() }
        this.cache.set(hash, index)
        while (this.cache.size > 32) this.cache.delete(this.cache.keys().next().value!)
        return index
      })()
      this.pending.set(hash, pending)
      void pending.finally(() => this.pending.delete(hash)).catch(() => {})
    }
    return pending
  }
  async query(room: Room, localOnly: boolean, query: string, limit = 12): Promise<ChatRead[]> {
    if (room.deleted) throw new Error('This chat was deleted')
    if (!query.trim() || query.length > 300) throw new Error('Use a search query of 1–300 characters')
    const terms = searchTerms(query), { chunks, tail } = this.history.parts(room)
    if (!terms.length) return []
    const count = Math.max(1, Math.min(20, Math.floor(limit) || 12))
    const candidates: { id: string; hash: string | null; time: number; score: number }[] = []
    const include = (index: Index, hash: string | null) => {
      const scores = new Map<number, number>(), postings = new Map(index.postings)
      for (const term of terms) for (const position of postings.get(term) ?? []) scores.set(position, (scores.get(position) ?? 0) + 1)
      for (const [position, score] of scores) {
        const document = index.documents[position]
        if (document && (!room.external || localOnly || !document.localOnly)) candidates.push({ id: document.id, hash, time: document.time, score })
      }
      candidates.sort((a, b) => b.score - a.score || b.time - a.time || a.id.localeCompare(b.id))
      candidates.splice(count)
    }
    // Only immutable settled history is persisted. The current tail is indexed in bounded batches.
    for (const hash of chunks) include(await this.index(hash), hash)
    for (let start = 0; start < tail.length; start += 128) include(build('tail', tail.slice(start, start + 128)), null)
    const loaded = new Map<string, ChatMessage[]>()
    const result: ChatRead[] = []
    for (const candidate of candidates) {
      let messages = tail
      if (candidate.hash) {
        let chunk = loaded.get(candidate.hash)
        if (!chunk) { chunk = await this.history.readChunk(candidate.hash); loaded.set(candidate.hash, chunk) }
        messages = chunk
      }
      const message = messages.find(message => message.id === candidate.id)
      if (!message || message.status !== 'complete' || room.external && !localOnly && message.localOnly) continue
      result.push({ id: message.id, from: message.botId ?? message.external?.sender.name ?? 'user', time: message.time, text: message.text.slice(0, 800), truncated: message.text.length > 800 })
    }
    return result
  }
}
