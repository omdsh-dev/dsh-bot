/** User-confirmed provisioning, durable credentials and per-Bot ownership. */
import { expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { FeishuManager, type ManagerRuntime } from '../src/feishu/manager.ts'
import type { Settings } from '../src/feishu/settings.ts'
import { GroupCreateError, type RegistrationOptions, type RegistrationResult } from '../src/feishu/sdk.ts'
import type { Bot, BotId, RoomId } from '../src/types.ts'
const alpha = brandString<BotId>('alpha'), beta = brandString<BotId>('beta')
function bench(initial: Settings = { bindings: [], registrations: [], groups: [] }) {
  let state = structuredClone(initial)
  const secrets = new Map<string, string>()
  let finish!: (value: RegistrationResult) => void
  let reject!: (cause: Error) => void
  const register = vi.fn(async (options: RegistrationOptions) => new Promise<RegistrationResult>((resolve, fail) => {
    finish = resolve; reject = fail
    options.qr({ url: 'https://accounts.feishu.cn/fixture', expireIn: 600 })
    options.signal.addEventListener('abort', () => fail(new Error('aborted')), { once: true })
  }))
  const runtime: ManagerRuntime = {
    createGroup: vi.fn(async () => 'oc_created'),
    linkGroup: vi.fn(async group => ({ id: brandString<RoomId>('room_created'), title: group.title, kind: 'group', members: [], messages: [], defaultBot: group.creatorBot })),
    bots: () => [alpha, beta].map(id => ({ id, name: id, instructions: 'test', preset: 'standard' } satisfies Bot)),
    identity: vi.fn(async (appId, secret) => { if (secret === 'invalid') throw new Error('upstream secret invalid'); return { openId: `ou_${appId}`, name: appId } }),
    register, qrImage: async () => 'data:image/png;base64,fixture', resolve: async ref => secrets.get(ref),
    set: vi.fn(async (ref, value) => { secrets.set(ref, value) }), start: vi.fn(async () => {}), stop: vi.fn(async () => {}),
  }
  const store = { get: () => structuredClone(state), set: vi.fn(async (value: Settings) => { state = structuredClone(value) }) }
  return { manager: new FeishuManager(store, runtime), runtime, register, secrets, store, state: () => state,
    finish: (id = 'cli_alpha') => finish({ client_id: id, client_secret: 'private-returned-secret', user_info: { open_id: `ou_${id}_owner`, tenant_brand: 'feishu' } }),
    reject: () => reject(new Error('error with secret payload')) }
}
const manual = (botId: BotId, appId = `cli_${botId}`) => ({ botId, appId, appSecret: 'private-manual-secret', brand: 'feishu' as const, allowUsers: ['ou_owner'], allowGroups: [], admins: ['ou_owner'] })
it('registers once per selected Bot, writes credentials privately and leaves a new binding disabled', async () => {
  const f = bench(); await f.manager.init()
  const [first, again] = await Promise.all([f.manager.register(alpha), f.manager.register(alpha)])
  expect(again.attemptId).toBe(first.attemptId); expect(f.register).toHaveBeenCalledTimes(1)
  await vi.waitFor(() => expect(f.manager.snapshot().registrations[0]?.qrDataUrl).toContain('data:image/png'))
  expect(JSON.stringify(f.state())).not.toContain('https:')
  f.finish(); await vi.waitFor(() => expect(f.manager.snapshot().registrations[0]?.status).toBe('complete'))
  const binding = f.manager.snapshot().bindings[0]!
  expect(binding).toMatchObject({ botId: alpha, enabled: false, appId: 'cli_alpha', allowUsers: ['ou_cli_alpha_owner'] })
  expect(f.runtime.start).not.toHaveBeenCalled()
  expect([...f.secrets.values()]).toEqual(['private-returned-secret'])
  expect(JSON.stringify(f.state()) + JSON.stringify(f.manager.snapshot())).not.toContain('private-returned-secret')
  expect(f.manager.snapshot().registrations[0]?.url).toBeNull()
  await expect(f.manager.register(alpha)).rejects.toThrow('已绑定')
  await f.manager.close()
})
it('retains a created app when its bot is not yet published, and never creates again to retry verification', async () => {
  const f = bench(); vi.mocked(f.runtime.identity).mockRejectedValue(new Error('not published'))
  await f.manager.register(alpha); f.finish()
  await vi.waitFor(() => expect(f.manager.snapshot().registrations[0]?.status).toBe('complete'))
  expect(f.manager.snapshot().registrations[0]?.message).toContain('无需再次创建')
  expect(f.state().bindings).toHaveLength(1); expect(f.secrets.size).toBe(1)
  await expect(f.manager.toggle({ botId: alpha, enabled: true })).rejects.toThrow('验证失败')
  expect(f.state().bindings[0]?.enabled).toBe(false)
  await f.manager.close()
})
it('cancels without auto-retry and marks pending registration interrupted after restart', async () => {
  const f = bench(); const first = await f.manager.register(alpha)
  const before = structuredClone(f.state())
  await f.manager.cancel(first.attemptId); await f.manager.close()
  expect(f.manager.snapshot().registrations[0]?.status).toBe('canceled')
  expect(f.register).toHaveBeenCalledTimes(1); expect(f.secrets.size).toBe(0)
  const resumed = bench(before); await resumed.manager.init()
  expect(resumed.manager.snapshot().registrations[0]?.status).toBe('interrupted')
  expect(resumed.register).not.toHaveBeenCalled(); await resumed.manager.close()
})
it('does not bind or start a connection when credential persistence fails', async () => {
  const f = bench(); vi.mocked(f.runtime.set).mockRejectedValue(new Error('disk full'))
  await f.manager.register(alpha); f.finish()
  await vi.waitFor(() => expect(f.manager.snapshot().registrations[0]?.status).toBe('error'))
  expect(f.state().bindings).toHaveLength(0); expect(f.runtime.start).not.toHaveBeenCalled()
  expect(f.register).toHaveBeenCalledTimes(1); await f.manager.close()
})
it('keeps per-app users separate, rejects duplicate app bindings and validates before overwriting', async () => {
  const f = bench(); await f.manager.save(manual(alpha))
  await expect(f.manager.save(manual(beta, 'cli_alpha'))).rejects.toThrow('其他 Bot')
  const saved = f.state(); await expect(f.manager.save({ ...manual(alpha), appSecret: 'invalid' })).rejects.toThrow('验证失败')
  expect(f.state()).toEqual(saved)
  await f.manager.register(beta); f.finish('cli_beta')
  await vi.waitFor(() => expect(f.manager.snapshot().bindings).toHaveLength(2))
  expect(f.state().bindings.find(item => item.botId === beta)?.allowUsers).toEqual(['ou_cli_beta_owner'])
  await vi.waitFor(() => expect(f.manager.snapshot().registrations[0]?.status).toBe('complete'))
  await f.manager.toggle({ botId: alpha, enabled: true })
  expect(f.state().bindings.map(item => item.enabled)).toEqual([true, false])
  await f.manager.close()
})
it('does not call registration when recording the attempt fails', async () => {
  const f = bench(); f.store.set.mockRejectedValueOnce(new Error('disk full'))
  await expect(f.manager.register(alpha)).rejects.toThrow('disk full')
  expect(f.register).not.toHaveBeenCalled(); await f.manager.close()
})

const groupRequest = { requestId: 'group-attempt-1', title: 'Review group', botIds: [beta, alpha], creatorBot: alpha }
async function groupBench() {
  const f = bench()
  for (const botId of [alpha, beta]) { await f.manager.save(manual(botId)); await f.manager.toggle({ botId, enabled: true }) }
  return f
}
it('creates one remote group, invites the other app and enables both allowlists before linking', async () => {
  const f = await groupBench()
  vi.mocked(f.runtime.linkGroup).mockImplementationOnce(async group => {
    expect(f.state().bindings.every(binding => binding.allowGroups.includes('oc_created'))).toBe(true)
    expect(f.state().groups[0]?.chatId).toBe('oc_created')
    return { id: brandString<RoomId>('room_created'), title: group.title, kind: 'group', members: [], messages: [], defaultBot: alpha }
  })
  const [first, again] = await Promise.all([f.manager.createGroup(groupRequest), f.manager.createGroup(groupRequest)])
  expect(first.id).toBe(again.id); expect(f.runtime.createGroup).toHaveBeenCalledTimes(1)
  expect(f.runtime.stop).toHaveBeenCalledTimes(6) // Four save/enable calls, then one replacement per bot; duplicate create does not interrupt live work.
  expect(f.runtime.createGroup).toHaveBeenCalledWith(expect.objectContaining({ botId: alpha }), 'private-manual-secret', { requestId: groupRequest.requestId, title: groupRequest.title, owner: 'ou_owner', botAppIds: ['cli_beta'] })
  expect(f.manager.snapshot().groups[0]).toMatchObject({ status: 'ready', chatId: 'oc_created', roomId: 'room_created' })
  await expect(f.manager.createGroup({ ...groupRequest, title: 'Changed' })).rejects.toThrow('不能修改')
  expect(f.state().bindings.every(binding => binding.allowUsers.length === 1 && binding.allowGroups.length === 1)).toBe(true)
  await f.manager.close()
})
it('resumes local failure after restart without creating another remote group', async () => {
  const f = await groupBench(); vi.mocked(f.runtime.linkGroup).mockRejectedValueOnce(new Error('disk failed'))
  await expect(f.manager.createGroup(groupRequest)).rejects.toThrow('群已创建')
  expect(f.state().groups[0]).toMatchObject({ status: 'linking', chatId: 'oc_created' })
  await f.manager.close()
  const resumed = bench(f.state()); await resumed.manager.init()
  await resumed.manager.resumeGroup(groupRequest.requestId)
  expect(resumed.runtime.createGroup).not.toHaveBeenCalled()
  expect(resumed.manager.snapshot().groups[0]?.status).toBe('ready')
  await resumed.manager.close()
})
it('reuses uuid and owner after a lost response and blocks retries outside the deduplication window', async () => {
  const f = await groupBench(); vi.mocked(f.runtime.createGroup).mockRejectedValueOnce(new Error('timeout with secret payload'))
  await expect(f.manager.createGroup(groupRequest)).rejects.toThrow('待确认')
  expect(JSON.stringify(f.manager.snapshot())).not.toContain('secret payload')
  await f.manager.resumeGroup(groupRequest.requestId)
  expect(vi.mocked(f.runtime.createGroup).mock.calls[0]?.[2]).toEqual(vi.mocked(f.runtime.createGroup).mock.calls[1]?.[2])
  const expired = f.state(); expired.groups[0]!.chatId = null; expired.groups[0]!.status = 'creating'; expired.groups[0]!.createdAt = Date.now() - 10 * 60 * 60 * 1000
  const resumed = bench(expired); await resumed.manager.init()
  expect(resumed.manager.snapshot().groups[0]?.status).toBe('uncertain')
  await expect(resumed.manager.resumeGroup(groupRequest.requestId)).rejects.toThrow('时限已过')
  expect(resumed.runtime.createGroup).not.toHaveBeenCalled()
  await resumed.manager.close(); await f.manager.close()
})
it('retains permission failures for retry and does not call the API if intent cannot be saved', async () => {
  const f = await groupBench()
  f.store.set.mockRejectedValueOnce(new Error('disk full'))
  await expect(f.manager.createGroup(groupRequest)).rejects.toThrow('disk full'); expect(f.runtime.createGroup).not.toHaveBeenCalled()
  vi.mocked(f.runtime.createGroup).mockRejectedValueOnce(new GroupCreateError('缺少 im:chat:create'))
  await expect(f.manager.createGroup(groupRequest)).rejects.toThrow('im:chat:create')
  expect(f.state().groups[0]?.status).toBe('failed'); expect(f.runtime.linkGroup).not.toHaveBeenCalled()
  await f.manager.resumeGroup(groupRequest.requestId); expect(f.state().groups[0]?.status).toBe('ready')
  await f.manager.close()
})
it('keeps an earlier unknown creation outcome uncertain when a retry is rejected', async () => {
  const f = await groupBench()
  vi.mocked(f.runtime.createGroup).mockRejectedValueOnce(new Error('lost response')).mockRejectedValueOnce(new GroupCreateError('缺少 im:chat:create'))
  await expect(f.manager.createGroup(groupRequest)).rejects.toThrow('待确认')
  await expect(f.manager.resumeGroup(groupRequest.requestId)).rejects.toThrow('im:chat:create')
  expect(f.state().groups[0]).toMatchObject({ status: 'uncertain', chatId: null })
  await f.manager.close()
})
it('validates enabled membership and app-scoped ownership before creating a remote group', async () => {
  const f = bench(); await f.manager.save(manual(alpha)); await f.manager.save(manual(beta))
  await expect(f.manager.createGroup(groupRequest)).rejects.toThrow('启用')
  await f.manager.toggle({ botId: alpha, enabled: true }); await f.manager.toggle({ botId: beta, enabled: true })
  await expect(f.manager.createGroup({ ...groupRequest, owner: 'not_an_open_id' })).rejects.toThrow('Open ID')
  await expect(f.manager.createGroup({ ...groupRequest, botIds: [beta] })).rejects.toThrow('指定其中一个')
  expect(f.runtime.createGroup).not.toHaveBeenCalled(); expect(f.state().groups).toHaveLength(0)
  await f.manager.close()
})
