/** Official registration contract and text-only authenticated event transport. */
import { expect, it, vi } from 'vitest'
import { createGroup, GroupCreateError, decodeMessage, FeishuTransport, identity, register, type Sdk } from '../src/feishu/sdk.ts'
import type { Delivery } from '../src/infoflow/domain.ts'
const incoming = (kind = 'p2p', target = 'ou_robot') => ({ sender: { sender_type: 'user', sender_id: { open_id: 'ou_alice' } }, message: {
  message_id: 'om_one', chat_id: 'oc_chat', chat_type: kind, message_type: 'text', content: JSON.stringify({ text: '@_user_1 hello' }),
  mentions: [{ key: '@_user_1', id: { open_id: target } }],
} })
function bench(receive = vi.fn(async (_input: unknown) => {}), config: Partial<ConstructorParameters<typeof FeishuTransport>[1]> = {}) {
  const request = vi.fn(async (_options: Record<string, unknown>): Promise<unknown> => ({ code: 0, bot: { open_id: 'ou_robot', app_name: 'Alpha' } }))
  const begin = vi.fn(async (_options: unknown) => {}), close = vi.fn(), registration = vi.fn(async (_options: Record<string, unknown>) => ({ client_id: 'cli_app', client_secret: 'secret' }))
  let handlers: Record<string, (event: unknown) => Promise<void>> = {}
  const sdk: Sdk = { Client: class { request = request }, WSClient: class { start = begin; close = close },
    EventDispatcher: class { register(value: typeof handlers) { handlers = value; return this } }, registerApp: registration }
  const transport = new FeishuTransport(sdk, { appId: 'cli_app', appSecret: 'secret', brand: 'feishu', botOpenId: 'ou_robot', timeoutMs: 100, ...config }, receive, vi.fn(), vi.fn())
  return { sdk, request, registration, transport, begin, close, receive, emit: (event: unknown) => handlers['im.message.receive_v1']!(event),
    event: (kind: string, event: unknown) => handlers[kind]!(event) }
}
it('uses the official create-only flow with explicit messaging permissions and cancellation', async () => {
  const b = bench(), controller = new AbortController(), qr = vi.fn()
  await register(b.sdk, { signal: controller.signal, name: 'Alpha', qr })
  expect(b.registration).toHaveBeenCalledWith(expect.objectContaining({ createOnly: true, source: 'dsh-bot', signal: controller.signal, onQRCodeReady: qr,
    appPreset: expect.objectContaining({ name: 'Alpha' }), addons: { preset: false, scopes: { tenant: ['im:message.p2p_msg:readonly', 'im:message.group_at_msg:readonly', 'im:message:send_as_bot', 'im:chat:read', 'im:chat:create', 'im:resource', 'im:chat.members:bot_access'] }, events: { items: { tenant: ['im.message.receive_v1', 'im.chat.member.bot.added_v1', 'im.chat.updated_v1'] } } } }))
  expect(await identity(b.sdk, 'cli_app', 'secret', 'feishu', 100)).toEqual({ openId: 'ou_robot', name: 'Alpha' })
  await b.transport.close()
})
it('rejects robot senders, malformed content and mentions of a different robot', () => {
  expect(decodeMessage(incoming('group', 'ou_other'), 'cli_app', 'ou_robot')).toBeNull()
  expect(decodeMessage({ ...incoming(), sender: { sender_type: 'app' } }, 'cli_app', 'ou_robot')).toBeNull()
  expect(decodeMessage({ ...incoming(), message: { ...incoming().message, content: '{' } }, 'cli_app', 'ou_robot')).toBeNull()
  expect(decodeMessage(incoming('group'), 'cli_app', 'ou_robot')).toMatchObject({ conversation: { provider: 'feishu', accountId: 'cli_app', id: 'oc_chat', kind: 'group' }, text: 'hello' })
})
it.each([
  { response: { code: 99991672, msg: 'secret detail' }, expected: 'permission-required' },
  { error: { response: { status: 403, data: { code: 99991672, msg: 'secret detail' } } }, expected: 'permission-required' },
  { error: Object.assign(new Error('private SDK details'), { code: 'ERR_BAD_REQUEST', response: { status: 400, data: { code: 99991672 } } }), expected: 'permission-required' },
  { error: { response: { status: 403, data: { code: 230002 } } }, expected: 'unavailable' },
  { error: { response: { status: 503, data: { code: 99991672 } } }, expected: 'unavailable' },
  { error: { response: { status: 429, data: { code: 99991672 } } }, expected: 'unavailable' },
  { error: new Error('network secret'), expected: 'unavailable' },
  { response: { code: 0, data: { name: '' } }, expected: 'unavailable' },
  { response: { code: 0, data: { name: '产品讨论群' } }, expected: 'available' },
])('reports group lookup status without blocking messages or disclosing API details: $expected', async sample => {
  const status = vi.fn(), b = bench(undefined, { groupNameStatus: status })
  if ('error' in sample) b.request.mockRejectedValue(sample.error)
  else b.request.mockResolvedValue(sample.response)
  await b.emit(incoming('group'))
  expect(status).toHaveBeenCalledExactlyOnceWith(sample.expected)
  expect(b.receive).toHaveBeenCalledOnce()
  expect(JSON.stringify(status.mock.calls)).not.toContain('secret')
  await b.transport.close()
})
it('clears the permission warning after a successful later group lookup', async () => {
  const status = vi.fn(), b = bench(undefined, { groupNameStatus: status })
  const now = Date.now(), clock = vi.spyOn(Date, 'now').mockReturnValue(now)
  try {
    b.request.mockResolvedValueOnce({ code: 99991672 }).mockResolvedValueOnce({ code: 0, data: { name: '授权后的群名' } })
    await b.emit(incoming('group'))
    expect(status).toHaveBeenLastCalledWith('permission-required')
    clock.mockReturnValue(now + 60001)
    await b.emit(incoming('group'))
    expect(status).toHaveBeenLastCalledWith('available')
    expect(b.receive).toHaveBeenLastCalledWith(expect.objectContaining({ groupTitle: '授权后的群名' }))
  } finally { clock.mockRestore(); await b.transport.close() }
})
it('accepts DM and group events carrying the official dispatcher symbol metadata', async () => {
  const b = bench()
  // EventDispatcher.parse adds an enumerable Symbol('event-type') to every callback payload.
  for (const kind of ['p2p', 'group']) {
    await b.emit({ ...incoming(kind), [Symbol('event-type')]: 'im.message.receive_v1' })
  }
  expect(b.receive).toHaveBeenCalledTimes(2)
  expect(b.receive).toHaveBeenNthCalledWith(1, expect.objectContaining({ text: 'hello', conversation: expect.objectContaining({ kind: 'private' }) }))
  expect(b.receive).toHaveBeenNthCalledWith(2, expect.objectContaining({ text: 'hello', conversation: expect.objectContaining({ kind: 'group' }) }))
  await b.transport.close()
})
it('drains admitted handlers on close and makes persistence failures retryable to the dispatcher', async () => {
  let release!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  const b = bench(vi.fn(async () => { await waiting; throw new Error('secret payload') }))
  const emitted = expect(b.emit(incoming())).rejects.toThrow('DSH could not persist')
  let closed = false; const closing = b.transport.close().then(() => { closed = true })
  await Promise.resolve(); expect(closed).toBe(false)
  release(); await emitted; await closing
  await b.emit(incoming()); expect(b.receive).toHaveBeenCalledTimes(1)
})
it('uses chat IDs and stable delivery UUIDs, and rejects an unsuccessful API response', async () => {
  const b = bench()
  const delivery: Delivery = { id: 'delivery-one', conversation: { provider: 'feishu', accountId: 'cli_app', kind: 'private', id: 'oc_chat' }, user: 'ou_alice', text: 'hello', attempts: 0, nextAt: 0 }
  await b.transport.send(delivery); await b.transport.send(delivery)
  expect(b.request.mock.calls[0]).toEqual(b.request.mock.calls[1])
  expect(b.request.mock.calls[0]?.[0]).toMatchObject({ params: { receive_id_type: 'chat_id' }, data: { receive_id: 'oc_chat', msg_type: 'text', content: '{"text":"hello"}', uuid: expect.any(String) } })
  b.request.mockResolvedValueOnce({ code: 999, bot: { open_id: '', app_name: '' } })
  await expect(b.transport.send(delivery)).rejects.toThrow('飞书接口未成功')
  await b.transport.close(); await expect(b.transport.send(delivery)).rejects.toThrow('stopping')
})

