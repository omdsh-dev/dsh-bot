import { afterEach, expect, it, vi } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ChatSearch } from '../src/chat-search.ts'
import { collectTaskResults, planHandoffs, taskResults } from '../src/delegation.ts'
import { applyMemoryReview, failMemoryReview, queueMemoryReview } from '../src/memory-review.ts'
import { linkUserIdentity, memoryUser, saveMemory, selectMemories } from '../src/memory.ts'
import { MemoryStore } from '../src/memory-store.ts'
import { actOnMemory } from '../src/memory.ts'
import { RunDeadline } from '../src/run-deadline.ts'
import { handoffNote, contextPressure } from '../src/context-continuity.ts'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { BotState, Room, ChatMessage, BotId, RoomId, ChatMessageId } from '../src/types.ts'

const id = (value: string) => brandString<ChatMessageId>(value)
const botId = (value: string) => brandString<BotId>(value)
function message(key: string, bot: string | null, text = '', extra: Partial<ChatMessage> = {}): ChatMessage {
  return { id: id(key), botId: bot ? botId(bot) : null, text, replyTo: null, status: 'complete', time: 1, error: null, ...extra }
}
function setup() {
  const human = message('human', null, '以后请用中文回复，记住这个偏好', { allowDelegation: true })
  const room: Room = { id: brandString<RoomId>('room'), kind: 'group', title: 'Group', defaultBot: botId('a'),
    members: ['a', 'b', 'c', 'd'].map(bot => ({ botId: botId(bot), sessionId: SessionId(bot), cursor: 0 })), messages: [human] }
  const state: BotState = { rooms: [room], bots: room.members.map(member => ({ id: member.botId, name: member.botId, preset: 'standard', instructions: '' })) }
  return { human, room, state }
}

afterEach(() => vi.useRealTimers())
it('indexes old Chinese and English messages, bounds excerpts and enforces room/local visibility', () => {
  const b = setup(), index = new ChatSearch()
  b.room.external = { provider: 'feishu', accountId: 'app', kind: 'group', id: 'remote' }
  b.room.messages.push(message('secret', null, 'LOCAL_SECRET', { localOnly: true }), message('release', 'a', '正式发布日期是周五 ' + 'x'.repeat(9000)))
  for (let i = 0; i < 200; i++) b.room.messages.push(message(`later-${i}`, 'a', 'ordinary message'))
  expect(index.query(b.room, false, '发布日期')[0]).toMatchObject({ id: 'release', truncated: true })
  expect(index.query(b.room, true, 'LOCAL_SECRET')).toHaveLength(1)
  expect(index.query(b.room, false, 'LOCAL_SECRET')).toEqual([])
  expect(() => index.read(b.room, false, 'secret')).toThrow('not available')
  expect(() => index.read(b.room, false, 'another-room-id')).toThrow('not available')
  expect(index.read(b.room, false, 'release').find(item => item.id === 'release')!.text).toHaveLength(8000)
  b.room.messages = b.room.messages.filter(item => item.id !== 'release')
  expect(index.query(b.room, false, '发布日期')).toEqual([])
})

it('reviews commit only evidence-backed candidates and reject an invalid batch atomically', () => {
  const b = setup()
  queueMemoryReview(b.state, b.room, b.human, 'a', 100)
  queueMemoryReview(b.state, b.room, b.human, 'b', 100)
  expect(b.state.memoryReviews).toHaveLength(1)
  const job = b.state.memoryReviews![0]!
  const candidate = { scope: 'group', kind: 'preference', subject: 'response', topic: 'language', body: '用中文回复', evidence: '以后请用中文回复' }
  expect(() => applyMemoryReview(b.state, b.room, b.human, job, JSON.stringify({ candidates: [candidate, { ...candidate, evidence: 'fabricated' }] }))).toThrow('exactly')
  expect(b.state.memories).toBeUndefined()
  expect(applyMemoryReview(b.state, b.room, b.human, job, JSON.stringify({ candidates: [candidate] }))).toBe(1)
  expect(b.state.memories![0]).toMatchObject({ status: 'pending', ownerId: 'room', source: { messageId: 'human' } })
  expect(applyMemoryReview(b.state, b.room, b.human, job, JSON.stringify({ candidates: [candidate] }))).toBe(0)
  expect(() => applyMemoryReview(b.state, b.room, b.human, job, JSON.stringify({ candidates: [{ ...candidate, scope: 'global' }] }))).toThrow()
  expect(selectMemories(b.state, b.room, 'a', 'local:operator', '中文').records).toEqual([])
})

