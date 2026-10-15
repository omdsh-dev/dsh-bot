/** Fault injection at the bridge's durable admission and delivery interfaces. */
import { expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { InfoFlowBridge, type BridgeConfig } from '../src/infoflow/bridge.ts'
import { decodeMessage, conversationKey, splitMessage, type Incoming } from '../src/infoflow/messages.ts'
import type { BridgeState, Delivery } from '../src/infoflow/domain.ts'
import type { BotMode } from '../src/index.ts'
import type { BotId, Room, RoomId, ChatMessageId, ExternalSendRequest, BotState, AttemptRequest } from '../src/types.ts'
import { SessionId } from '@deepseek-ai/dsh-session'
import { botDomain } from '../src/domain.ts'

const bot = brandString<BotId>('sage')
const config: BridgeConfig = { accountId: 'app', botIds: [bot], defaultBot: bot, allowUsers: ['alice', 'bob'], allowGroups: ['group'], admins: ['admin'],
  maxPending: 20, maxQueuePerRoom: 10, maxConcurrentRooms: 2, maxReceipts: 100, maxOutbox: 100, chunkSize: 3000, retryMs: 1, maxRetryMs: 1 }
function input(id: string, text = 'hello', user = 'alice', group = false): Incoming {
  return { conversation: { provider: 'infoflow', accountId: 'app', kind: group ? 'group' : 'private', id: group ? 'group' : user },
    message: { id, sender: { id: user, name: user } }, text }
}
function bench(initial?: BridgeState) {
  let state: BridgeState = structuredClone(initial ?? { receipts: [], pending: [], outbox: [], notices: [] })
  const durable: BotState = { bots: [{ id: bot, name: 'Sage', instructions: '', preset: 'standard' }], rooms: [] }
  const submitted: ExternalSendRequest[] = []
  const sent: Delivery[] = []
  const save = vi.fn(async (next: BridgeState) => { state = structuredClone(next) })
  const send = vi.fn(async (delivery: Delivery) => { sent.push(delivery) })
  const stop = vi.fn(async ({ roomId, messageId }: AttemptRequest) => {
    const message = durable.rooms.find(room => room.id === roomId)!.messages.find(message => message.id === messageId)!
    message.status = 'canceled'; return true
  })
  const bots: Pick<BotMode, 'snapshot' | 'ensureExternalRoom' | 'submitExternalMessage' | 'stop'> = {
    snapshot: () => structuredClone(durable), stop,
    ensureExternalRoom: async (request) => {
      let room = durable.rooms.find(room => room.external && conversationKey(room.external) === conversationKey(request.conversation))
      if (!room) {
        room = { id: brandString<RoomId>(`room-${durable.rooms.length}`), kind: request.conversation.kind === 'private' ? 'dm' : 'group',
          title: request.title, external: request.conversation, members: [{ botId: bot, sessionId: SessionId(`session-${durable.rooms.length}`), cursor: 0 }], defaultBot: bot, messages: [] }
        durable.rooms.push(room)
      }
      return structuredClone(room)
    },
    submitExternalMessage: async (request) => {
      const room = durable.rooms.find(room => room.id === request.roomId)!
      const existing = room.messages.find(message => message.external?.id === request.external.id)
      if (existing) return { status: 'accepted', messageId: existing.id, attemptIds: room.messages.filter(message => message.replyTo === existing.id).map(message => message.id) }
      if (room.messages.some(message => message.status === 'running')) return { status: 'busy' }
      submitted.push(request)
      const id = brandString<ChatMessageId>(`input-${submitted.length}`)
      const response = brandString<ChatMessageId>(`response-${submitted.length}`)
      room.messages.push({ id, botId: null, text: request.text, external: request.external, replyTo: null, status: 'complete', error: null, time: 0 },
        { id: response, botId: bot, text: '', replyTo: id, status: 'running', error: null, time: 0 })
      return { status: 'accepted', messageId: id, attemptIds: [response] }
    },
  }
  const report = vi.fn()
  const create = (overrides: Partial<BridgeConfig> = {}) => new InfoFlowBridge(bots, { get: () => state, set: save }, { send }, { ...config, ...overrides }, report)
  const bridge = create()
  function complete(room: Room = durable.rooms[0]!) {
    for (const message of room.messages.filter(message => message.status === 'running')) { message.status = 'complete'; message.text = 'answer' }
  }
  return { bridge, create, bots, state: () => state, durable, submitted, sent, save, send, stop, complete }
}

it('requires the exact robot AT and lossless IDs, and ignores forwarded group traffic', () => {
  const envelope = (robotid: unknown, eventtype = 'MESSAGE_RECEIVE', receipt: unknown = '9223372036854775807') => ({ data: { raw: {
    groupid: 'group', eventtype, message: { header: { fromuserid: 'alice', messageid: receipt }, body: [{ type: 'AT', robotid }, { type: 'TEXT', content: '@all question' }, { type: 'QUOTE', content: '@other hidden' }] },
  } } })
  expect(decodeMessage('group.text', envelope('robot'), 'app', 'robot')).toMatchObject({ message: { id: '9223372036854775807' }, text: '@all question' })
  expect(decodeMessage('group.text', envelope('other'), 'app', 'robot')).toBeNull()
  expect(decodeMessage('group.text', envelope('robot', 'ALL_MESSAGE_FORWARD'), 'app', 'robot')).toBeNull()
  expect(decodeMessage('group.text', envelope('robot', 'MESSAGE_RECEIVE', 9223372036854775807), 'app', 'robot')).toBeNull()
  expect(splitMessage('你好😀世界', 3)).toEqual(['你好😀', '世界'])
})

it('admits duplicate delivery once, serializes one room, and runs other rooms independently', async () => {
  const b = bench()
  await Promise.all([b.bridge.receive(input('1')), b.bridge.receive(input('1')), b.bridge.receive(input('2')), b.bridge.receive(input('3', 'other', 'bob'))])
  await b.bridge.wake()
  expect(b.submitted.map(item => item.text)).toEqual(['hello', 'other'])
  expect(b.state().receipts).toHaveLength(3)
  b.complete(); await b.bridge.wake(); await b.bridge.wake()
  expect(b.submitted).toHaveLength(3)
  await b.bridge.close()
})

it.each([
  ['infoflow', false], ['infoflow', true], ['feishu', false], ['feishu', true],
] as const)('sends the original reply through its own %s robot without a synthetic Bot mention (group: %s)', async (provider, group) => {
  const b = bench(), bridge = b.create({ provider })
  const incoming = input('reply-format', 'hello', 'alice', group)
  incoming.conversation.provider = provider
  await bridge.receive(incoming); await bridge.wake()
  b.complete()
  const reply = b.durable.rooms[0]!.messages.at(-1)!
  reply.text = '@sage 是你在问题中引用的文本。\n\n你好！'
  await bridge.wake()
  expect(b.sent.at(-1)?.text).toBe(reply.text)
  expect(b.sent.at(-1)).toMatchObject({ botId: bot, conversation: incoming.conversation })
  await bridge.close()
})

it('retains attribution when a legacy connector shares one platform robot across Bots', async () => {
  const b = bench(), bridge = b.create({ labelReplies: true, botIds: [bot, brandString<BotId>('other')] })
  await bridge.receive(input('legacy')); await bridge.wake()
  b.complete(); await bridge.wake()
  expect(b.sent.at(-1)?.text).toBe('@sage\nanswer')
  await bridge.close()
})

it('does not claim a receipt when the atomic inbox write fails', async () => {
  const b = bench()
  b.save.mockRejectedValueOnce(new Error('disk unavailable'))
  await expect(b.bridge.receive(input('1'))).rejects.toThrow('disk unavailable')
  expect(b.state().receipts).toEqual([])
  await b.bridge.receive(input('1')); await b.bridge.wake()
  expect(b.submitted).toHaveLength(1)
  await b.bridge.close()
})

it('recovers a committed Bot receipt after the connector loses its submitted-state write', async () => {
  const b = bench()
  const real = b.save.getMockImplementation()!
  let failed = false
  b.save.mockImplementation(async state => {
    if (!failed && state.pending.some(item => item.submitted)) { failed = true; throw new Error('crash after Bot commit') }
    await real(state)
  })
  await b.bridge.receive(input('1')); await b.bridge.wake(); await b.bridge.close()
  const next = b.create(); await next.wake()
  expect(b.submitted).toHaveLength(1)
  expect(b.state().pending[0]?.submitted).toBeDefined()
  await next.close()
})

it('recovers failed reply delivery after restart without resubmitting to the model', async () => {
  const b = bench()
  await b.bridge.receive(input('1')); await b.bridge.wake(); b.complete()
  b.send.mockRejectedValue(new Error('platform offline'))
  await b.bridge.wake(); await b.bridge.close()
  expect(b.state().pending).toEqual([])
  expect(b.state().outbox).toHaveLength(1)
  b.send.mockImplementation(async delivery => { b.sent.push(delivery) })
  await new Promise(resolve => setTimeout(resolve, 5))
  const next = b.create(); await next.wake()
  expect(b.state().outbox).toEqual([])
  expect(b.submitted).toHaveLength(1)
  expect(b.sent.at(-1)?.text).toContain('answer')
  await next.close()
})

it('restricts stop to the sender or configured administrator in the current group', async () => {
  const b = bench()
  await b.bridge.receive(input('1', 'work', 'alice', true)); await b.bridge.wake()
  await b.bridge.receive(input('2', '/stop', 'bob', true)); await b.bridge.wake()
  expect(b.stop).not.toHaveBeenCalled()
  await b.bridge.receive(input('3', '/stop', 'alice', true)); await b.bridge.wake()
  expect(b.stop).toHaveBeenCalledTimes(1)
  await b.bridge.receive(input('4', 'new', 'alice', true)); await b.bridge.wake()
  await b.bridge.receive(input('5', '/stop', 'admin', true)); await b.bridge.wake()
  expect(b.stop).toHaveBeenCalledTimes(2)
  await b.bridge.close()
})

it('uses app-scoped senders for shared Feishu group stop and only notifies the owning robot', async () => {
  const b = bench(), other = brandString<BotId>('other')
  const parent = brandString<ChatMessageId>('shared-input')
  const ownAttempt = brandString<ChatMessageId>('own-attempt'), otherAttempt = brandString<ChatMessageId>('other-attempt')
  const ownSession = SessionId('own-session'), otherSession = SessionId('other-session')
  const room: Room = { id: brandString<RoomId>('shared-room'), kind: 'group', title: 'Shared', defaultBot: bot,
    external: { provider: 'feishu', accountId: 'group:group', kind: 'group', id: 'group' },
    members: [{ botId: bot, sessionId: ownSession, cursor: 0 }, { botId: other, sessionId: otherSession, cursor: 0 }],
    messages: [
      { id: parent, botId: null, text: 'work', replyTo: null, status: 'complete', error: null, time: 0,
        external: { id: 'om_shared', sender: { id: 'foreign-alice', name: 'Alice' }, sources: [{ accountId: 'other-app', senderId: 'foreign-alice' }, { accountId: 'app', senderId: 'alice' }] } },
      { id: ownAttempt, botId: bot, text: '', replyTo: parent, status: 'running', error: null, time: 0 },
      { id: otherAttempt, botId: other, text: '', replyTo: parent, status: 'running', error: null, time: 0 },
    ] }
  b.durable.rooms.push(room)
  const bridge = b.create({ provider: 'feishu' })
  await bridge.attention(otherSession, 'approval-other'); await bridge.wake()
  expect(b.sent).toEqual([])
  await bridge.attention(ownSession, 'approval-own'); await bridge.attention(ownSession, 'approval-own'); await bridge.wake()
  expect(b.sent).toHaveLength(1)
  expect(b.sent[0]).toMatchObject({ user: 'alice', botId: bot, conversation: { accountId: 'app', id: 'group' } })
  const command = (id: string, sender: string): Incoming => ({ ...input(id, '/stop', sender, true), conversation: { ...room.external!, accountId: 'app' } })
  await bridge.receive(command('stop-bob', 'bob')); await bridge.wake()
  expect(b.stop).not.toHaveBeenCalled()
  await bridge.receive(command('stop-alice', 'alice')); await bridge.wake()
  expect(b.stop).toHaveBeenCalledExactlyOnceWith({ roomId: room.id, messageId: ownAttempt })
  expect(room.messages.find(message => message.id === otherAttempt)?.status).toBe('running')
  await bridge.close()
})

it('ignores unauthorized senders and does not claim receipts rejected by queue capacity', async () => {
  const b = bench(); const bridge = b.create({ maxQueuePerRoom: 1 })
  expect(await bridge.receive(input('0', 'hello', 'stranger'))).toBe('ignored')
  await bridge.receive(input('1')); await bridge.wake()
  await expect(bridge.receive(input('2'))).rejects.toThrow('queue is full')
  expect(b.state().receipts).toHaveLength(1)
  b.complete(); await bridge.wake()
  await bridge.receive(input('2')); await bridge.wake()
  expect(b.submitted).toHaveLength(2)
  await bridge.close()
})

it('notifies native attention once and reports interruption without re-executing', async () => {
  const b = bench()
  await b.bridge.receive(input('1')); await b.bridge.wake()
  const room = b.durable.rooms[0]!
  await b.bridge.attention(room.members[0]!.sessionId, 'approval-1')
  await b.bridge.attention(room.members[0]!.sessionId, 'approval-1'); await b.bridge.wake()
  expect(b.sent.filter(item => item.text.includes('人工处理'))).toHaveLength(1)
  room.messages.at(-1)!.status = 'interrupted'
  await b.bridge.wake()
  expect(b.sent.at(-1)?.text).toContain('未自动重跑')
  expect(b.submitted).toHaveLength(1)
  await b.bridge.close()
})

it('keeps chunk order during retries and never repoints an old-account delivery', async () => {
  const b = bench(); const bridge = b.create({ chunkSize: 5 })
  b.send.mockRejectedValueOnce(new Error('first part failed'))
  await bridge.receive(input('1')); await bridge.wake()
  expect(b.sent).toEqual([])
  await bridge.close()
  const other = b.create({ accountId: 'other' }); await other.wake()
  expect(b.sent).toEqual([])
  await other.close()
  await new Promise(resolve => setTimeout(resolve, 5))
  const next = b.create({ chunkSize: 5 }); await next.wake()
  expect(b.sent.map(item => item.text).join('')).toBe('已接收，按当前聊天的顺序处理。')
  expect(b.submitted).toHaveLength(1)
  await next.close()
})

it('persists new arrivals while a network send is stalled', async () => {
  const b = bench()
  let release!: () => void
  const blocked = new Promise<void>(resolve => { release = resolve })
  let started!: () => void
  const sending = new Promise<void>(resolve => { started = resolve })
  b.send.mockImplementationOnce(async () => { started(); await blocked })
  await b.bridge.receive(input('1')); await sending
  expect(await b.bridge.receive(input('2'))).toBe('accepted')
  expect(b.state().receipts).toHaveLength(2)
  release(); await b.bridge.wake(); await b.bridge.close()
})

it('stops already committed work even when the connector lost its submission acknowledgement', async () => {
  const b = bench()
  const real = b.save.getMockImplementation()!
  b.save.mockImplementation(async state => {
    if (state.pending.some(item => item.submitted)) throw new Error('lost submission write')
    await real(state)
  })
  await b.bridge.receive(input('1')); await b.bridge.wake()
  expect(b.state().pending[0]?.submitted).toBeUndefined()
  expect(b.submitted).toHaveLength(1)
  b.save.mockImplementation(real)
  await b.bridge.receive(input('2', '/stop')); await b.bridge.wake(); await b.bridge.wake()
  expect(b.stop).toHaveBeenCalledTimes(1)
  expect(b.submitted).toHaveLength(1)
  expect(b.sent.some(item => item.text.includes('开始执行前取消'))).toBe(false)
  expect(b.sent.some(item => item.text.includes('执行已停止'))).toBe(true)
  await b.bridge.close()
})

it('reads v1 local records without changing Bot, Room, message or Session identities', async () => {
  const b = bench()
  await b.bridge.receive(input('1')); await b.bridge.wake()
  const legacy = structuredClone(b.durable)
  for (const room of legacy.rooms) { delete room.external; for (const message of room.messages) delete message.external }
  expect(botDomain.version).toBe(1)
  expect(botDomain.global.schema.parse(legacy)).toEqual(legacy)
  expect(botDomain.global.schema.parse(b.durable)).toEqual(b.durable)
  await b.bridge.close()
})

it('opens unlisted InfoFlow groups only after an explicit all-groups selection, without opening private chats', async () => {
  const b = bench(), group = input('allowed-group', '/help', 'outside', true)
  group.conversation.id = 'unlisted'
  expect(await b.bridge.receive(group)).toBe('ignored')
  const enabled = b.create({ allowAllGroups: true })
  expect(await enabled.receive(group)).toBe('accepted')
  expect(await enabled.receive(input('outside-dm', 'hello', 'outside'))).toBe('ignored')
  const feishu = b.create({ provider: 'feishu', allowAllGroups: true })
  expect(await feishu.receive({ ...group, conversation: { ...group.conversation, provider: 'feishu' } })).toBe('ignored')
  await enabled.close(); await feishu.close(); await b.bridge.close()
})
