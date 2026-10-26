/** Best-effort IM metadata, independent of message delivery and model execution. */
import type { BotId, BotState, ExternalConversation, ExternalRoomRequest, Room } from './types.ts'

export interface GroupTitleTarget {
  groups(): string[]
  update(id: string, title: string): Promise<void>
  join?(id: string, title: string): Promise<void>
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
    join: async (id, title) => {
      if (!allowed(id) || !botIds.length) return
      await bots.ensureExternalRoom({ conversation: { provider, accountId, kind: 'group', id }, title,
        botIds, defaultBot: botIds[0]! })
    },
  }
}

interface CachedTitle { title?: string | undefined; nextAt: number; eventAt?: number | undefined; joined?: boolean }
function validTitle(value: unknown): string | undefined {
  const title = typeof value === 'string' ? value.trim() : ''
  return title && title.length <= 1000 ? title : undefined
}

/** Coalesce lookups, bound retries/cache size, and refresh existing groups without sending messages. */
export class GroupTitles {
  private readonly cache = new Map<string, CachedTitle>()
  private readonly pending = new Map<string, Promise<string | undefined>>()
  private readonly writes = new Map<string, Promise<void>>()
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
        // An event arriving during the lookup is newer than this request's view.
        if (this.cache.get(id) !== cached) return this.cache.get(id)?.title
        const title = validTitle(value)
        // Provider metadata is display text only. Empty/invalid metadata must never clear a title.
        if (!title) throw new Error('Missing group title')
        if (!this.stopped) {
          const entry = { ...cached, title, nextAt: Date.now() + 60000 }
          this.remember(id, entry)
          await this.persist(id, entry)
        }
        return this.cache.get(id)?.title
      } catch {
        if (!this.stopped) {
          const current = this.cache.get(id)
          // Missing API permission must not discard a name supplied by an event.
          if (current === cached) this.remember(id, { ...cached, nextAt: Date.now() + 60000 })
          this.report()
        }
        return this.cache.get(id)?.title
      } finally { if (timer) clearTimeout(timer) }
    })().finally(() => { this.pending.delete(id) })
    this.pending.set(id, task)
    return task
  }

  /** Authenticated provider events bypass metadata API permissions, but never the binding allowlist. */
  async observe(id: string, value: unknown, options: { at?: number | undefined; joined?: boolean } = {}): Promise<void> {
    const title = validTitle(value)
    if (this.stopped || !title) return
    const current = this.cache.get(id), at = options.at
    if (at !== undefined && current?.eventAt !== undefined
      && (at < current.eventAt || at === current.eventAt && title !== current.title)) return
    const entry = { title, nextAt: Date.now() + 60000, eventAt: at ?? current?.eventAt, joined: options.joined || current?.joined || false }
    this.remember(id, entry)
    // Re-delivery retries a failed write even when its timestamp/name is unchanged.
    await this.persist(id, entry)
  }

  private persist(id: string, entry: CachedTitle): Promise<void> {
    const task = (this.writes.get(id) ?? Promise.resolve()).catch(() => {}).then(async () => {
      if (this.cache.get(id) !== entry || !entry.title) return
      if (entry.joined && this.target?.join) {
        await this.target.join(id, entry.title)
        const current = this.cache.get(id)
        if (current) current.joined = false
      }
      else await this.target?.update(id, entry.title)
    }).finally(() => { if (this.writes.get(id) === task) this.writes.delete(id) })
    this.writes.set(id, task)
    return task
  }

  private remember(id: string, value: CachedTitle): void {
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
    await Promise.allSettled(this.writes.values())
    this.cache.clear()
  }
}