it('backs off bad reviews independently and never reviews opted-out, local-only or scheduled work', () => {
  const b = setup()
  for (const human of [{ ...b.human, text: '不要记住本次对话' }, { ...b.human, scheduleId: 'timer' }]) queueMemoryReview(b.state, b.room, human, 'a')
  expect(b.state.memoryReviews).toBeUndefined()
  queueMemoryReview(b.state, b.room, b.human, 'a', 0)
  const job = b.state.memoryReviews![0]!
  for (let attempt = 1; attempt <= 3; attempt++) { job.attempts = attempt; failMemoryReview(job, 'bad JSON', 1000); expect(job.nextAt).toBeGreaterThan(1000) }
  expect(job.status).toBe('failed')
  queueMemoryReview(b.state, b.room, { ...b.human, id: id('next') }, 'a', 2000)
  expect(b.state.memoryReviews![1]!.status).toBe('pending')
  b.room.external = { provider: 'infoflow', accountId: 'app', kind: 'group', id: 'g' }
  queueMemoryReview(b.state, b.room, { ...b.human, id: id('private'), localOnly: true }, 'a')
  expect(b.state.memoryReviews).toHaveLength(2)
})

it('joins sibling results once, including failures, and preserves the original human authority after restart', () => {
  const b = setup()
  const parent = message('parent', 'a', 'assigned', { replyTo: b.human.id, awaiting: [id('b'), id('c')] })
  const childB = message('b', 'b', 'verified B', { replyTo: parent.id, delegation: { rootId: b.human.id, task: 'B work' } })
  const childC = message('c', 'c', '', { replyTo: parent.id, delegation: { rootId: b.human.id, task: 'C work' }, status: 'running' })
  b.room.messages.push(parent, childB, childC)
  expect(collectTaskResults(b.room, b.room.members.map(m => m.botId), 100)).toEqual([])
  childC.status = 'failed'; childC.error = 'tool failed'
  const callbacks = collectTaskResults(b.room, b.room.members.map(m => m.botId), 100)
  expect(callbacks).toHaveLength(1)
  expect(callbacks[0]).toMatchObject({ botId: 'a', continuationOf: 'parent', replyTo: 'parent', status: 'queued', resultIds: ['b', 'c'], delegation: { rootId: 'human' } })
  expect(taskResults(b.room, callbacks[0]!)).toContain('tool failed')
  expect(collectTaskResults(structuredClone(b.room), b.room.members.map(m => m.botId), 100)).toEqual([])
  expect(planHandoffs(b.room, { ...childB, text: '@a thanks', requestedTasks: [] }, b.state.bots, [botId('a')]).tasks).toEqual([])
})

it('nested work waits for the child callback, while cancellation prevents automatic resumption', () => {
  const b = setup()
  const a = message('a', 'a', '', { replyTo: b.human.id, awaiting: [id('b')] })
  const middle = message('b', 'b', '', { replyTo: a.id, delegation: { rootId: b.human.id, task: 'nested' }, awaiting: [id('d')] })
  const d = message('d', 'd', 'result', { replyTo: middle.id, delegation: { rootId: b.human.id, task: 'leaf' } })
  b.room.messages.push(a, middle, d)
  const first = collectTaskResults(b.room, b.room.members.map(m => m.botId), 100)
  expect(first.map(item => item.botId)).toEqual(['b'])
  first[0]!.status = 'complete'; first[0]!.text = 'reviewed leaf result'
  const second = collectTaskResults(b.room, b.room.members.map(m => m.botId), 100)
  expect(second[0]!.resultIds).toEqual([first[0]!.id])
  const stopped = setup(); stopped.room.messages.push({ ...a, continuedBy: undefined, collaborationCanceled: true }, { ...middle, awaiting: undefined, continuedBy: undefined })
  expect(collectTaskResults(stopped.room, [botId('a')], 100)).toEqual([])
})

it('links only explicitly selected known accounts and preserves source-room restrictions', () => {
  const b = setup()
  const dm = (app: string): Room => ({ ...b.room, kind: 'dm', id: brandString<RoomId>(app), external: { provider: 'feishu', accountId: app, kind: 'private', id: 'alice' },
    messages: [message(app, null, 'hello', { external: { id: app, sender: { id: 'alice', name: 'Alice' } } })] })
  const one = dm('one'), two = dm('two'); b.state.rooms.push(one, two)
  const u1 = memoryUser(one, one.messages[0])!, u2 = memoryUser(two, two.messages[0])!
  saveMemory(b.state, { scope: 'user', ownerId: u1, kind: 'preference', subject: 'response', topic: 'language', body: 'Chinese', evidence: '' })
  expect(selectMemories(b.state, two, 'a', u2, '').records).toEqual([])
  linkUserIdentity(b.state, { name: 'Alice', aliases: [u1, u2] })
  expect(memoryUser(two, two.messages[0], b.state)).toBe(b.state.userIdentities![0]!.id)
  expect(selectMemories(b.state, two, 'a', u2, '').records).toHaveLength(1)
  expect(selectMemories(b.state, b.room, 'a', u2, '').records).toEqual([])
  expect(() => linkUserIdentity(b.state, { name: 'Guess', aliases: [u1, 'unknown'] })).toThrow('known')
  expect(() => linkUserIdentity(b.state, { name: 'Operator', aliases: [u1, 'local:operator'] })).toThrow('local operator')
})

