/** Per-Bot ownership and user-confirmed registration; no platform credentials reach the UI. */
import { createHash, randomUUID } from 'node:crypto'
import type { Bot, BotId, Room } from '../types.ts'
import type { Binding, RegistrationRecord, Settings } from './settings.ts'
import type { CreateFeishuGroupRequest, FeishuGroupView, Brand, FeishuBindingView, FeishuControl, FeishuRegistration, FeishuState, SaveFeishuBindingRequest } from './types.ts'
import { GroupCreateError, type GroupOptions, type Identity, type RegistrationOptions, type RegistrationResult } from './sdk.ts'
export interface ManagerRuntime {
  createGroup(binding: Binding, secret: string, options: GroupOptions): Promise<string>
  linkGroup(group: FeishuGroupView, bindings: Binding[]): Promise<Room>
  bots(): Bot[]
  identity(appId: string, secret: string, brand: Brand): Promise<Identity>
  register(options: RegistrationOptions): Promise<RegistrationResult>
  qrImage(url: string): Promise<string>
  resolve(ref: string): Promise<string | undefined>
  unset(ref: string): Promise<void>
  set(ref: string, secret: string): Promise<void>
  start(binding: Binding): Promise<void>
  stop(botId: BotId): Promise<void>
}
export interface SettingsStore { get(): Settings; set(value: Settings): Promise<void> }
interface RegistrationJob { done: boolean; controller: AbortController; task?: Promise<void>; view: FeishuRegistration }
const active = (status: FeishuRegistration['status']) => ['starting', 'waiting', 'saving'].includes(status)
function ids(values: string[], prefix: 'ou_' | 'oc_'): string[] {
  const result = [...new Set(values.map(value => value.trim()).filter(Boolean))]
  if (result.length > 1000 || result.some(value => !new RegExp(`^${prefix}[a-zA-Z0-9_-]+$`).test(value))) throw new Error(`请填写 ${prefix} 开头的飞书 ID，用逗号分隔`)
  return result
}
function appId(value: string): string { const id = value.trim(); if (!/^cli_[a-zA-Z0-9_-]+$/.test(id)) throw new Error('请填写 cli_ 开头的 App ID'); return id }
export class FeishuManager implements FeishuControl {
  private state: Settings
  private tail: Promise<unknown> = Promise.resolve()
  private closed = false
  private readonly jobs = new Map<string, RegistrationJob>()
  private readonly statuses = new Map<BotId, { status: FeishuBindingView['status']; error: string | null }>()
  constructor(private readonly store: SettingsStore, private readonly runtime: ManagerRuntime) { this.state = structuredClone(store.get()) }
  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const next = this.tail.then(action); this.tail = next.catch(() => {}); return next
  }
  private async change(action: (draft: Settings) => void): Promise<void> {
    const draft = structuredClone(this.state); action(draft); await this.store.set(draft); this.state = draft
  }
  private ensureOpen(): void { if (this.closed) throw new Error('飞书管理器正在关闭') }
  private get(botId: BotId): Binding { const item = this.state.bindings.find(value => value.botId === botId); if (!item) throw new Error('请先绑定这个 Bot 的飞书机器人'); return item }
  private view(binding: Binding): FeishuBindingView {
    const { secretRef, ...rest } = binding
    return { ...rest, allowUsers: [...binding.allowUsers], allowGroups: [...binding.allowGroups], allowAllGroups: binding.allowAllGroups === true, admins: [...binding.admins], credentialsConfigured: !!secretRef,
      ...(this.statuses.get(binding.botId) ?? { status: binding.enabled ? 'connecting' : 'disabled', error: null }) }
  }
  private registration(record: RegistrationRecord): FeishuRegistration {
    return structuredClone(this.jobs.get(record.attemptId)?.view ?? { ...record, url: null, qrDataUrl: null, expiresAt: null })
  }
  snapshot(): FeishuState { return { available: true, bindings: this.state.bindings.map(binding => this.view(binding)), registrations: this.state.registrations.map(record => this.registration(record)), groups: structuredClone(this.state.groups) } }
  connection(botId: BotId, status: FeishuBindingView['status'], error: string | null = null): void { this.statuses.set(botId, { status, error }) }
  private unique(id: string, botId: BotId): void {
    if (this.state.bindings.some(binding => binding.botId !== botId && binding.appId === id)) throw new Error('这个飞书应用已绑定到其他 Bot')
  }
  private async secret(binding: Binding): Promise<string> { const secret = await this.runtime.resolve(binding.secretRef); if (!secret) throw new Error('请恢复机器人凭据或重新填写 App Secret'); return secret }
  private async checked(binding: Binding, secret: string): Promise<Binding> {
    try { const identity = await this.runtime.identity(binding.appId, secret, binding.brand); return { ...binding, botOpenId: identity.openId, robotName: identity.name } }
    catch { throw new Error('验证失败，请检查凭据、机器人能力、应用发布状态和网络') }
  }
  private async activate(binding: Binding): Promise<void> {
    this.connection(binding.botId, 'connecting')
    try { await this.runtime.start(binding) } catch { this.connection(binding.botId, 'error', '连接启动失败，请验证机器人并重新启用') }
  }
  async init(): Promise<void> {
    if (this.state.registrations.some(record => active(record.status))) await this.change(state => {
      for (const record of state.registrations) if (active(record.status)) { record.status = 'interrupted'; record.message = '服务重启中断了授权。请先检查飞书后台是否已经创建应用，再决定绑定已有应用或重新扫码。' }
    })
    if (this.state.groups.some(group => group.status === 'creating')) await this.change(state => {
      for (const group of state.groups) if (group.status === 'creating') { group.status = 'uncertain'; group.error = '服务重启中断了建群，请继续同一次请求' }
    })
    // Restore the shared room pointer before receivers can admit new messages.
    for (const group of this.state.groups) if (group.chatId) {
      const bindings = group.botIds.map(id => this.get(id))
      const room = await this.runtime.linkGroup(group, bindings)
      if (group.roomId !== room.id) await this.change(state => { state.groups.find(item => item.requestId === group.requestId)!.roomId = room.id })
    }
    for (const binding of this.state.bindings) if (binding.enabled) await this.activate(binding)
  }
  createGroup(request: CreateFeishuGroupRequest): Promise<Room> { return this.exclusive(async () => {
    this.ensureOpen()
    const title = request.title.trim(), botIds = [...new Set(request.botIds)].sort()
    if (!/^[a-zA-Z0-9_-]{8,50}$/.test(request.requestId) || !title || title.length > 120) throw new Error('请填写有效群名和建群请求 ID')
    if (!botIds.length || botIds.length > 6 || !botIds.includes(request.creatorBot)) throw new Error('请选择 1–6 个机器人，并指定其中一个建群')
    const previous = this.state.groups.find(group => group.requestId === request.requestId)
    const creator = this.get(request.creatorBot)
    const owner = request.owner?.trim() || previous?.owner || creator.admins[0] || creator.allowUsers[0] || ''
    if (!/^ou_[a-zA-Z0-9_-]+$/.test(owner)) throw new Error('请填写建群机器人所属应用下的群主 Open ID，或先配置该机器人的管理员')
    if (previous) {
      if (previous.title !== title || previous.creatorBot !== request.creatorBot || previous.owner !== owner || JSON.stringify(previous.botIds) !== JSON.stringify(botIds)) throw new Error('已提交的建群请求不能修改，请继续原请求')
      return this.finishGroup(previous)
    }
    const group: FeishuGroupView = { requestId: request.requestId, title, botIds, creatorBot: request.creatorBot, owner, createdAt: Date.now(), chatId: null, roomId: null, status: 'creating', error: null }
    this.groupBindings(group)
    await this.change(state => { state.groups.push(group) })
    return this.finishGroup(group, true)
  }) }
  resumeGroup(requestId: string): Promise<Room> { return this.exclusive(async () => {
    this.ensureOpen()
    const group = this.state.groups.find(item => item.requestId === requestId)
    if (!group) throw new Error('建群请求不存在')
    return this.finishGroup(group)
  }) }
  private groupBindings(group: FeishuGroupView): Binding[] {
    const bindings = group.botIds.map(id => {
      if (!this.runtime.bots().some(bot => bot.id === id)) throw new Error(`Bot ${id} 不存在`)
      const binding = this.get(id)
      if (!binding.enabled) throw new Error(`请先启用 ${id} 的飞书连接`)
      return binding
    })
    if (new Set(bindings.map(binding => binding.brand)).size !== 1) throw new Error('飞书与 Lark 机器人不能混合建群')
    return bindings
  }
  private async finishGroup(saved: FeishuGroupView, firstSubmission = false): Promise<Room> {
    const group = structuredClone(saved)
    if (group.status === 'failed') throw new Error('此建群请求已失败，请编辑配置并提交新请求')
    const bindings = this.groupBindings(group), creator = this.get(group.creatorBot)
    if (group.status === 'ready' && group.chatId) return this.runtime.linkGroup(group, bindings)
    const persist = async () => { await this.change(state => { state.groups = state.groups.map(item => item.requestId === group.requestId ? structuredClone(group) : item) }) }
    if (!group.chatId) {
      // A later rejection cannot prove whether an earlier unconfirmed call created the group.
      const priorUnconfirmed = !firstSubmission && (group.status === 'uncertain' || group.status === 'creating')
      // Stop one hour before Feishu's ten-hour deduplication expiry; never risk recreating an unknown group.
      if (Date.now() - group.createdAt >= 9 * 60 * 60 * 1000) throw new Error('请求去重时限已过，请先在飞书确认建群结果；已有群可通过群 ID 手动接入')
      group.status = 'creating'; group.error = null; await persist()
      try {
        group.chatId = await this.runtime.createGroup(creator, await this.secret(creator), { requestId: group.requestId, title: group.title, owner: group.owner,
          botAppIds: bindings.filter(binding => binding.botId !== creator.botId).map(binding => binding.appId) })
      } catch (cause) {
        group.status = cause instanceof GroupCreateError && !priorUnconfirmed ? 'failed' : 'uncertain'
        group.error = cause instanceof GroupCreateError ? cause.message : '建群结果待确认，请继续同一次请求；不要重复新建'
        await persist(); throw new Error(group.error)
      }
      group.status = 'linking'; await persist()
    }
    try {
      const chatId = group.chatId
      await this.change(state => {
        for (const binding of state.bindings) if (group.botIds.includes(binding.botId) && !binding.allowGroups.includes(chatId)) binding.allowGroups.push(chatId)
      })
      const room = await this.runtime.linkGroup(group, bindings)
      // Restart also on a retry: a previous process may have committed settings before replacing its receiver.
      for (const id of group.botIds) { await this.runtime.stop(id); await this.activate(this.get(id)) }
      if (group.botIds.some(id => this.statuses.get(id)?.status === 'error')) throw new Error('连接启动失败')
      group.roomId = room.id; group.status = 'ready'; group.error = null; await persist()
      return room
    } catch {
      group.status = 'linking'; group.error = '飞书群已创建，接入尚未完成。点击继续完成，不会重复建群。'
      await persist(); throw new Error(group.error)
    }
  }
  save(request: SaveFeishuBindingRequest): Promise<FeishuBindingView> { return this.exclusive(async () => {
    this.ensureOpen()
    if (!this.runtime.bots().some(bot => bot.id === request.botId)) throw new Error('Bot 不存在')
    if ([...this.jobs.values()].some(job => job.view.botId === request.botId && !job.done)) throw new Error('请先完成或取消正在进行的扫码授权')
    const previous = this.state.bindings.find(binding => binding.botId === request.botId)
    const id = appId(request.appId); this.unique(id, request.botId)
    if (previous && (previous.appId !== id || previous.brand !== request.brand)) throw new Error('已绑定 Bot 不能直接更换应用；请为新应用创建一个新的 DSH Bot')
    const secret = request.appSecret?.trim() || (previous ? await this.secret(previous) : '')
    if (!secret) throw new Error('首次绑定需要 App Secret')
    const base: Binding = { botId: request.botId, appId: id, brand: request.brand, botOpenId: '', robotName: id, enabled: previous?.enabled ?? false,
      secretRef: `DSH_FEISHU_${randomUUID().replaceAll('-', '').toUpperCase()}_SECRET`, allowUsers: ids(request.allowUsers, 'ou_'), allowGroups: ids(request.allowGroups, 'oc_'),
      allowAllGroups: request.allowAllGroups ?? previous?.allowAllGroups ?? false, admins: ids(request.admins, 'ou_') }
    const binding = await this.checked(base, secret)
    try {
      await this.runtime.set(binding.secretRef, secret)
      await this.change(state => { state.bindings = [...state.bindings.filter(item => item.botId !== request.botId), binding] })
    } catch (cause) {
      await this.runtime.unset(binding.secretRef).catch(() => {})
      throw cause
    }
    if (previous) await this.runtime.unset(previous.secretRef).catch(() => {})
    await this.runtime.stop(binding.botId)
    if (binding.enabled) await this.activate(binding); else this.connection(binding.botId, 'disabled')
    return this.view(binding)
  }) }
  verify(botId: BotId): Promise<FeishuBindingView> { return this.exclusive(async () => {
    this.ensureOpen(); const current = this.get(botId), verified = await this.checked(current, await this.secret(current))
    await this.change(state => { state.bindings = state.bindings.map(item => item.botId === botId ? verified : item) })
    return this.view(verified)
  }) }
  toggle(request: { botId: BotId; enabled: boolean }): Promise<FeishuBindingView> { return this.exclusive(async () => {
    this.ensureOpen(); let binding = { ...this.get(request.botId), enabled: request.enabled }
    if (binding.enabled) binding = await this.checked(binding, await this.secret(binding))
    await this.change(state => { state.bindings = state.bindings.map(item => item.botId === binding.botId ? binding : item) })
    await this.runtime.stop(binding.botId)
    if (binding.enabled) await this.activate(binding); else this.connection(binding.botId, 'disabled')
    return this.view(binding)
  }) }
  register(botId: BotId): Promise<FeishuRegistration> { return this.exclusive(async () => {
    this.ensureOpen()
    const bot = this.runtime.bots().find(item => item.id === botId)
    if (!bot) throw new Error('Bot 不存在')
    const inFlight = [...this.jobs.values()].find(job => job.view.botId === botId && !job.done)
    if (inFlight) return structuredClone(inFlight.view)
    for (const [key, job] of this.jobs) if (job.view.botId === botId && job.done) this.jobs.delete(key)
    const pending = this.state.registrations.find(record => record.botId === botId && active(record.status))
    if (pending) return this.registration(pending)
    if (this.state.bindings.some(binding => binding.botId === botId)) throw new Error('这个 Bot 已绑定机器人，不能重复创建')
    const attemptId = randomUUID()
    const record: RegistrationRecord = { botId, attemptId, status: 'starting', message: null }
    await this.change(state => { state.registrations = [...state.registrations.filter(item => item.botId !== botId), record] })
    const job: RegistrationJob = { done: false, controller: new AbortController(), view: { ...record, url: null, qrDataUrl: null, expiresAt: null } }
    this.jobs.set(attemptId, job)
    job.task = this.runRegistration(job, bot.name).finally(() => { job.done = true })
    return this.registration(record)
  }) }
  private async settle(job: RegistrationJob, status: FeishuRegistration['status'], message: string | null): Promise<void> {
    await this.change(state => { const record = state.registrations.find(item => item.attemptId === job.view.attemptId); if (record) { record.status = status; record.message = message } })
    job.view = { ...job.view, status, message, url: null, qrDataUrl: null, expiresAt: null }
  }
  private async runRegistration(job: RegistrationJob, name: string): Promise<void> {
    try {
      const result = await this.runtime.register({ name, signal: job.controller.signal, qr: info => {
        if (job.controller.signal.aborted || job.view.status !== 'starting') return
        job.view = { ...job.view, status: 'waiting', url: null, qrDataUrl: null, expiresAt: Date.now() + info.expireIn * 1000 }
        // Generate locally: no third-party QR service receives the authorization URL.
        void this.runtime.qrImage(info.url).then(qrDataUrl => {
          if (job.view.status === 'waiting' && !job.controller.signal.aborted) job.view = { ...job.view, url: info.url, qrDataUrl }
        }).catch(() => { job.controller.abort() })
      } })
      await this.exclusive(async () => {
        job.view = { ...job.view, status: 'saving', url: null, qrDataUrl: null }
        const id = appId(result.client_id); this.unique(id, job.view.botId)
        if (!result.client_secret) throw new Error('No application credentials returned')
        const owner = result.user_info?.open_id
        const allowUsers = owner && /^ou_[\w-]+$/.test(owner) ? [owner] : []
        const binding: Binding = { botId: job.view.botId, appId: id, botOpenId: '', robotName: name, brand: result.user_info?.tenant_brand === 'lark' ? 'lark' : 'feishu',
          enabled: false, secretRef: `DSH_FEISHU_${createHash('sha256').update(job.view.attemptId).digest('hex').toUpperCase()}_SECRET`, allowUsers, admins: [...allowUsers], allowGroups: [] }
        // Persist returned credentials before the follow-up identity request; newly created apps may not be ready yet.
        await this.runtime.set(binding.secretRef, result.client_secret)
        await this.change(state => { state.bindings.push(binding) })
        let notice = '机器人已创建并绑定。请核对授权页的权限范围，然后启用连接。'
        try {
          const verified = await this.checked(binding, result.client_secret)
          await this.change(state => { state.bindings = state.bindings.map(item => item.botId === binding.botId ? verified : item) })
        } catch { notice = '凭据已安全保存，但机器人暂未就绪。请检查飞书应用发布状态，再点击验证机器人；无需再次创建。' }
        await this.settle(job, 'complete', notice)
      })
    } catch {
      await this.exclusive(async () => {
        if (job.view.status === 'complete' || job.view.status === 'canceled') return
        const expired = job.view.expiresAt !== null && Date.now() >= job.view.expiresAt
        await this.settle(job, this.closed ? 'interrupted' : expired ? 'expired' : job.controller.signal.aborted ? 'canceled' : 'error',
          this.closed ? '服务已停止，请先检查飞书后台是否已经创建应用。' : expired ? '二维码已过期，可以重新发起扫码。' : job.controller.signal.aborted ? '已取消等待。若已在飞书确认创建，请使用已有应用绑定。' : '创建或保存未完成，请先检查飞书后台；不要重复创建已有应用。')
      }).catch(() => { job.view = { ...job.view, status: 'error', message: '无法保存授权结果，请检查 DSH 存储和飞书后台。', url: null, qrDataUrl: null } })
    }
  }
  cancel(attemptId: string): Promise<void> { return this.exclusive(async () => {
    this.ensureOpen(); const job = this.jobs.get(attemptId)
    if (!job || !active(job.view.status)) return
    if (job.view.status === 'saving') throw new Error('凭据正在保存，请稍候')
    job.controller.abort()
    await this.settle(job, 'canceled', '已取消等待。若已在飞书确认创建，请使用已有应用绑定。')
  }) }
  async close(): Promise<void> { this.closed = true; for (const job of this.jobs.values()) job.controller.abort(); await Promise.allSettled([...this.jobs.values()].map(job => job.task)); await this.tail }
}
