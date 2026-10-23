/** Immutable chunks precede the atomic manifest commit. Unreferenced chunks are harmless. */
import { createHash } from 'node:crypto'
import { defineDomain, type Domain } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { messageSchema } from './domain.ts'
import type { BotState, ChatMessage, HistoryPage, HistoryRequest, Room } from './types.ts'

const chunkDomain = (hash: string) => defineDomain({ name: `bot_history_${hash}`, version: 1, tables: {}, global: { schema: z.array(messageSchema), initial: [] } })
export class HistoryStore {
  private known = new Set<string>()
  private reading = new Map<string, Promise<ChatMessage[]>>()
  constructor(private readonly open: (spec: ReturnType<typeof chunkDomain>) => Promise<Domain<ReturnType<typeof chunkDomain>>>) {}

  /** Concurrent readers share one native domain handle; settled chunks are not retained in RAM. */
  readChunk(hash: string): Promise<ChatMessage[]> {
    if (!/^[a-f0-9]{64}$/.test(hash)) return Promise.reject(new Error('Invalid history chunk identity'))
    let pending = this.reading.get(hash)
    if (!pending) {
      pending = (async () => {
        const domain = await this.open(chunkDomain(hash))
        try {
          const chunk = domain.global.get()
          if (this.hash(chunk) !== hash) throw new Error('History chunk is missing or corrupted')
          this.known.add(hash); return chunk
        } finally { await domain.close() }
      })()
      this.reading.set(hash, pending)
      void pending.finally(() => this.reading.delete(hash)).catch(() => {})
    }
    return pending
  }
  /** Supports old hydrated owners and the bounded manifest representation during migration. */
  parts(room: Room): { chunks: string[]; tail: ChatMessage[] } {
    if (room.historyChunks) return { chunks: room.historyChunks, tail: room.messages }
    const chunks: string[] = []; let start = 0
    while (room.messages.length - start > 256) {
      const hash = this.hash(room.messages.slice(start, start + 128))
      if (!this.known.has(hash)) break
      chunks.push(hash); start += 128
    }
    return { chunks, tail: room.messages.slice(start) }
  }

  count(room: Room): number { return (room.historyChunks?.length ?? 0) * 128 + room.messages.length }

  async room(room: Room): Promise<Room> {
    const copy = structuredClone(room)
    const messages: ChatMessage[] = []
    for (const hash of copy.historyChunks ?? []) messages.push(...await this.readChunk(hash))
    copy.messages = [...messages, ...copy.messages]; delete copy.historyChunks
    return copy
  }

  async slice(room: Room, start: number, end = this.count(room)): Promise<ChatMessage[]> {
    const chunks = room.historyChunks ?? [], offset = chunks.length * 128, result: ChatMessage[] = []
    start = Math.max(0, start); end = Math.min(end, this.count(room))
    for (let index = Math.floor(start / 128); index < chunks.length && index * 128 < end; index++) {
      result.push(...(await this.readChunk(chunks[index]!)).slice(Math.max(0, start - index * 128), Math.min(128, end - index * 128)))
    }
    if (end > offset) result.push(...room.messages.slice(Math.max(0, start - offset), end - offset))
    return structuredClone(result)
  }

  async page(room: Room, request: HistoryRequest): Promise<HistoryPage> {
    const limit = Math.max(1, Math.min(200, Math.floor(request.limit ?? 50)))
    if (!Number.isFinite(limit)) throw new Error('Invalid history page size')
    const query = request.query?.trim().toLocaleLowerCase(), chunks = room.historyChunks ?? []
    const matches = (message: ChatMessage) => !query || message.text.toLocaleLowerCase().includes(query)
    const rows: ChatMessage[] = []; let before = !request.before, found = before, total = 0
    for (let index = chunks.length; index >= 0; index--) {
      const part = index === chunks.length ? room.messages : await this.readChunk(chunks[index]!)
      for (let i = part.length - 1; i >= 0; i--) {
        const message = part[i]!, match = matches(message)
        if (match) total++
        if (!before) { if (message.id === request.before) { before = true; found = true }; continue }
        if (match && rows.length <= limit) rows.push(message)
      }
      if (!query && found && rows.length > limit) break
    }
    if (!found) throw new Error('History cursor no longer exists')
    const more = rows.length > limit, messages = rows.slice(0, limit).reverse()
    return structuredClone({ messages, before: more ? messages[0]!.id : null, total: query ? total : this.count(room) })
  }

  async hydrate(saved: BotState): Promise<BotState> {
    const state = structuredClone(saved)
    for (const room of state.rooms) {
      const messages = []
      for (const hash of room.historyChunks ?? []) {
        messages.push(...await this.readChunk(hash))
      }
      room.messages = [...messages, ...room.messages]; delete room.historyChunks
    }
    return state
  }
  private hash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item)).digest('hex') }

  async persist(state: BotState, commit: (manifest: BotState) => Promise<void>): Promise<void> {
    const manifest = structuredClone(state)
    for (const room of manifest.rooms) {
      const chunks: string[] = [...room.historyChunks ?? []]
      const participants = new Map((room.participants ?? []).map(person => [person.id, person.name]))
      for (const message of room.messages) if (!message.botId && message.external && room.external) {
        for (const source of message.external.sources?.length ? message.external.sources : [{ accountId: room.external.accountId, senderId: message.external.sender.id }]) {
          participants.set(JSON.stringify([room.external.provider, source.accountId, source.senderId]), `${message.external.sender.name || source.senderId} · ${room.external.provider}/${source.accountId}/${source.senderId}`)
        }
      }
      if (participants.size) room.participants = [...participants].map(([id, name]) => ({ id, name }))
      // Restart and stop must find every unfinished branch, its human authority, and pending questions in the tail.
      const pinned = new Set(room.messages.filter(message => ['running', 'queued'].includes(message.status) || message.questions?.length || message.awaiting?.length && !message.continuedBy && !message.collaborationCanceled).map(message => message.id))
      for (let index = room.messages.length - 1; index >= 0; index--) {
        const message = room.messages[index]!
        if (pinned.has(message.id)) for (const id of [message.replyTo, message.delegation?.rootId, message.continuationOf, ...message.resultIds ?? []]) if (id) pinned.add(id)
      }
      const firstPinned = room.messages.findIndex(message => pinned.has(message.id))
      // Retain a bounded tail, while copy-on-write handles any edit to older receipts or attempts.
      let start = 0
      while (room.messages.length - start > 256 && (firstPinned < 0 || start + 128 <= firstPinned)) {
        const chunk = room.messages.slice(start, start + 128), hash = this.hash(chunk)
        if (!this.known.has(hash)) {
          const domain = await this.open(chunkDomain(hash))
          try { await domain.global.set(chunk); this.known.add(hash) } finally { await domain.close() }
        }
        chunks.push(hash); start += chunk.length
      }
      if (chunks.length) room.historyChunks = chunks
      else delete room.historyChunks
      room.messages = room.messages.slice(start)
    }
    await commit(manifest)
  }
}