it('times out a stuck native wait and expires approval without granting permission', async () => {
  vi.useFakeTimers()
  const cancel = vi.fn(), deadline = new RunDeadline({ idleMs: 1000, totalMs: 10000, approvalMs: 2000 }, cancel)
  const wait = deadline.wait(new Promise<void>(() => {})).catch(error => error.message)
  deadline.awaitingApproval(true)
  await vi.advanceTimersByTimeAsync(1250)
  expect(cancel).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1000)
  expect(await wait).toContain('Approval expired'); expect(cancel).toHaveBeenCalledTimes(1)
  deadline.dispose()
})

it('does not let progress postpone the absolute deadline and supports explicit cancellation', async () => {
  vi.useFakeTimers()
  const deadline = new RunDeadline({ idleMs: 1000, totalMs: 2000, approvalMs: 9000 }, () => {})
  const wait = deadline.wait(new Promise<void>(() => {})).catch(error => error.message)
  await vi.advanceTimersByTimeAsync(750); deadline.touch()
  await vi.advanceTimersByTimeAsync(750); deadline.touch()
  await vi.advanceTimersByTimeAsync(500)
  expect(await wait).toContain('Execution time limit'); deadline.dispose()
})

it('validates structured handoffs and retains an independent hard pressure threshold', () => {
  expect(() => handoffNote('{"goals":"only one field"}')).toThrow()
  const note = { goals: 'finish task', constraints: 'do not publish', progress: 'tests passed', decisions: '', facts: '', openTasks: 'review', nextStep: 'read results', sources: 'human, parent' }
  expect(handoffNote(JSON.stringify(note))).toContain('do not publish')
  const agent = { session: { requestContext: () => ({ provider: 'p', model: 'm', contextWindow: 128000 }), deriveMessages: () => [{ text: 'x'.repeat(120000) }] }, ctx: { get: () => undefined } } as unknown as Agent
  const pressure = contextPressure(agent, setup().state.bots[0]!)
  expect(pressure).toMatchObject({ rotate: true, hard: true })
})


it('commits memory manifests before retiring old chunks, with restart recovery and unchanged-write reuse', async () => {
  const docs = new Map<string, unknown>(); let writes = 0, denyCleanup = false
  const open = async (spec: Parameters<ConstructorParameters<typeof MemoryStore>[0]>[0]) => ({ global: {
    get: () => spec.global.schema.parse(docs.get(spec.name) ?? []),
    set: async (value: unknown[]) => { if (denyCleanup && !value.length) throw new Error('cleanup blocked'); docs.set(spec.name, structuredClone(value)); writes++ },
  }, close: async () => {} }) as never
  const b = setup(), store = new MemoryStore(open)
  const memory = saveMemory(b.state, { scope: 'global', ownerId: '*', kind: 'preference', subject: 'response', topic: 'format', body: 'PRIVATE_CONTENT', evidence: '' })
  let manifest: BotState = b.state
  await store.persist(b.state, async next => { manifest = structuredClone(next) })
  const original = structuredClone(manifest), count = writes
  await store.persist(b.state, async next => { manifest = structuredClone(next) })
  expect(writes).toBe(count); expect(manifest.memories).toBeUndefined()
  actOnMemory(b.state, { id: memory.id, revision: memory.revision, action: 'forget' })
  await expect(store.persist(b.state, async () => { throw new Error('commit blocked') })).rejects.toThrow('commit blocked')
  expect((await new MemoryStore(open).hydrate(structuredClone(original))).memories![0]!.body).toBe('PRIVATE_CONTENT')
  denyCleanup = true
  await store.persist(b.state, async next => { manifest = structuredClone(next) })
  expect(manifest.retiredMemoryChunks).toHaveLength(1)
  const restored = new MemoryStore(open), state = await restored.hydrate(manifest)
  expect(state.memories![0]!.body).toBe('')
  denyCleanup = false
  await restored.persist(state, async () => {})
  expect(JSON.stringify([...docs.values()])).not.toContain('PRIVATE_CONTENT')
  await expect(new MemoryStore(open).hydrate({ bots: [], rooms: [], retiredMemoryChunks: ['../bad'] })).rejects.toThrow('Invalid retired')
})


it('rejects credentials even in memory keys and quoted evidence', () => {
  const b = setup(), request = { scope: 'global' as const, ownerId: '*', kind: 'preference' as const, subject: 'response', topic: 'language', body: 'Chinese', evidence: '' }
  const token = ['sk', 'x'.repeat(24)].join('-')
  for (const key of ['subject', 'topic', 'body', 'evidence']) expect(() => saveMemory(b.state, { ...request, [key]: token })).toThrow('Credentials')
  expect(b.state.memories).toBeUndefined()
})
