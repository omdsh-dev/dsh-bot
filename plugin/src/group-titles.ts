/** Best-effort IM metadata, independent of message delivery and model execution. */
import type { BotId, BotState, ExternalConversation, ExternalRoomRequest, Room } from './types.ts'

export interface GroupTitleTarget {
  groups(): string[]
  update(id: string, title: string): Promise<void>
}

/** Only revisit groups already linked to this robot and still allowed by its binding. */
export function groupTitleTarget(bots: { snapshot(): BotState; ensureExternalRoom(request: ExternalRoomRequest): Promise<Room> },
  provider: ExternalConversation['provider'], accountId: string, botIds: BotId[], allowed: (id: string) => boolean): GroupTitleTarget {
  const rooms = () => bots.snapshot().rooms.filter(room => room.external?.provider === provider && room.external.kind === 'group'
    && room.members.some(member => botIds.includes(member.botId)) && allowed(room.external.id))
  return {
    groups: () => [...new Set(rooms().map(room => room.external!.id))],
    update: async (id, title) => {
      const room = rooms().find(room => room.external!.id === id)
      if (!room || room.title === title) return
      await bots.ensureExternalRoom({ conversation: { provider, accountId, kind: 'group', id }, title,
        botIds: [], defaultBot: room.defaultBot })
    },
  }
}

/** Coalesce lookups, bound retries/cache size, and refresh existing groups without sending messages. */
export class GroupTitles {
  private readonly cache = new Map<string, { title?: string; nextAt: number }>()
  private readonly pending = new Map<string, Promise<string | undefined>>()
  private timer: ReturnType<typeof setInterval> | undefined
  private refresh: Promise<void> | undefined
  private stopped = false
  constructor(private readonly lookup: (id: string) => Promise<unknown>, private readonly timeoutMs: number,
    private readonly target?: GroupTitleTarget, private readonly report: () => void = () => {}) {}

  async get(id: string): Promise<string | undefined> {
    if (this.stopped) return
    const cached = this.cache.get(id)
    if (cached && cached.nextAt > Date.now()) return cached.title
    const pending = this.pending.get(id)
    if (pending) return pending
    const task = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const value = await Promise.race([this.lookup(id), new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Group title lookup timed out')), this.timeoutMs); timer.unref()
        })])
        const title = typeof value === 'string' ? value.trim() : ''
        // Provider metadata is display text only. Empty/invalid metadata must never clear a title.
        if (!title || title.length > 1000) throw new Error('Missing group title')
        if (!this.stopped) {
          this.remember(id, { title, nextAt: Date.now() + 60000 })
          await this.target?.update(id, title)
        }
        return title
      } catch {
        if (!this.stopped) { this.remember(id, { nextAt: Date.now() + 60000 }); this.report() }
        return undefined
      } finally { if (timer) clearTimeout(timer) }
    })().finally(() => { this.pending.delete(id) })
    this.pending.set(id, task)
    return task
  }

  private remember(id: string, value: { title?: string; nextAt: number }): void {
    this.cache.delete(id); this.cache.set(id, value)
    if (this.cache.size > 1000) this.cache.delete(this.cache.keys().next().value!)
  }
  start(): void {
    if (this.stopped || this.timer || !this.target) return
    void this.sync()
    this.timer = setInterval(() => { void this.sync() }, 60000); this.timer.unref()
  }
  sync(): Promise<void> {
    if (this.refresh) return this.refresh
    this.refresh = (async () => {
      for (const id of this.target?.groups() ?? []) { if (this.stopped) break; await this.get(id) }
    })().catch(() => { if (!this.stopped) this.report() }).finally(() => { this.refresh = undefined })
    return this.refresh
  }
  async close(): Promise<void> {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    await this.refresh
    await Promise.allSettled(this.pending.values())
    this.cache.clear()
  }
}