it('sends committed group handoffs as native robot mentions, without adding mentions in private chat', async () => {
  const b = bench()
  const delivery: Delivery = { id: 'handoff', conversation: { provider: 'feishu', accountId: 'cli_app', kind: 'group', id: 'oc_chat' },
    user: 'ou_alice', text: '@engineer 任务', attempts: 0, nextAt: 0,
    mentions: [{ id: 'ou_engineer', name: '工程 <Bot>' }, { id: 'ou_robot', name: 'self' }, { id: 'all', name: 'everyone' }] }
  await b.transport.send(delivery)
  expect(b.request.mock.calls[0]?.[0]).toMatchObject({ data: { content: JSON.stringify({ text: '<at user_id="ou_engineer">工程 &lt;Bot&gt;</at>\n@engineer 任务' }) } })
  await b.transport.send({ ...delivery, conversation: { ...delivery.conversation, kind: 'private' } })
  expect(b.request.mock.calls[1]?.[0]).toMatchObject({ data: { content: JSON.stringify({ text: '@engineer 任务' }) } })
  await b.transport.close()
})

it('creates a private group with stable uuid, app-scoped owner and invited app IDs', async () => {
  const b = bench(); b.request.mockResolvedValue({ code: 0, data: { chat_id: 'oc_new' } })
  const options = { requestId: 'stable-request', title: 'Team', owner: 'ou_owner', botAppIds: ['cli_beta'] }
  expect(await createGroup(b.sdk, 'cli_alpha', 'secret', 'feishu', 100, options)).toBe('oc_new')
  expect(b.request).toHaveBeenCalledWith({ method: 'POST', url: '/open-apis/im/v1/chats', timeout: 100,
    params: { user_id_type: 'open_id', set_bot_manager: false, uuid: 'stable-request' },
    data: { name: 'Team', owner_id: 'ou_owner', user_id_list: ['ou_owner'], bot_id_list: ['cli_beta'], chat_mode: 'group', chat_type: 'private' } })
  b.request.mockRejectedValueOnce({ response: { status: 403, data: { code: 99991672, msg: 'private-secret' } }, config: { appSecret: 'private-secret' } })
  await expect(createGroup(b.sdk, 'cli_alpha', 'secret', 'feishu', 100, options)).rejects.toThrow('im:chat:create')
  b.request.mockResolvedValueOnce({ code: 232043 })
  await expect(createGroup(b.sdk, 'cli_alpha', 'secret', 'feishu', 100, options)).rejects.toBeInstanceOf(GroupCreateError)
  b.request.mockRejectedValueOnce(new Error('private-secret'))
  await expect(createGroup(b.sdk, 'cli_alpha', 'secret', 'feishu', 100, options)).rejects.toThrow('结果待确认')
  await b.transport.close()
})

