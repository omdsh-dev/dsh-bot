import type { ChatMessage, Room } from './types.ts'

/** The index caches text for invalidation and term postings; reads always use the authoritative transcript. */
function terms(text: string): string[] {
  const value = text.normalize('NFKC').toLocaleLowerCase()
  const found: string[] = value.match(/[a-z0-9_./-]+/gu) ?? []
  for (const phrase of value.match(/[\p{Script=Han}]+/gu) ?? []) {
    for (let i = 0; i < phrase.length; i++) found.push(phrase.slice(i, i + Math.min(2, phrase.length - i)))
  }
  return [...new Set(found)]
}
export interface ChatRead { id: string; from: string; time: number; text: string; truncated: boolean }
export class ChatSearch {
  private rooms = new Map<string, { texts: Map<string, string>; postings: Map<string, Set<string>> }>()
  /** Identity is bound by the caller, never accepted from model-controlled arguments. */
  query(room: Room, localOnly: boolean, query: string, limit = 12): ChatRead[] {
    if (room.deleted) throw new Error('This chat was deleted')
    if (!query.trim() || query.length > 300) throw new Error('Use a search query of 1–300 characters')
    let index = this.rooms.get(room.id)
    if (!index) { index = { texts: new Map(), postings: new Map() }; this.rooms.set(room.id, index) }
    const admitted = room.messages.filter(message => this.visible(room, message, localOnly))
    const ids = new Set(admitted.map(message => message.id as string))
    for (const [id, text] of index.texts) if (!ids.has(id)) {
      for (const term of terms(text)) index.postings.get(term)?.delete(id)
      index.texts.delete(id)
    }
    for (const message of admitted) if (index.texts.get(message.id) !== message.text) {
      const old = index.texts.get(message.id)
      if (old !== undefined) for (const term of terms(old)) index.postings.get(term)?.delete(message.id)
      index.texts.set(message.id, message.text)
      for (const term of terms(message.text)) {
        const posting = index.postings.get(term) ?? new Set<string>(); posting.add(message.id); index.postings.set(term, posting)
      }
    }
    const scores = new Map<string, number>()
    for (const term of terms(query)) for (const id of index.postings.get(term) ?? []) scores.set(id, (scores.get(id) ?? 0) + 1)
    const literal = query.normalize('NFKC').toLocaleLowerCase()
    return admitted.map(message => ({ message, score: (scores.get(message.id) ?? 0) + (message.text.normalize('NFKC').toLocaleLowerCase().includes(literal) ? 10 : 0) }))
      .filter(item => item.score > 0).sort((a, b) => b.score - a.score || b.message.time - a.message.time)
      .slice(0, Math.max(1, Math.min(20, Math.floor(limit) || 12))).map(({ message }) => this.render(message, 800))
  }
  read(room: Room, localOnly: boolean, id: string): ChatRead[] {
    const messages = room.messages.filter(message => this.visible(room, message, localOnly))
    const at = messages.findIndex(message => message.id === id)
    if (room.deleted || at < 0) throw new Error('Message is not available in this chat')
    return messages.slice(Math.max(0, at - 2), at + 3).map(message => this.render(message, message.id === id ? 8000 : 800))
  }
  remove(roomId: string): void { this.rooms.delete(roomId) }
  private visible(room: Room, message: ChatMessage, localOnly: boolean): boolean {
    return message.status === 'complete' && (!room.external || localOnly || !message.localOnly)
  }
  private render(message: ChatMessage, max: number): ChatRead {
    return { id: message.id, from: message.botId ?? message.external?.sender.name ?? 'user', time: message.time,
      text: message.text.slice(0, max), truncated: message.text.length > max }
  }
}
