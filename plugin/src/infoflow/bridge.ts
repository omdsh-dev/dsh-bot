/** Durable text bridge. The Bot owner commits work; this module retries only admission and delivery. */
import type { BotMode } from '../index.ts'
import type { BotId, Room, FailureView } from '../types.ts'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { conversationKey, splitMessage, type Incoming } from './messages.ts'
import type { BridgeState, Delivery, Pending, RobotMention } from './domain.ts'
import { humanRequest, responseTree } from '../delegation.ts'
import { isDeepStrictEqual } from 'node:util'
import { isPermanentChatError } from '../external-errors.ts'

/** All deployment-varying queue and routing limits. */
export interface BridgeConfig {
  provider?: 'infoflow' | 'feishu'; accountId: string; botIds: BotId[]; defaultBot: BotId; allowUsers: string[]; allowGroups: string[]; allowAllGroups?: boolean; admins: string[]
  /** Legacy connectors sharing one platform robot across multiple Bots need textual attribution. */
  labelReplies?: boolean
  /** Only runtimes able to send through the target robot opt into Host handoffs. */
  allowDelegation?: boolean
  notifyScheduled?: boolean
  notifyGroup?: (id: string) => boolean
  /** Resolve a committed handoff to this platform's robot identity, captured durably before sending. */
  mentionId?: (botId: BotId) => string | undefined
  /** Configured peers allowed in this group, including groups first seen after startup. */
  groupBotIds?: (groupId: string) => BotId[]
  maxPending: number; maxQueuePerRoom: number; maxConcurrentRooms: number; maxReceipts: number; maxOutbox: number
  chunkSize: number; retryMs: number; maxRetryMs: number
}
/** Native domain handle narrowed to the two operations the bridge owns. */
export interface BridgeStore { get(): BridgeState; set(state: BridgeState): Promise<void> }
/** Transport confirms sending or rejects; it never invokes the model. */
export interface Sender { send(delivery: Delivery): Promise<void> }

/** One configured robot. All persistence writes are serialized, including SDK callbacks. */
export class InfoFlowBridge {
  private state: BridgeState
  private tail: Promise<unknown> = Promise.resolve()
  private operations: Promise<unknown> = Promise.resolve()
  private worker: Promise<void> | undefined
  private dirty = false
  private closed = false
  /** @param bots - same Host's Bot owner. @param store - durable native domain. @param sender - SDK adapter.
   * @param config - validated deployment settings. @param report - contained error reporting, without message bodies or secrets.
   */
  constructor(private readonly bots: Pick<BotMode, 'snapshot' | 'ensureExternalRoom' | 'submitExternalMessage' | 'stop'>,
    private readonly store: BridgeStore, private readonly sender: Sender, private readonly config: BridgeConfig,
    private readonly report: (message: string) => void) { this.state = structuredClone(store.get()) }

