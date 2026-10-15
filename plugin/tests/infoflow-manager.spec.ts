/** Public manager operations: isolated bindings, secret handling and durable group creation. */
import { expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { InfoFlowManager, type ManagerRuntime } from '../src/infoflow/manager.ts'
import type { Settings } from '../src/infoflow/settings.ts'
import type { RobotApi } from '../src/infoflow/sdk.ts'
import type { BotId, Room, RoomId, SaveInfoFlowBindingRequest } from '../src/types.ts'
const a = brandString<BotId>('alpha'), b = brandString<BotId>('beta')
function bench(initial: Settings = { bindings: [], groups: [] }) {
  let state = structuredClone(initial)
  const secrets = new Map<string, string>()
  const create = vi.fn<RobotApi['createGroup']>(async (_options) => ({ groupId: '123456', failList: [], failRobotIds: [] }))
  const testMessage = vi.fn(async (_user: string) => {})
  const link = vi.fn(async group => ({ id: brandString<RoomId>(`room-${group.groupId}`), title: group.title, kind: 'group', defaultBot: group.defaultBot,
    members: [], messages: [], external: { provider: 'infoflow', accountId: `group:${group.groupId}`, kind: 'group', id: group.groupId } } satisfies Room))
  const runtime: ManagerRuntime = {
    bots: () => [a, b], resolve: async ref => secrets.get(ref), set: async (ref, value) => { secrets.set(ref, value) },
    start: vi.fn(async () => {}), stop: vi.fn(async () => {}), link,
    api: (_binding, values) => ({ identity: async () => {
      if (values.appSecret === 'invalid') throw new Error('upstream secret: invalid')
      return { agentId: values.appKey === 'key-a' ? 11 : 22, imId: values.appKey === 'key-a' ? 111 : 222, name: values.appKey === 'key-a' ? 'Robot A' : 'Robot B' }
    }, createGroup: create, testMessage }),
  }
  const store = { get: () => structuredClone(state), set: vi.fn(async value => { state = structuredClone(value) }) }
  return { manager: new InfoFlowManager(store, runtime), runtime, secrets, create, testMessage, link, store, state: () => state }
}
function binding(botId: BotId): SaveInfoFlowBindingRequest { return { botId, appKey: botId === a ? 'key-a' : 'key-b', appSecret: 'private-secret', allowUsers: ['alice@baidu.com'], allowGroups: [], admins: ['alice'] } }
const group = { requestId: 'request-12345', title: 'Project', botIds: [a, b], defaultBot: a, owner: 'alice', members: ['bob'] }
async function configured() {
  const fixture = bench(); await fixture.manager.init()
  await fixture.manager.save(binding(a)); await fixture.manager.save(binding(b))
  await fixture.manager.toggle({ botId: a, enabled: true }); await fixture.manager.toggle({ botId: b, enabled: true })
  return fixture
}
it('stores two robot bindings independently without returning or persisting credential values', async () => {
  const f = await configured()
  expect(f.manager.snapshot().bindings.map(item => [item.botId, item.agentId, item.allowUsers])).toEqual([[a, '11', ['alice']], [b, '22', ['alice']]])
  expect(JSON.stringify(f.state())).not.toContain('private-secret')
  expect(JSON.stringify(f.manager.snapshot())).not.toContain('key-a')
  expect(f.secrets.size).toBe(4)
  await f.manager.toggle({ botId: a, enabled: false })
  expect(f.manager.snapshot().bindings.map(item => item.enabled)).toEqual([false, true])
  expect(f.runtime.stop).toHaveBeenLastCalledWith(a)
})
it('rejects robot reuse and failed verification without overwriting a saved binding', async () => {
  const f = bench(); await f.manager.save(binding(a))
  await expect(f.manager.save({ ...binding(b), appKey: 'key-a' })).rejects.toThrow('另一个 Bot')
  const saved = f.state()
  await expect(f.manager.save({ ...binding(a), appSecret: 'invalid' })).rejects.toThrow('机器人验证失败')
  expect(f.state()).toEqual(saved)
  const kept = await f.manager.save({ ...binding(a), appKey: '', appSecret: '' })
  expect(kept.agentId).toBe('11')
})
it('creates one group with every selected robot and reuses its saved outcome on retry', async () => {
  const f = await configured()
  const room = await f.manager.createGroup(group)
  expect(f.create).toHaveBeenCalledWith({ groupName: 'Project', groupOwner: 'alice', memberList: ['bob'], robotList: [11, 22] })
  expect((await f.manager.createGroup(group)).id).toBe(room.id)
  expect(f.create).toHaveBeenCalledTimes(1)
  expect(f.manager.snapshot().groups[0]?.status).toBe('ready')
  await expect(f.manager.createGroup({ ...group, defaultBot: b })).rejects.toThrow('不能更改')
  await expect(f.manager.createGroup({ ...group, members: ['charlie'] })).rejects.toThrow('不能更改')
  expect(f.create).toHaveBeenCalledTimes(1)
})
it('requires enabled robot bindings before creating a platform group', async () => {
  const f = await configured(); await f.manager.toggle({ botId: b, enabled: false })
  await expect(f.manager.createGroup(group)).rejects.toThrow('先绑定并启用')
  expect(f.create).not.toHaveBeenCalled()
})
it('does not repeat a remote creation after a timeout or a process restart', async () => {
  const f = await configured(); f.create.mockRejectedValueOnce(new Error('unknown timeout'))
  await expect(f.manager.createGroup(group)).rejects.toThrow('结果未确认')
  await expect(f.manager.createGroup(group)).rejects.toThrow('不能重复创建')
  const restarted = new InfoFlowManager(f.store, f.runtime); await restarted.init()
  await expect(restarted.createGroup(group)).rejects.toThrow('不能重复创建')
  expect(f.create).toHaveBeenCalledTimes(1)
  expect(restarted.snapshot().groups[0]?.status).toBe('uncertain')
})
it('recovers local linking failures without creating another group and surfaces partial invitations', async () => {
  const f = await configured(); f.link.mockRejectedValueOnce(new Error('disk full'))
  f.create.mockResolvedValueOnce({ groupId: '123456', failList: ['bob'], failRobotIds: [22] })
  await expect(f.manager.createGroup(group)).rejects.toThrow('disk full')
  expect(f.manager.snapshot().groups[0]?.groupId).toBe('123456')
  expect(f.manager.snapshot().groups[0]?.warning).toContain('bob')
  await f.manager.resumeGroup(group.requestId)
  expect(f.create).toHaveBeenCalledTimes(1)
})
it('imports the existing configuration disabled and treats unfinished creation as uncertain', async () => {
  const f = await configured(); const initial = structuredClone(f.state())
  initial.bindings = []; initial.groups = [{ ...group, groupId: '', roomId: null, status: 'creating', warning: null }]
  const fresh = bench(initial)
  await fresh.manager.init({ ...f.state().bindings[0]!, enabled: true })
  expect(fresh.manager.snapshot().bindings[0]?.enabled).toBe(false)
  expect(fresh.runtime.start).not.toHaveBeenCalled()
  expect(fresh.manager.snapshot().groups[0]?.status).toBe('uncertain')
})

it('checks the pasted app ID before saving and connects only when requested', async () => {
  const f = bench()
  await expect(f.manager.save({ ...binding(a), agentId: '22', connect: true, allowAllGroups: true })).rejects.toThrow('应用 ID')
  expect(f.secrets.size).toBe(0); expect(f.state().bindings).toHaveLength(0)
  expect(f.runtime.start).not.toHaveBeenCalled()
  const saved = await f.manager.save({ ...binding(a), agentId: '11', connect: true, allowAllGroups: true })
  expect(saved).toMatchObject({ enabled: true, status: 'connecting', allowAllGroups: true })
  expect(f.runtime.start).toHaveBeenCalledWith(expect.objectContaining({ botId: a, allowAllGroups: true }))
  const disabled = await f.manager.save(binding(b))
  expect(disabled).toMatchObject({ enabled: false, allowAllGroups: false })
  await f.manager.save({ ...binding(a), allowAllGroups: false })
  expect(f.manager.snapshot().bindings.find(item => item.botId === a)?.allowAllGroups).toBe(false)
})
it('reports connection failure separately from a successfully saved configuration', async () => {
  const f = bench(); vi.mocked(f.runtime.start).mockRejectedValueOnce(new Error('socket error with secret'))
  const saved = await f.manager.save({ ...binding(a), connect: true })
  expect(saved.status).toBe('error'); expect(saved.error).not.toContain('secret')
  expect(f.state().bindings[0]?.enabled).toBe(true)
})
it('tests only a saved allowed account without starting a connection or changing chat state', async () => {
  const f = bench(); await f.manager.save(binding(a)); const saved = f.state()
  await expect(f.manager.testMessage({ botId: a, user: 'outsider' })).rejects.toThrow('已保存的允许私聊账号')
  await expect(f.manager.testMessage({ botId: a, user: 'alice|outsider' })).rejects.toThrow('账号前缀')
  expect(f.testMessage).not.toHaveBeenCalled()
  await f.manager.testMessage({ botId: a, user: 'alice@baidu.com' })
  expect(f.testMessage).toHaveBeenCalledExactlyOnceWith('alice')
  expect(f.runtime.start).not.toHaveBeenCalled(); expect(f.state()).toEqual(saved)
})