it('escapes model-generated native mentions while allowing committed robot mentions', async () => {
  const b = bench()
  await b.transport.send({ id: 'unsafe', conversation: { provider: 'feishu', accountId: 'cli_app', kind: 'group', id: 'oc_chat' },
    user: 'ou_alice', text: '<at user_id="all">everyone</at>', attempts: 0, nextAt: 0,
    mentions: [{ id: 'ou_worker', name: 'Worker' }] })
  const content = JSON.parse(String((b.request.mock.calls[0]![0].data as { content: string }).content)).text
  expect(content).toContain('<at user_id="ou_worker">')
  expect(content).not.toContain('<at user_id="all">')
  await b.transport.close()
})

it('keeps HTTP 5xx and throttled group creation uncertain even with a business error code', async () => {
  const b = bench()
  for (const status of [500, 502, 503, 429]) {
    b.request.mockRejectedValueOnce({ response: { status, data: { code: 99991672 } } })
    const cause = await createGroup(b.sdk, 'cli_app', 'secret', 'feishu', 100,
      { requestId: 'same-request', title: 'Team', owner: 'ou_owner', botAppIds: [] }).catch(cause => cause)
    expect(cause).not.toBeInstanceOf(GroupCreateError)
    expect(cause.message).toContain('待确认')
  }
  await b.transport.close()
})


it('loads a group name through the authenticated chat API and still accepts messages when metadata is unavailable', async () => {
  const b = bench()
  b.request.mockResolvedValueOnce({ code: 0, data: { name: '产品讨论群' } })
  await b.emit(incoming('group'))
  expect(b.request).toHaveBeenCalledWith({ method: 'GET', url: '/open-apis/im/v1/chats/oc_chat', timeout: 100 })
  expect(b.receive).toHaveBeenLastCalledWith(expect.objectContaining({ groupTitle: '产品讨论群', text: 'hello' }))
  await b.emit(incoming('group'))
  expect(b.request).toHaveBeenCalledTimes(1)
  await b.transport.close()
  const denied = bench()
  denied.request.mockRejectedValue(new Error('private-secret permission denied'))
  await denied.emit(incoming('group'))
  expect(denied.receive).toHaveBeenCalledWith(expect.objectContaining({ text: 'hello' }))
  expect(denied.receive.mock.calls[0]?.[0]).not.toHaveProperty('groupTitle')
  await denied.transport.close()
})

