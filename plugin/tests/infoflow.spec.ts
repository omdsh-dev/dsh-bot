/** Fault injection at the bridge's durable admission and delivery interfaces. */
import { expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { InfoFlowBridge, type BridgeConfig } from '../src/infoflow/bridge.ts'
import { decodeMessage, conversationKey, splitMessage, type Incoming } from '../src/infoflow/messages.ts'
import { bridgeSchema, type BridgeState, type Delivery } from '../src/infoflow/domain.ts'
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

it('retries one retained delivery without repeating model admission and discards only the selected failure', async () => {
  const delivery = { id: 'failed-1', conversation: input('source').conversation, user: 'alice', text: 'retained reply', attempts: 8, nextAt: 10000 }
  const b = bench({ receipts: [], pending: [], outbox: [], notices: [], failed: [
    { time: 1, reason: 'exhausted', delivery }, { time: 2, reason: 'permanent', delivery: { ...delivery, id: 'failed-2' } },
  ] })
  expect(b.bridge.failures('sage').map(item => item.id)).toEqual(['failed-1', 'failed-2'])
  await b.bridge.resolveFailure('failed-1', 'retry'); await b.bridge.wake()
  expect(b.sent.map(item => item.text)).toEqual(['retained reply'])
  expect(b.submitted).toHaveLength(0)
  expect(b.bridge.failures('sage')).toHaveLength(1)
  await b.bridge.resolveFailure('failed-2', 'discard')
  expect(b.bridge.failures('sage')).toHaveLength(0)
  await b.bridge.close()
})

it('persists scheduled notification cursors without skipping unfinished replies or sending DSH-local work', async () => {
  const b = bench()
  const room = await b.bots.ensureExternalRoom({ conversation: input('x', '', 'alice', true).conversation, title: 'group', botIds: [bot], defaultBot: bot })
  const live = b.durable.rooms.find(item => item.id === room.id)!
  const user = { id: 'scheduled' as ChatMessageId, botId: null, text: 'check', replyTo: null, status: 'complete' as const, error: null, time: 1, scheduleId: 's1' }
  live.messages.push(user, { ...user, id: 'response' as ChatMessageId, botId: bot, replyTo: user.id, status: 'running' })
  const bridge = b.create({ notifyScheduled: true })
  await bridge.wake(); expect(b.sent).toHaveLength(0)
  live.messages[1]!.status = 'complete'; live.messages[1]!.text = 'scheduled result'
  await bridge.wake(); expect(b.sent).toHaveLength(1)
  await bridge.close()
  const restarted = b.create({ notifyScheduled: true })
  await restarted.wake(); expect(b.sent).toHaveLength(1)
  live.messages.push({ ...user, id: 'local-user' as ChatMessageId, localOnly: true },
    { ...live.messages[1]!, id: 'local-result' as ChatMessageId, replyTo: 'local-user' as ChatMessageId, localOnly: true })
  await restarted.wake(); expect(b.sent).toHaveLength(1)
  await restarted.close(); await b.bridge.close()
})

it('delivers a parent promptly, retains its delegated child through restart, and stops it for the original human', async () => {
  const b = bench(), other = brandString<BotId>('worker')
  await b.bridge.receive(input('delegation', 'delegate', 'alice', true)); await b.bridge.wake()
  const room = b.durable.rooms[0]!, parent = room.messages.find(message => message.botId === bot)!, root = room.messages[0]!
  room.members.push({ botId: other, sessionId: SessionId('worker-session'), cursor: 0 })
  parent.status = 'complete'; parent.text = '@worker task'
  room.messages.push({ ...parent, id: brandString<ChatMessageId>('child'), botId: other, replyTo: parent.id, text: '', status: 'running',
    delegation: { rootId: root.id, task: 'task' } })
  await b.bridge.wake()
  expect(b.sent.filter(item => item.text === '@worker task')).toHaveLength(1)
  expect(b.sent.filter(item => item.botId === other && item.text.includes('已接单'))).toHaveLength(1)
  expect(b.sent.findIndex(item => item.text === '@worker task')).toBeLessThan(b.sent.findIndex(item => item.text.includes('已接单')))
  expect(b.state().pending).toHaveLength(1)
  await b.bridge.close()
  const resumed = b.create({ allowDelegation: true })
  await resumed.wake()
  expect(b.sent.filter(item => item.text === '@worker task')).toHaveLength(1)
  expect(b.sent.filter(item => item.botId === other && item.text.includes('已接单'))).toHaveLength(1)
  await resumed.attention(SessionId('worker-session'), 'child-approval'); await resumed.wake()
  expect(b.sent.some(item => item.text.includes('请求了人工处理'))).toBe(true)
  expect(b.sent.find(item => item.text.includes('请求了人工处理'))?.botId).toBe(other)
  await resumed.receive(input('stop-stranger', '/stop', 'bob', true)); await resumed.wake()
  expect(b.stop).not.toHaveBeenCalled()
  await resumed.receive(input('stop-owner', '/stop', 'alice', true)); await resumed.wake(); await resumed.wake()
  expect(b.stop).toHaveBeenCalledWith({ roomId: room.id, messageId: 'child', cascade: true })
  expect(b.sent.filter(item => item.botId === other && item.text === '执行已停止。')).toHaveLength(1)
  expect(b.state().pending).toHaveLength(0)
  await resumed.close()
})

it('requires the exact robot AT and lossless IDs, and ignores forwarded group traffic', () => {
  const envelope = (robotid: unknown, eventtype = 'MESSAGE_RECEIVE', receipt: unknown = '9223372036854775807') => ({ data: { raw: {
    groupid: 'group', eventtype, message: { header: { fromuserid: 'alice', messageid: receipt }, body: [{ type: 'AT', robotid }, { type: 'TEXT', content: '@all question' }, { type: 'QUOTE', content: '@other hidden' }] },
  } } })
  expect(decodeMessage('group.text', envelope('robot'), 'app', 'robot')).toMatchObject({ message: { id: '9223372036854775807' }, text: '@all question' })
  expect(decodeMessage('group.text', envelope('other'), 'app', 'robot')).toBeNull()
  expect(decodeMessage('group.text', envelope('robot', 'ALL_MESSAGE_FORWARD'), 'app', 'robot')).toBeNull()
  expect(decodeMessage('group.text', envelope('robot', 'MESSAGE_RECEIVE', 9223372036854775807), 'app', 'robot')).toBeNull()
  const echo = envelope('robot'); Object.assign(echo.data.raw.message.header, { role: 'robot' })
  expect(decodeMessage('group.text', echo, 'app', 'robot')).toBeNull()
  const peer = envelope('robot'); peer.data.raw.message.header.fromuserid = 'peer'
  expect(decodeMessage('group.text', peer, 'app', 'robot', ['peer'])).toBeNull()
  expect(splitMessage('你好😀世界', 3)).toEqual(['你好😀', '世界'])
})

it('persists native handoff mentions and acknowledgements together, retrying through restart only once', async () => {
  const b = bench(), other = brandString<BotId>('worker')
  await b.bridge.close()
  const bridge = b.create({ allowDelegation: true, mentionId: () => '22', chunkSize: 12 })
  await bridge.receive(input('handoff', 'delegate', 'alice', true)); await bridge.wake()
  const room = b.durable.rooms[0]!, parent = room.messages[1]!, root = room.messages[0]!
  parent.status = 'complete'; parent.text = '@worker implement a long task'
  room.messages.push({ ...parent, id: brandString<ChatMessageId>('child'), botId: other, replyTo: parent.id, text: '', status: 'running',
    delegation: { rootId: root.id, task: 'implement a long task' } })
  b.send.mockRejectedValueOnce(new Error('network unavailable'))
  await bridge.wake(); await bridge.close()
  const retained = bridgeSchema.parse(b.state())
  expect(retained.outbox.filter(item => item.mentions?.length)).toHaveLength(1)
  expect(retained.outbox[0]?.mentions).toEqual([{ id: '22', name: 'worker' }])
  expect(retained.pending[0]?.announced).toEqual(['child'])
  const resumed = b.create({ allowDelegation: true, mentionId: () => 'changed-after-restart' })
  await new Promise(resolve => setTimeout(resolve, 5)); await resumed.wake(); await resumed.wake()
  expect(b.sent.filter(item => item.mentions?.length).map(item => item.mentions)).toEqual([[{ id: '22', name: 'worker' }]])
  expect(b.sent.filter(item => item.botId === other && item.text.includes('已接单'))).toHaveLength(1)
  expect(b.state().outbox).toHaveLength(0)
  await resumed.close()
})

it('keeps all recipients when a handoff exceeds the platform limit of ten robot mentions', async () => {
  const b = bench(); await b.bridge.close()
  const bridge = b.create({ allowDelegation: true, mentionId: botId => botId })
  await bridge.receive(input('many', 'delegate', 'alice', true)); await bridge.wake()
  const room = b.durable.rooms[0]!, parent = room.messages[1]!, root = room.messages[0]!
  parent.status = 'complete'; parent.text = 'dispatch'
  for (let i = 1; i <= 11; i++) room.messages.push({ ...parent, id: brandString<ChatMessageId>(`child-${i}`), botId: brandString<BotId>(String(i)),
    replyTo: parent.id, text: 'done', delegation: { rootId: root.id, task: 'task' } })
  await bridge.wake()
  const handoffs = b.sent.filter(item => item.mentions?.length)
  expect(handoffs.map(item => item.mentions!.length)).toEqual([10, 1])
  expect(handoffs.flatMap(item => item.mentions!.map(mention => mention.id))).toEqual(Array.from({ length: 11 }, (_, index) => String(index + 1)))
  expect(b.state().pending).toHaveLength(0)
  await bridge.close()
})

it.each([false, true])('delivers long InfoFlow Markdown without blocking the room (retained outbox: %s)', async retained => {
  const content = '审'.repeat(2047) + '😀' + '阅'.repeat(460)
  const outbound: Delivery = { id: 'long-report', conversation: input('report', '', 'alice', true).conversation,
    user: 'alice', botId: bot, text: content, attempts: 8, nextAt: Date.now() + 120000, mentions: [{ id: '22', name: 'Worker' }] }
  const b = bench(retained ? { pending: [], receipts: [], notices: [], outbox: [outbound] } : undefined)
  b.send.mockImplementation(async delivery => {
    if (delivery.text.length > 2048) throw new Error('InfoFlow API Error: markdown内容长度超过2048个字符 (errcode: 40068)')
    b.sent.push(delivery)
  })
  if (!retained) {
    await b.bridge.receive(input('report', 'review', 'alice', true)); await b.bridge.wake()
    const response = b.durable.rooms[0]!.messages[1]!
    response.status = 'complete'; response.text = content
    b.sent.length = 0
  }
  await b.bridge.wake()
  expect(b.sent.map(item => item.text).join('')).toBe(content)
  expect(b.sent.every(item => item.text.length <= 2048 && !item.text.includes('\uFFFD'))).toBe(true)
  expect(b.sent.every(item => item.botId === bot)).toBe(true)
  if (retained) expect(b.sent.filter(item => item.mentions?.length)).toHaveLength(1)
  expect(b.state().outbox).toHaveLength(0)
  await b.bridge.close()
})

it('resumes an oversized reply after a later chunk fails without replaying its first chunk', async () => {
  const content = '前'.repeat(2048) + '后'.repeat(500)
  const b = bench({ pending: [], receipts: [], notices: [], outbox: [{ id: 'old-reply',
    conversation: input('old', '', 'alice', true).conversation, user: 'alice', botId: bot, text: content, attempts: 8, nextAt: 0 }] })
  let fail = true
  b.send.mockImplementation(async item => {
    if (item.text.startsWith('后') && fail) { fail = false; throw new Error('temporary network failure') }
    b.sent.push(item)
  })
  await b.bridge.wake(); await b.bridge.close()
  expect(b.sent.map(item => item.text).join('')).toBe('前'.repeat(2048))
  expect(b.state().outbox).toHaveLength(1)
  const resumed = b.create()
  await new Promise(resolve => setTimeout(resolve, 5)); await resumed.wake()
  expect(b.sent.map(item => item.text).join('')).toBe(content)
  expect(new Set(b.sent.map(item => item.id)).size).toBe(2)
  expect(b.state().outbox).toHaveLength(0)
  await resumed.close()
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
  await new Promise(resolve => setTimeout(resolve, 5))
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
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
  try {
    const b = bench(); const bridge = b.create({ chunkSize: 5 })
    b.send.mockRejectedValueOnce(new Error('first part failed'))
    await bridge.receive(input('1')); await bridge.wake()
    expect(b.sent).toEqual([])
    expect(b.state().outbox[0]?.nextAt).toBe(1001)
    await bridge.close()
    // A changed account must retain even deliveries whose retry deadline has passed.
    clock.mockReturnValue(1001)
    const other = b.create({ accountId: 'other' }); await other.wake()
    expect(b.sent).toEqual([])
    await other.close()
    const next = b.create({ chunkSize: 5 }); await next.wake()
    expect(b.sent.map(item => item.text).join('')).toBe('已接收，按当前聊天的顺序处理。')
    expect(b.submitted).toHaveLength(1)
    await next.close()
  } finally { clock.mockRestore() }
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

it('quarantines an exhausted delivery and lets later replies in the same conversation pass', async () => {
  const b = bench(), clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
  try {
    b.send.mockRejectedValue(new Error('unavailable bot'))
    await b.bridge.receive(input('bad', '/help')); await b.bridge.wake()
    for (let i = 0; i < 12; i++) { clock.mockReturnValue(2000 + i); await b.bridge.wake() }
    expect(b.send.mock.calls.length).toBeLessThanOrEqual(8)
    expect(b.state().outbox).toHaveLength(0)
    expect(Reflect.get(b.state(), 'failed')).toHaveLength(1)
    b.send.mockImplementation(async delivery => { b.sent.push(delivery) })
    await b.bridge.receive(input('good', '/status')); await b.bridge.wake()
    expect(b.sent.length).toBeGreaterThan(0)
  } finally { clock.mockRestore(); await b.bridge.close() }
})

it('recognizes permanent admission errors from a separately bundled owner', async () => {
  const b = bench()
  vi.spyOn(b.bots, 'ensureExternalRoom').mockRejectedValueOnce(Object.assign(new Error('invalid roster'), { code: 'DSH_EXTERNAL_PERMANENT' }))
  await b.bridge.receive(input('invalid')); await b.bridge.wake()
  expect(b.state().pending).toHaveLength(0)
  expect(b.state().failed?.[0]?.reason).toBe('permanent')
  await b.bridge.receive(input('next')); await b.bridge.wake()
  expect(b.submitted).toHaveLength(1)
  await b.bridge.close()
})

it('backs off admission failures, bounds retries and admits the next request', async () => {
  const b = bench(), clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
  const ensure = vi.spyOn(b.bots, 'ensureExternalRoom').mockRejectedValue(new Error('invalid configuration'))
  try {
    await b.bridge.receive(input('bad')); await b.bridge.wake()
    const calls = ensure.mock.calls.length
    for (let i = 0; i < 5; i++) await b.bridge.wake()
    expect(ensure).toHaveBeenCalledTimes(calls)
    for (let i = 0; i < 12; i++) { clock.mockReturnValue(2000 + i); await b.bridge.wake() }
    expect(b.state().pending).toHaveLength(0)
    expect(Reflect.get(b.state(), 'failed')).toHaveLength(1)
    expect(ensure.mock.calls.length).toBeLessThanOrEqual(8)
    ensure.mockRestore()
    await b.bridge.receive(input('good')); await b.bridge.wake()
    expect(b.submitted).toHaveLength(1)
  } finally { clock.mockRestore(); await b.bridge.close() }
})

it('accepts another conversation while a stop waits for the agent to settle', async () => {
  const b = bench()
  let release!: () => void, started!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const stopping = new Promise<void>(resolve => { started = resolve })
  await b.bridge.receive(input('first')); await b.bridge.wake()
  b.stop.mockImplementationOnce(async () => { started(); await gate; b.complete(); return true })
  await b.bridge.receive(input('stop', '/stop')); await stopping
  let accepted = false
  const arrival = b.bridge.receive(input('second', 'hello', 'bob')).then(() => { accepted = true })
  try {
    for (let i = 0; i < 30; i++) await Promise.resolve()
    expect(accepted).toBe(true)
  } finally { release(); await arrival; await b.bridge.close() }
})

it('rolls bounded receipt and notice windows without refusing all future input', async () => {
  const b = bench(), bridge = b.create({ maxReceipts: 2 })
  for (const id of ['1', '2', '3']) { await bridge.receive(input(id, '/help')); await bridge.wake() }
  expect(b.state().receipts).toHaveLength(2)
  expect(await bridge.receive(input('3', '/help'))).toBe('duplicate')
  await bridge.close(); await b.bridge.close()
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
  await new Promise(resolve => setTimeout(resolve, 5))
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

it.each(['infoflow', 'feishu'] as const)('opens unlisted %s groups only after an explicit all-groups selection, without opening private chats', async provider => {
  const b = bench(), group = input('allowed-group', '/help', 'outside', true)
  group.conversation.id = 'unlisted'
  group.conversation.provider = provider
  const restricted = b.create({ provider })
  expect(await restricted.receive(group)).toBe('ignored')
  const enabled = b.create({ provider, allowAllGroups: true })
  expect(await enabled.receive(group)).toBe('accepted')
  const dm = input('outside-dm', 'hello', 'outside')
  dm.conversation.provider = provider
  expect(await enabled.receive(dm)).toBe('ignored')
  await enabled.close()
  const revoked = b.create({ provider, allowAllGroups: false })
  expect(await revoked.receive({ ...group, message: { ...group.message, id: 'after-revoke' } })).toBe('ignored')
  await restricted.close(); await revoked.close(); await b.bridge.close()
})

it('persists media descriptors before fetch and retries a retained media failure without replaying accepted work', async () => {
  const b = bench()
  const { PermanentChatError } = await import('../src/external-errors.ts')
  const prepare = vi.fn(async (_incoming: Incoming) => {
    expect(b.state().pending[0]!.input.media).toEqual({ accountId: 'app' })
    throw new PermanentChatError('missing media permission')
  })
  Reflect.get(b.bridge, 'sender').prepare = prepare
  await b.bridge.receive({ ...input('media'), media: { accountId: 'app' } }); await b.bridge.wake()
  await vi.waitFor(() => expect(b.bridge.failures('sage')[0]?.kind).toBe('media'))
  expect(b.submitted).toHaveLength(0)
  prepare.mockImplementation(async incoming => ({ ...incoming, text: 'transcript' }) as never)
  await b.bridge.resolveFailure(b.bridge.failures('sage')[0]!.id, 'retry'); await b.bridge.wake()
  await vi.waitFor(() => expect(b.submitted).toHaveLength(1))
  b.complete(); await b.bridge.wake(); await b.bridge.close()
  const restarted = b.create(); await restarted.wake()
  expect(b.submitted).toHaveLength(1)
  await restarted.close()
})

it('retains attachment delivery independently from sent text and supports offline recovery', async () => {
  const b = bench()
  await b.bridge.receive(input('output')); await b.bridge.wake(); b.complete()
  b.durable.rooms[0]!.messages.at(-1)!.attachments = [{ type: 'file', attachment: { attachmentId: 'sha256:' + 'a'.repeat(64), name: 'report.pdf', bytes: 4 } }]
  const { PermanentChatError } = await import('../src/external-errors.ts')
  b.send.mockImplementation(async delivery => { if (delivery.attachment) throw new PermanentChatError('missing permission'); b.sent.push(delivery) })
  await b.bridge.wake()
  expect(b.sent.filter(item => item.text === 'answer')).toHaveLength(1)
  const failed = b.bridge.failures('sage')[0]!
  await b.bridge.close()
  await b.bridge.resolveFailure(failed.id, 'retry')
  expect(b.state().outbox).toHaveLength(1)
  expect(b.state().outbox[0]!.attachment?.attachment.name).toBe('report.pdf')
  expect(b.submitted).toHaveLength(1)
  b.send.mockImplementation(async delivery => { b.sent.push(delivery) })
  const restarted = b.create(); await restarted.wake(); await restarted.close()
  expect(b.sent.filter(item => item.text === 'answer')).toHaveLength(1)
  expect(b.sent.filter(item => item.attachment)).toHaveLength(1)
})

it('admits new requests and stops media preparation without waiting for transcription or starting canceled work', async () => {
  const b = bench()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const prepare = vi.fn(async (incoming: Incoming) => { await gate; return incoming })
  Reflect.get(b.bridge, 'sender').prepare = prepare
  await b.bridge.receive({ ...input('slow-media'), media: { accountId: 'app' } }); await b.bridge.wake()
  expect(prepare).toHaveBeenCalledOnce()
  await expect(b.bridge.receive(input('other-room', 'hello', 'bob'))).resolves.toBe('accepted')
  await expect(b.bridge.receive(input('stop-media', '/stop'))).resolves.toBe('accepted')
  release(); await b.bridge.wake()
  await vi.waitFor(() => expect(b.state().pending.some(item => item.input.message.id === 'slow-media')).toBe(false))
  expect(b.submitted.some(item => item.external.id === 'slow-media')).toBe(false)
  b.complete(); await b.bridge.wake(); await b.bridge.close()
})
