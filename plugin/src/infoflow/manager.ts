/** Per-Bot robot ownership, credential references and durable group creation. */
import { createHash, randomUUID } from 'node:crypto'
import type { InfoFlowControl } from './control.ts'
import type { Binding, Settings } from './settings.ts'
import type { BotId, CreateInfoFlowGroupRequest, InfoFlowBindingView, InfoFlowGroupView, InfoFlowState, Room, SaveInfoFlowBindingRequest, ToggleInfoFlowRequest, TestInfoFlowRequest } from '../types.ts'
import type { RobotApi, RobotIdentity } from './sdk.ts'

export interface ManagerRuntime {
  bots(): BotId[]
  api(binding: Binding, credentials: { appKey: string; appSecret: string }): RobotApi
  resolve(ref: string): Promise<string | undefined>
  unset(ref: string): Promise<void>
  set(ref: string, value: string): Promise<void>
  start(binding: Binding): Promise<void>
  stop(botId: BotId): Promise<void>
  link(group: InfoFlowGroupView): Promise<Room>
}
export interface SettingsStore { get(): Settings; set(value: Settings): Promise<void> }
/** Parse IDs without silently losing precision in SDK responses. */
function identityId(value: unknown): string {
  if (typeof value === 'string' && /^\d+$/.test(value) && !/^0+$/.test(value)) return value
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value)
  throw new Error('平台未返回有效的机器人或群 ID，请检查应用权限')
}
function users(values: string[]): string[] {
  const list = [...new Set(values.map(value => value.trim().replace(/@baidu\.com$/i, '')))].filter(Boolean)
  if (list.length > 1000 || list.some(value => !/^[a-zA-Z0-9._-]+$/.test(value))) throw new Error('请填写账号前缀，用逗号分隔')
  return list
}
function groups(values: string[]): string[] { return [...new Set(values.filter(Boolean).map(identityId))] }
/** All configuration operations are serialized; SDK callbacks never run inside this lock. */
export class InfoFlowManager implements InfoFlowControl {
  private state: Settings
  private tail: Promise<unknown> = Promise.resolve()
  private closed = false
  private statuses = new Map<BotId, { status: InfoFlowBindingView['status']; error: string | null }>()
  constructor(private readonly store: SettingsStore, private readonly runtime: ManagerRuntime) { this.state = structuredClone(store.get()) }
  private exclusive<T>(action: () => Promise<T>): Promise<T> {
    const operation = this.tail.then(() => { if (this.closed) throw new Error('如流管理器正在关闭'); return action() })
    this.tail = operation.catch(() => {})
    return operation
  }
  private async change(action: (draft: Settings) => void): Promise<void> {
    const draft = structuredClone(this.state); action(draft); await this.store.set(draft); this.state = draft
  }
  private binding(id: BotId): Binding {
    const binding = this.state.bindings.find(item => item.botId === id)
    if (!binding) throw new Error('请先保存这个 Bot 的如流配置')
    return binding
  }
  private view(binding: Binding): InfoFlowBindingView {
    return { botId: binding.botId, agentId: binding.agentId, robotId: binding.robotId, robotName: binding.robotName,
      enabled: binding.enabled, allowUsers: [...binding.allowUsers], allowGroups: [...binding.allowGroups], allowAllGroups: binding.allowAllGroups === true, admins: [...binding.admins],
      credentialsConfigured: !!binding.appKeyRef && !!binding.appSecretRef,
      ...(this.statuses.get(binding.botId) ?? { status: binding.enabled ? 'connecting' : 'disabled', error: null }) }
  }
  snapshot(): InfoFlowState { return { available: true, bindings: this.state.bindings.map(binding => this.view(binding)), groups: structuredClone(this.state.groups), groupInviteAllowlist: [...(this.state.groupInviteAllowlist ?? [])] } }
  /** Local operator policy; messaging access and historical invitations never grant invitation rights. */
  saveGroupInviteAllowlist(values: string[]): Promise<string[]> {
    return this.exclusive(async () => {
      const allowed = users(values)
      await this.change(state => { state.groupInviteAllowlist = allowed })
      return [...allowed]
    })
  }
  /** Runtime reports connection categories, never SDK exception objects. */
  connection(botId: BotId, status: InfoFlowBindingView['status'], error: string | null = null): void { this.statuses.set(botId, { status, error }) }
  private async secrets(binding: Binding) {
    const [appKey, appSecret] = await Promise.all([this.runtime.resolve(binding.appKeyRef), this.runtime.resolve(binding.appSecretRef)])
    if (!appKey || !appSecret) throw new Error('请填写 AppKey 和 AppSecret，或恢复已保存的凭据')
    return { appKey, appSecret }
  }
  private async identity(binding: Binding, secrets: { appKey: string; appSecret: string }): Promise<RobotIdentity> {
    try { return await this.runtime.api(binding, secrets).identity() }
    catch { throw new Error('机器人验证失败，请检查凭据、网络和机器人详情查询权限') }
  }
  private checked(binding: Binding, info: RobotIdentity): Binding {
    const agentId = identityId(info.agentId), robotId = identityId(info.imId)
    if (this.state.bindings.some(item => item.botId !== binding.botId && (item.agentId === agentId || item.robotId === robotId))) throw new Error('这个如流机器人已经绑定到另一个 Bot')
    if (binding.agentId && agentId !== binding.agentId && (binding.enabled || this.state.groups.some(group => group.botIds.includes(binding.botId)))) throw new Error('停用连接且没有关联群聊的 Bot 才能更换机器人')
    return { ...binding, agentId, robotId, robotName: info.name || agentId }
  }
  async init(seed?: Binding): Promise<void> {
    if (seed && !this.state.bindings.length) await this.change(state => { state.bindings.push({ ...seed, enabled: false }) })
    if (this.state.groups.some(group => group.status === 'creating')) await this.change(state => {
      for (const group of state.groups) if (group.status === 'creating') { group.status = 'uncertain'; group.warning = '上次建群结果未确认，请先在如流检查；系统不会重复建群。' }
    })
    for (const binding of this.state.bindings) if (binding.enabled) await this.activate(binding)
    for (const group of this.state.groups) if (group.groupId) {
      try { await this.runtime.link(group) } catch { /* The saved group remains recoverable through resumeGroup. */ }
    }
  }
  private async activate(binding: Binding): Promise<void> {
    this.connection(binding.botId, 'connecting')
    try { await this.runtime.start(binding) } catch { this.connection(binding.botId, 'error', '连接启动失败，请验证凭据后重新启用') }
  }
  save(request: SaveInfoFlowBindingRequest): Promise<InfoFlowBindingView> {
    return this.exclusive(async () => {
      if (!this.runtime.bots().includes(request.botId)) throw new Error('Bot 不存在')
      const previous = this.state.bindings.find(item => item.botId === request.botId)
      const base: Binding = previous ?? { botId: request.botId, agentId: '', robotId: '', robotName: '', enabled: false,
        appKeyRef: '', appSecretRef: '', allowUsers: [], allowGroups: [], admins: [] }
      const [savedKey, savedSecret] = await Promise.all([base.appKeyRef ? this.runtime.resolve(base.appKeyRef) : undefined, base.appSecretRef ? this.runtime.resolve(base.appSecretRef) : undefined])
      const secrets = { appKey: request.appKey?.trim() || savedKey || '', appSecret: request.appSecret?.trim() || savedSecret || '' }
      if (!secrets.appKey || !secrets.appSecret) throw new Error('首次绑定需要 AppKey 和 AppSecret')
      const list = { allowUsers: users(request.allowUsers), allowGroups: groups(request.allowGroups), admins: users(request.admins) }
      const expectedId = request.agentId?.trim() ? identityId(request.agentId.trim()) : undefined
      const verified = this.checked(base, await this.identity({ ...base, agentId: expectedId ?? base.agentId }, secrets))
      if (expectedId && expectedId !== verified.agentId) throw new Error('应用 ID 与凭据对应的机器人不一致，请重新复制同一个应用的凭据')
      // New references make credential replacement atomic with the settings commit, preserving existing bindings on failure.
      const suffix = createHash('sha256').update(`${request.botId}:${randomUUID()}`).digest('hex').slice(0, 24).toUpperCase()
      const binding: Binding = { ...verified, ...list, enabled: request.connect === true || verified.enabled,
        allowAllGroups: request.allowAllGroups ?? base.allowAllGroups ?? false, appKeyRef: `DSH_BOT_${suffix}_KEY`, appSecretRef: `DSH_BOT_${suffix}_SECRET` }
      try {
        await this.runtime.set(binding.appKeyRef, secrets.appKey); await this.runtime.set(binding.appSecretRef, secrets.appSecret)
        await this.change(state => { state.bindings = [...state.bindings.filter(item => item.botId !== request.botId), binding] })
      } catch (cause) {
        await Promise.allSettled([binding.appKeyRef, binding.appSecretRef].map(ref => this.runtime.unset(ref)))
        throw cause
      }
      if (previous) await Promise.allSettled([previous.appKeyRef, previous.appSecretRef].map(ref => this.runtime.unset(ref)))
      await this.runtime.stop(binding.botId)
      if (binding.enabled) await this.activate(binding); else this.connection(binding.botId, 'disabled')
      return this.view(binding)
    })
  }
  verify(botId: BotId): Promise<InfoFlowBindingView> {
    return this.exclusive(async () => {
      const binding = this.binding(botId)
      const verified = this.checked(binding, await this.identity(binding, await this.secrets(binding)))
      await this.change(state => { state.bindings = state.bindings.map(item => item.botId === botId ? verified : item) })
      return this.view(verified)
    })
  }
  toggle(request: ToggleInfoFlowRequest): Promise<InfoFlowBindingView> {
    return this.exclusive(async () => {
      let binding = { ...this.binding(request.botId), enabled: request.enabled }
      if (request.enabled) binding = this.checked(binding, await this.identity(binding, await this.secrets(binding)))
      await this.change(state => { state.bindings = state.bindings.map(item => item.botId === request.botId ? binding : item) })
      await this.runtime.stop(binding.botId)
      if (binding.enabled) await this.activate(binding); else this.connection(binding.botId, 'disabled')
      return this.view(binding)
    })
  }
  testMessage(request: TestInfoFlowRequest): Promise<void> {
    return this.exclusive(async () => {
      const binding = this.binding(request.botId)
      const user = users([request.user])[0]
      if (!user || !binding.allowUsers.includes(user)) throw new Error('测试接收者必须是已保存的允许私聊账号')
      await this.runtime.api(binding, await this.secrets(binding)).testMessage(user)
    })
  }
  createGroup(request: CreateInfoFlowGroupRequest): Promise<Room> {
    return this.exclusive(async () => {
      const previous = this.state.groups.find(group => group.requestId === request.requestId)
      if (previous) {
        if (previous.title !== request.title.trim() || previous.owner !== users([request.owner])[0] || previous.defaultBot !== request.defaultBot
          || JSON.stringify(previous.botIds) !== JSON.stringify([...new Set(request.botIds)]) || JSON.stringify(previous.members) !== JSON.stringify(users(request.members))) throw new Error('同一建群请求不能更改群名、群主、成员或 Bot')
        return this.finishGroup(previous)
      }
      if (!/^[a-zA-Z0-9_-]{8,80}$/.test(request.requestId) || !request.title.trim() || request.title.length > 120) throw new Error('请填写群名')
      const ids = [...new Set(request.botIds)]
      if (!ids.length || ids.length > 8 || !ids.includes(request.defaultBot) || ids.some(id => !this.runtime.bots().includes(id))) throw new Error('请选择 1–8 个有效 Bot 和默认 Bot')
      const bindings = ids.map(id => this.binding(id))
      if (bindings.some(binding => !binding.enabled)) throw new Error('请先绑定并启用所选 Bot 的如流机器人')
      const owner = users([request.owner])[0]
      if (!owner) throw new Error('请填写群主账号')
      const members = users(request.members)
      const allowed = new Set(this.state.groupInviteAllowlist ?? [])
      const rejected = [...new Set([owner, ...members])].filter(user => !allowed.has(user))
      if (rejected.length) throw new Error(`群主和真人成员必须在建群邀请白名单中：${rejected.join('、')}。请先到 IM 接入 → 如流配置白名单，再核对要邀请的账号。`)
      const primary = this.binding(request.defaultBot)
      const api = this.runtime.api(primary, await this.secrets(primary))
      const record: InfoFlowGroupView = { requestId: request.requestId, title: request.title.trim(), botIds: ids, defaultBot: request.defaultBot,
        owner, members, groupId: '', roomId: null, status: 'creating', warning: null }
      const robots = bindings.map(binding => { const value = Number(binding.agentId); if (!Number.isSafeInteger(value) || value <= 0) throw new Error('机器人 Agent ID 超出 SDK 支持范围'); return value })
      await this.change(state => { state.groups.push(record) })
      let groupId = ''
      try {
        const result = await api.createGroup({ groupName: record.title, groupOwner: owner, memberList: members, robotList: robots })
        groupId = identityId(result.groupId)
        const warning = (result.failList?.length || result.failRobotIds?.length) ? `群已创建；部分成员未加入，请在如流处理。用户：${result.failList?.join(', ') || '无'}；机器人：${result.failRobotIds?.join(', ') || '无'}` : null
        await this.change(state => { const group = state.groups.find(item => item.requestId === request.requestId)!; group.groupId = groupId; group.status = 'linking'; group.warning = warning })
      } catch {
        await this.change(state => { const group = state.groups.find(item => item.requestId === request.requestId)!; group.status = 'uncertain'; group.warning = groupId ? `如流群 ${groupId} 已创建，但本地记录未确认；请勿重复建群。` : '建群结果未确认，请先到如流检查；系统不会自动再次建群。'; if (groupId) group.groupId = groupId })
        throw new Error(groupId ? `如流群 ${groupId} 已创建，请在接入页面恢复关联` : '建群结果未确认，请先到如流检查，避免重复建群')
      }
      return this.finishGroup(this.state.groups.find(item => item.requestId === request.requestId)!)
    })
  }
  private async finishGroup(group: InfoFlowGroupView): Promise<Room> {
    if (!group.groupId) throw new Error('这次建群结果尚未确认，请在如流检查；不能重复创建')
    const room = await this.runtime.link(group)
    await this.change(state => { const item = state.groups.find(item => item.requestId === group.requestId)!; item.roomId = room.id; item.status = 'ready' })
    return room
  }
  attachGroup(request: { requestId: string; groupId: string }): Promise<Room> { return this.exclusive(async () => {
    const group = this.state.groups.find(item => item.requestId === request.requestId)
    if (!group || group.status !== 'uncertain' || group.groupId) throw new Error('Only an uncertain request without a saved group ID can be attached')
    if (!/^[1-9]\d*$/.test(request.groupId) || !Number.isSafeInteger(Number(request.groupId))) throw new Error('Invalid InfoFlow group ID')
    if (this.state.groups.some(item => item.groupId === request.groupId)) throw new Error('This group is already linked')
    const binding = this.binding(group.defaultBot), api = this.runtime.api(binding, await this.secrets(binding))
    if (!api.groupInfo) throw new Error('Update the InfoFlow SDK to verify group ownership')
    const info = await api.groupInfo(request.groupId)
    if (String(info.groupId) !== request.groupId || users([info.masterUserId])[0] !== group.owner) throw new Error('Group identity or owner does not match the original request')
    if (group.botIds.some(id => !info.agentIds.includes(this.binding(id).agentId))) throw new Error('Add every selected robot to this group before attaching it')
    await this.change(state => { const item = state.groups.find(item => item.requestId === request.requestId)!; item.groupId = request.groupId; item.status = 'linking'; item.warning = null })
    return this.finishGroup(this.state.groups.find(item => item.requestId === request.requestId)!)
  }) }
  resumeGroup(requestId: string): Promise<Room> { return this.exclusive(async () => {
    const group = this.state.groups.find(item => item.requestId === requestId)
    if (!group) throw new Error('建群记录不存在')
    return this.finishGroup(group)
  }) }
  async close(): Promise<void> { this.closed = true; await this.tail }
}