  private change<T>(action: (state: BridgeState) => T): Promise<T> {
    const operation = this.tail.then(async () => {
      const draft = structuredClone(this.state)
      const result = action(draft)
      draft.notices = draft.notices.slice(-this.config.maxReceipts)
      if (draft.failed) draft.failed = draft.failed.slice(-Math.min(this.config.maxReceipts, 1000))
      if (isDeepStrictEqual(draft, this.state)) return result
      await this.store.set(draft)
      this.state = draft
      return result
    })
    this.tail = operation.catch(() => { /* The caller handles the persistence failure; keep later writes usable. */ })
    return operation
  }

  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const operation = this.operations.then(action)
    this.operations = operation.catch(() => { /* The operation caller observes the failure. */ })
    return operation
  }

  private room(input: Incoming): Room | undefined {
    return this.bots.snapshot().rooms.find(room => room.external && (conversationKey(room.external) === conversationKey(input.conversation)
      || (room.external.provider === input.conversation.provider && room.external.kind === 'group' && input.conversation.kind === 'group' && room.external.id === input.conversation.id)))
  }
  private enqueue(state: BridgeState, key: string, input: Incoming, content: string, botId: BotId = input.targets?.[0] ?? this.config.defaultBot, mentions: RobotMention[] = []): void {
    const parts = splitMessage(content, this.config.chunkSize, input.conversation.provider === 'infoflow' && input.conversation.kind === 'group' ? 2048 : Infinity)
    // InfoFlow accepts at most ten robot mentions per message. Never repeat them on text continuation chunks.
    const count = Math.max(parts.length, Math.ceil(mentions.length / 10))
    if (state.outbox.length + count > this.config.maxOutbox) throw new Error('External chat outbox is full; delivery must recover before accepting more results')
    for (let index = 0; index < count; index++) {
      const targets = mentions.slice(index * 10, index * 10 + 10)
      state.outbox.push({ id: `${key}:${index}`, conversation: input.conversation,
        user: input.message.sender.id, botId, text: parts[index] ?? '派活给以上 Bot。', attempts: 0, nextAt: 0,
        ...(targets.length ? { mentions: targets } : {}) })
    }
  }

  /** Persist authorization-approved input and its receipt in the same write.
   * @param input - validated SDK text event.
   * @returns accepted, duplicate, or ignored; a full queue throws before claiming the receipt.
   */
  async receive(input: Incoming): Promise<'accepted' | 'duplicate' | 'ignored'> {
    return this.exclusive(() => this.admit(input))
  }

  private async admit(input: Incoming): Promise<'accepted' | 'duplicate' | 'ignored'> {
    if (this.closed) throw new Error('External chat is stopping')
    const { conversation, message, text } = input
    if (conversation.provider !== (this.config.provider ?? 'infoflow') || conversation.accountId !== this.config.accountId) return 'ignored'
    if (conversation.kind === 'private' ? !this.config.allowUsers.includes(message.sender.id) : this.config.allowAllGroups !== true && !this.config.allowGroups.includes(conversation.id)) return 'ignored'
    const key = JSON.stringify([conversationKey(conversation), message.id])
    const outcome = await this.change((state) => {
      if (state.receipts.includes(key) || state.pending.some(item => item.key === key)) return 'duplicate' as const
      state.receipts.push(key)
      state.receipts = state.receipts.slice(-this.config.maxReceipts)
      const room = this.room(input)
      const command = text.trim().split(/\s+/)[0]!
      if (text.length > 32000) { this.enqueue(state, key, input, '消息过长，请缩短到 32000 字符以内。'); return 'accepted' as const }
      if (command.startsWith('/')) {
        if (command === '/help') this.enqueue(state, key, input, '直接发送文字开始对话。群内先 @对应机器人。\n/bots 查看 Bot\n/status 查看当前会话\n/stop 停止自己在当前会话的请求（管理员可停止全部）\n审批与执行详情请由部署者在 DSH 中处理。')
        else if (command === '/bots') this.enqueue(state, key, input, this.bots.snapshot().bots.filter(bot => this.config.botIds.includes(bot.id)).map(bot => `@${bot.id} ${bot.name}`).join('\n'))
        else if (command === '/status') {
          const pending = state.pending.filter(item => conversationKey(item.input.conversation) === conversationKey(conversation))
          const active = room?.messages.filter(item => item.status === 'running') ?? []
          const failed = (state.failed ?? []).filter(item => conversationKey(item.delivery?.conversation ?? item.pending!.input.conversation) === conversationKey(conversation)).length
          this.enqueue(state, key, input, `排队：${pending.filter(item => !item.submitted && !item.stop).length}；执行中：${active.length}；投递或准入失败：${failed}。\n${active.length ? '执行进度与人工审批请在 DSH 的对应外部聊天中打开执行会话查看。' : '当前没有正在执行的 Bot。'}`)
        } else if (command === '/stop') {
          const admin = this.config.admins.includes(message.sender.id)
          const mayStop = (sender: string) => admin || sender === message.sender.id
          const canceled = state.pending.filter(item => !item.submitted && !item.stop
            && conversationKey(item.input.conversation) === conversationKey(conversation) && mayStop(item.input.message.sender.id)
            && !room?.messages.some(message => message.external?.id === item.input.message.id))
          for (const item of canceled) this.enqueue(state, `${item.key}:canceled`, item.input, '请求已在开始执行前取消。')
          state.pending = state.pending.filter(item => !canceled.includes(item))
          const shared = conversation.kind === 'group'
          const owned = room ? state.pending.flatMap(item => item.submitted ? responseTree(room, item.submitted.attemptIds).map(message => message.id) : []) : []
          const attemptIds = room?.messages.filter(item => {
            if (item.status !== 'running' || item.localOnly || !item.replyTo || shared && !owned.includes(item.id) && (!item.botId || !this.config.botIds.includes(item.botId))) return false
            const external = humanRequest(room, item)?.external
            const sender = shared && conversation.provider === 'feishu' ? external?.sources?.find(source => source.accountId === this.config.accountId)?.senderId : external?.sender.id
            return mayStop(sender ?? '')
          }).map(item => item.id) ?? []
          if (room && attemptIds.length) state.pending.push({ key, input, binding: this.binding(input), stop: { roomId: room.id, attemptIds } })
          else this.enqueue(state, key, input, canceled.length ? '已取消排队中的请求。' : '当前没有你可以停止的请求。')
        } else this.enqueue(state, key, input, '不支持此命令。发送 /help 查看用法。')
        return 'accepted' as const
      }
      if (state.pending.length >= this.config.maxPending || state.pending.filter(item => conversationKey(item.input.conversation) === conversationKey(conversation)).length >= this.config.maxQueuePerRoom) throw new Error('External chat request queue is full; retry later')
      state.pending.push({ key, input, binding: this.binding(input) })
      this.enqueue(state, `${key}:received`, input, '已接收，按当前聊天的顺序处理。')
      return 'accepted' as const
    })
    void this.wake()
    return outcome
  }

  private binding(input: Incoming): Pending['binding'] {
    const privateChat = input.conversation.kind === 'private'
    return { conversation: input.conversation, title: `${input.conversation.provider === 'feishu' ? '飞书' : '如流'} · ${privateChat ? input.message.sender.name : input.conversation.id}`,
      botIds: privateChat ? [this.config.defaultBot] : [...new Set([...this.config.botIds, ...this.config.groupBotIds?.(input.conversation.id) ?? []])], defaultBot: this.config.defaultBot }
  }

  /** Coalesce feed, timer, and inbound callbacks into one worker.
   * @returns completion of currently signaled work; retry deadlines never busy-loop.
   */
  wake(): Promise<void> {
    if (this.closed) return Promise.resolve()
    this.dirty = true
    this.worker ??= this.work().finally(() => { this.worker = undefined; if (this.dirty && !this.closed) void this.wake() })
    return this.worker
  }
  private async work(): Promise<void> {
    while (this.dirty && !this.closed) {
      this.dirty = false
      // Stop may await tools finishing. New arrivals must still acquire the admission lock.
      try { await this.stopPending() } catch { this.report('External chat stop failed; request retained') }
      try { await this.exclusive(() => this.dispatch()) } catch { this.report('External chat processing failed; durable work is retained for the next retry') }
      // A full outbox must still drain, and slow network sends must not hold the admission lock.
      try { await this.deliver() } catch { this.report('External chat delivery settlement failed; durable replies are retained') }
    }
  }
  private async finish(item: Pending, content: string): Promise<void> {
    await this.change((state) => {
      if (!state.pending.some(current => current.key === item.key)) return
      this.enqueue(state, `${item.key}:result`, item.input, content)
      state.pending = state.pending.filter(current => current.key !== item.key)
    })
  }
  private async stopPending(): Promise<void> {
    // Stop commands bypass the busy room queue and only target IDs captured at admission.
    for (const item of [...this.state.pending].filter(item => item.stop)) {
      if (this.closed) return
      if (item.input.conversation.accountId !== this.config.accountId) continue
      for (const messageId of item.stop!.attemptIds) await this.bots.stop({ roomId: item.stop!.roomId, messageId,
        ...(this.config.allowDelegation ? { cascade: true } : {}) })
      await this.finish(item, '已处理停止请求，请在 DSH 中查看执行记录。')
    }
  }
  private async dispatch(): Promise<void> {
    const blocked = new Set<string>()
    for (const item of [...this.state.pending].filter(item => !item.stop)) {
      if (this.closed) return
      if (item.input.conversation.accountId !== this.config.accountId) continue
      if (item.submitted) {
        const snapshot = this.bots.snapshot()
        const room = snapshot.rooms.find(room => room.id === item.submitted!.roomId || room.aliases?.includes(item.submitted!.roomId))
        if (!room) throw new Error('Submitted external room is missing')
        if (item.submitted.attemptIds.some(id => !room.messages.some(message => message.id === id))) throw new Error('Submitted external response is missing')
        const responses = responseTree(room, item.submitted.attemptIds)
        const ready = responses.filter(message => message.status !== 'running' && !item.delivered?.includes(message.id))
        const announcements = responses.filter(message => message.delegation && message.status === 'running' && !item.announced?.includes(message.id))
        const finished = responses.every(message => message.status !== 'running')
        if (ready.length || announcements.length || finished) {
          await this.change(state => {
            const current = state.pending.find(pending => pending.key === item.key)
            if (!current) return
            for (const response of responses) {
              if (announcements.includes(response)) {
                const parent = room.messages.find(message => message.id === response.replyTo)
                const name = snapshot.bots.find(bot => bot.id === parent?.botId)?.name ?? parent?.botId ?? '其他 Bot'
                this.enqueue(state, `${item.key}:accepted:${response.id}`, item.input, `已接单，收到 ${name} 派来的任务，正在处理。`, response.botId ?? this.config.defaultBot)
              }
              if (!ready.includes(response)) continue
              const content = response.status === 'complete' ? response.text || '本次执行完成，没有文字回复。'
                : response.status === 'interrupted' ? '执行已中断，未自动重跑。请部署者在 DSH 中检查执行记录。'
                  : response.status === 'canceled' ? '执行已停止。' : '执行失败，请部署者在 DSH 中检查执行记录。'
              const text = this.config.labelReplies ? `@${response.botId}\n${content}` : content
              // Only actual child reservations produce a platform mention; prose and blocked handoffs do not.
              const mentions = item.input.conversation.kind === 'group' ? responses.flatMap(child => {
                if (!child.delegation || child.replyTo !== response.id || !child.botId) return []
                const id = this.config.mentionId?.(child.botId)
                return id ? [{ id, name: snapshot.bots.find(bot => bot.id === child.botId)?.name ?? child.botId }] : []
              }) : []
              this.enqueue(state, `${item.key}:result:${response.id}`, item.input, text, response.botId ?? this.config.defaultBot, mentions)
            }
            current.delivered = [...(current.delivered ?? []), ...ready.map(message => message.id)]
            current.announced = [...(current.announced ?? []), ...announcements.map(message => message.id)]
            if (finished) state.pending = state.pending.filter(current => current.key !== item.key)
          })
        }
        continue
      }
      const key = conversationKey(item.input.conversation)
      if (blocked.has(key)) continue
      blocked.add(key)
      if ((item.nextAt ?? 0) > Date.now()) continue
      const active = this.bots.snapshot().rooms.filter(room => room.external && room.messages.some(message => message.status === 'running')).length
      if (active >= this.config.maxConcurrentRooms) continue
      // Membership errors are actionable and terminal; storage failures remain retryable.
      const known = this.bots.snapshot().bots.map(bot => bot.id)
      if (item.binding.botIds.some(id => !known.includes(id))) { await this.finish(item, '配置的 Bot 不存在，请部署者检查机器人配置。'); continue }
      let committed = false
      try {
        const room = await this.bots.ensureExternalRoom(item.binding)
        const accepted = await this.bots.submitExternalMessage({ roomId: room.id, text: item.input.text, external: item.input.message, sourceAccountId: item.input.conversation.accountId,
          ...(item.input.attachments ? { attachments: item.input.attachments } : {}),
          ...(this.config.allowDelegation ? { allowDelegation: true } : {}), ...(item.input.targets ? { targets: item.input.targets } : {}) })
        if (accepted.status === 'rejected') { await this.finish(item, accepted.reason === 'room-full' ? '该聊天的历史容量已满，请部署者调整 DSH Bot 的 maxMessages 配置。' : '消息无法提交，请检查文字和 @Bot 是否属于当前聊天。'); continue }
        if (accepted.status === 'accepted') {
          committed = true
          await this.change((state) => {
            const current = state.pending.find(current => current.key === item.key)
            if (current) current.submitted = { roomId: room.id, attemptIds: accepted.attemptIds }
          })
        }
      } catch (cause) {
        // Accepted work already owns a native receipt. Never abandon its response tree
        // because the connector failed to save the acknowledgement in its own domain.
        if (committed) throw cause
        this.report('External chat admission failed; check Bot configuration/storage and retained queue')
        await this.change((state) => {
          const current = state.pending.find(pending => pending.key === item.key)
          if (!current) return
          current.attempts = (current.attempts ?? 0) + 1
          const terminal = isPermanentChatError(cause) || current.attempts >= 8
          if (terminal) {
            (state.failed ??= []).push({ time: Date.now(), reason: isPermanentChatError(cause) ? 'permanent' : 'exhausted', pending: current })
            state.pending = state.pending.filter(pending => pending.key !== item.key)
            this.enqueue(state, `${item.key}:admission-failed`, item.input, '请求未能提交，已停止重试。请部署者检查 Bot 配置或存储后重新发送。')
            return
          }
          current.nextAt = this.retryAt(current.attempts)
          const notice = `${item.key}:admission-error`
          if (state.notices.includes(notice)) return
          this.enqueue(state, notice, item.input, '请求暂未提交，请部署者检查 Bot 配置或存储。消息已保留，系统会重试。')
          state.notices.push(notice)
        })
      }
    }
  }

  private async deliver(): Promise<void> {
    if (this.config.notifyScheduled) await this.scheduledNotifications()
    // Older versions persisted up to 3000 characters. InfoFlow rejects group Markdown
    // over 2048 (40068), so retrying it unchanged would block every later room reply.
    const oversized = (delivery: Delivery) => delivery.conversation.accountId === this.config.accountId
      && delivery.conversation.provider === 'infoflow' && delivery.conversation.kind === 'group' && delivery.text.length > 2048
    if (this.state.outbox.some(oversized)) await this.change(state => {
      // Rechunk already-committed content even when the admission capacity is full.
      // Each replacement is durable before sending, so partial success never replays earlier chunks.
      state.outbox = state.outbox.flatMap(delivery => !oversized(delivery) ? [delivery]
        : splitMessage(delivery.text, this.config.chunkSize, 2048).map((text, index) => ({ ...delivery,
          id: `${delivery.id}:split:${index}`, text, attempts: 0, nextAt: 0, mentions: index === 0 ? delivery.mentions : undefined })))
    })
    const blockedRecipients = new Set<string>()
    for (const delivery of [...this.state.outbox]) {
      if (this.closed) return
      if (delivery.conversation.accountId !== this.config.accountId) { this.report('Retained delivery belongs to another External chat account; restore the original configuration'); continue }
      const key = conversationKey(delivery.conversation)
      if (blockedRecipients.has(key)) continue
      if (delivery.nextAt > Date.now()) { blockedRecipients.add(key); continue }
      try { await this.sender.send(delivery) }
      catch (cause) {
        const terminal = isPermanentChatError(cause) || delivery.attempts + 1 >= 8
        if (!terminal) blockedRecipients.add(key)
        await this.change((state) => {
          const current = state.outbox.find(item => item.id === delivery.id)
          if (!current) return
          current.attempts++
          if (terminal) {
            (state.failed ??= []).push({ time: Date.now(), reason: isPermanentChatError(cause) ? 'permanent' : 'exhausted', delivery: current })
            state.outbox = state.outbox.filter(item => item.id !== delivery.id)
          } else current.nextAt = this.retryAt(current.attempts)
        })
        this.report(terminal ? 'External chat send stopped; failed delivery retained for inspection' : 'External chat send failed; the reply remains queued')
        continue
      }
      await this.change((state) => { state.outbox = state.outbox.filter(item => item.id !== delivery.id) })
    }
  }

  /** Reserve outbound chunks and advance the scan cursor atomically. */
  private async scheduledNotifications(): Promise<void> {
    const rooms = this.bots.snapshot().rooms.filter(room => !room.deleted && room.external?.provider === (this.config.provider ?? 'infoflow')
      && (room.external.kind === 'group' ? this.config.notifyGroup?.(room.external.id) !== false && (this.config.allowAllGroups || this.config.allowGroups.includes(room.external.id))
        : room.external.accountId === this.config.accountId))
    await this.change(state => {
      state.notificationCursors ??= {}
      for (const room of rooms) {
        let cursor = state.notificationCursors[room.id] ?? 0
        for (; cursor < room.messages.length; cursor++) {
          const response = room.messages[cursor]!
          if (!response.botId && response.publishExternal && response.notifyBot && this.config.botIds.includes(response.notifyBot)) {
            this.enqueue(state, `web:${response.id}`, { conversation: { ...room.external!, accountId: this.config.accountId },
              message: { id: response.id, sender: { id: '', name: 'DSH' } }, text: response.text },
              `DSH 用户：${response.text}${response.attachments?.length ? '\n（附件请在 DSH 查看）' : ''}`, response.notifyBot)
          }
          if (!response.botId || !this.config.botIds.includes(response.botId)) continue
          const root = humanRequest(room, response)
          if ((!root?.scheduleId && !root?.publishExternal) || root.localOnly) continue
          if (response.status === 'running' || response.status === 'queued') break
          const conversation = { ...room.external!, accountId: this.config.accountId }
          const sender = [...room.messages].reverse().find(message => message.external)?.external?.sender.id
          if (conversation.kind === 'private' && !this.config.allowUsers.includes(conversation.provider === 'feishu' ? sender ?? '' : conversation.id)) continue
          this.enqueue(state, `scheduled:${response.id}`, { conversation, message: { id: root.id, sender: { id: '', name: 'Scheduler' } }, text: root.text },
            response.status === 'complete' ? response.text || '定时任务已完成。' : `定时任务${response.status}，请在 DSH 查看。`, response.botId)
        }
        state.notificationCursors[room.id] = cursor
      }
    })
  }

  failures(queue: string): FailureView[] {
    return (this.state.failed ?? []).map(item => ({
      provider: this.config.provider ?? 'infoflow', queue, id: item.delivery?.id ?? item.pending!.key,
      time: item.time, kind: item.delivery ? 'delivery' : 'admission', reason: item.reason,
      destination: item.delivery?.conversation.id ?? item.pending!.input.conversation.id,
      text: item.delivery?.text ?? item.pending!.input.text, attempts: item.delivery?.attempts ?? item.pending?.attempts ?? 0,
    }))
  }

  async resolveFailure(id: string, action: 'retry' | 'discard'): Promise<void> {
    await this.change(state => {
      const failed = state.failed?.find(item => (item.delivery?.id ?? item.pending?.key) === id)
      if (!failed) throw new Error('Failed work no longer exists')
      if (action === 'retry') {
        if (failed.delivery) {
          if (state.outbox.length >= this.config.maxOutbox) throw new Error('Outbox is full')
          state.outbox.push({ ...failed.delivery, attempts: 0, nextAt: 0 })
        } else if (failed.pending) {
          if (state.pending.length >= this.config.maxPending) throw new Error('Admission queue is full')
          state.pending.push({ ...failed.pending, attempts: 0, nextAt: 0 })
        }
      }
      state.failed = state.failed!.filter(item => item !== failed)
    })
    void this.wake().catch(() => this.report('Failed work retry could not be reconciled'))
  }

  private retryAt(attempts: number): number {
    return Date.now() + Math.min(this.config.maxRetryMs, this.config.retryMs * 2 ** Math.min(attempts - 1, 20))
  }

  /** Notify the original destination about native human interaction without answering it.
   * @param sessionId - native Session requesting attention.
   * @param noticeId - stable approval/tool identifier for deduplication.
   */
  async attention(sessionId: SessionId, noticeId: string): Promise<void> {
    if (this.closed) return
    const room = this.bots.snapshot().rooms.find(room => room.members.some(member => member.sessionId === sessionId))
    if (!room?.external || room.external.provider !== (this.config.provider ?? 'infoflow')) return
    const shared = room.external.kind === 'group'
    if (!shared && room.external.accountId !== this.config.accountId) return
    const member = room.members.find(member => member.sessionId === sessionId)!
    const attempt = room.messages.find(message => message.botId === member.botId && message.status === 'running')
    if (!attempt) return
    const pending = this.state.pending.find(item => item.submitted && responseTree(room, item.submitted.attemptIds).some(message => message.id === attempt.id))
    if (shared && !pending && !this.config.botIds.includes(member.botId)) return
    const parent = humanRequest(room, attempt)
    const senderId = parent?.external?.sources?.find(source => source.accountId === this.config.accountId)?.senderId ?? parent?.external?.sender.id
    const input = pending?.input
      ?? (!attempt.delegation && parent?.external && senderId ? { conversation: { ...room.external, accountId: this.config.accountId },
        message: { ...parent.external, sender: { ...parent.external.sender, id: senderId } }, text: parent.text, targets: [member.botId] } : undefined)
    if (!input) return
    const key = `${sessionId}:${attempt.id}:${noticeId}`
    await this.change((state) => {
      if (state.notices.includes(key)) return
      this.enqueue(state, `attention:${key}`, input, `@${member.botId} 请求了人工处理。请部署者在 DSH 对应外部聊天中打开执行会话。`, member.botId)
      state.notices.push(key)
    })
    void this.wake()
  }

  /** Stop taking work and await in-flight persistence/sending; Bot execution remains owned by DSH. */
  async close(): Promise<void> { this.closed = true; await this.worker; await this.operations; await this.tail }
}