it('uses join and rename events without chat-read access or model work, and carries the name into messages', async () => {
  const join = vi.fn(async () => {}), update = vi.fn(async () => {})
  const b = bench(undefined, { allowUsers: [], allowGroups: ['oc_chat'], groupTitles: { groups: () => [], join, update } })
  b.request.mockResolvedValue({ code: 99991672 })
  await b.event('im.chat.member.bot.added_v1', { app_id: 'cli_app', chat_id: 'oc_chat', name: ' 入群名称 ', create_time: '1608725989000' })
  expect(join).toHaveBeenCalledWith('oc_chat', '入群名称')
  await b.event('im.chat.updated_v1', { app_id: 'cli_app', chat_id: 'oc_chat', before_change: { name: '入群名称' }, after_change: { name: '新群名' }, create_time: '1608725990000' })
  expect(update).toHaveBeenCalledWith('oc_chat', '新群名')
  expect(b.receive).not.toHaveBeenCalled(); expect(b.request).not.toHaveBeenCalled()
  await b.emit(incoming('group'))
  expect(b.receive).toHaveBeenCalledWith(expect.objectContaining({ groupTitle: '新群名' }))
  expect(b.request).not.toHaveBeenCalled()
  await b.transport.close()
})

it('ignores other apps, disallowed groups, missing/invalid names and callbacks after shutdown', async () => {
  const join = vi.fn(async () => {}), update = vi.fn(async () => {})
  const b = bench(undefined, { allowGroups: ['oc_chat'], groupTitles: { groups: () => [], join, update } })
  for (const event of [
    { chat_id: 'oc_unlisted', name: '未允许' }, { chat_id: 'oc_chat', app_id: 'cli_other', name: '其他应用' },
    { chat_id: 'bad-id', name: '错误群号' }, ...['', ' ', 123, 'x'.repeat(1001)].map(name => ({ chat_id: 'oc_chat', name })),
  ]) await b.event('im.chat.member.bot.added_v1', event)
  await b.event('im.chat.updated_v1', { chat_id: 'oc_chat', before_change: { name: '旧群名' }, after_change: { avatar: 'new' } })
  await b.transport.close()
  await b.event('im.chat.member.bot.added_v1', { chat_id: 'oc_chat', name: '关闭后' })
  expect(join).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled()
  expect(b.receive).not.toHaveBeenCalled(); expect(b.request).not.toHaveBeenCalled()
})

it('lets an allowed new group join with all-groups enabled and retries a sanitized persistence failure', async () => {
  const join = vi.fn(async () => {})
  join.mockRejectedValueOnce(new Error('private-secret'))
  const b = bench(undefined, { allowGroups: [], allowAllGroups: true, groupTitles: { groups: () => [], join, update: vi.fn() } })
  const event = { chat_id: 'oc_new', name: '新群', create_time: '1608725989000' }
  await expect(b.event('im.chat.member.bot.added_v1', event)).rejects.toThrow('DSH could not persist the group name')
  await b.event('im.chat.member.bot.added_v1', event)
  expect(join).toHaveBeenCalledTimes(2)
  expect(b.receive).not.toHaveBeenCalled(); expect(b.request).not.toHaveBeenCalled()
  await b.transport.close()
})

it.each(['feishu', 'lark'] as const)('requests both group permissions for an existing %s app without creation or event changes', async brand => {
  const b = bench(), controller = new AbortController(), qr = vi.fn()
  await register(b.sdk, { signal: controller.signal, name: 'Alpha', appId: 'cli_existing', brand, qr })
  const options = b.registration.mock.calls[0]![0]
  expect(options).toEqual({ signal: controller.signal, source: 'dsh-bot', appId: 'cli_existing', onQRCodeReady: qr,
    ...(brand === 'lark' ? { domain: 'accounts.larksuite.com' } : {}),
    addons: { preset: false, scopes: { tenant: ['im:chat:read', 'im:chat:create'] } } })
  await b.transport.close()
})
