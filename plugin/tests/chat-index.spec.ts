import { expect, it } from 'vitest'
import { ChatIndex } from '../src/chat-index.ts'
import { HistoryStore } from '../src/history-store.ts'
import { botDomain } from '../src/domain.ts'
import type { BotState } from '../src/types.ts'

it('persists inverted indexes across restart, reads only matching source chunks and keeps external local-only data private', async () => {
  const docs = new Map<string, unknown>(), opened: string[] = []
  const open = async (spec: { name: string; global: { schema: { parse(value: unknown): unknown }; initial: unknown } }) => ({ global: {
    get: () => spec.global.schema.parse(docs.get(spec.name) ?? spec.global.initial),
    set: async (value: unknown) => { docs.set(spec.name, structuredClone(value)) },
  }, close: async () => {} })
  const history = () => new HistoryStore(async spec => { opened.push(spec.name); return await open(spec) as never })
  const index = (store: HistoryStore) => new ChatIndex(store, async spec => { opened.push(spec.name); return await open(spec) as never })
  const state = botDomain.global.schema.parse({ bots: [], rooms: [{ id: 'r', title: 'Group', kind: 'group', defaultBot: 'b', members: [],
    external: { provider: 'feishu', accountId: 'app', kind: 'group', id: 'group' },
    messages: Array.from({ length: 800 }, (_, i) => ({ id: 'm' + i, botId: null, replyTo: null, status: 'complete', error: null, time: i,
      text: i === 10 ? '发布审批需要核对构建日志' : i === 20 ? '发布审批 PRIVATE_OPERATOR_DATA' : 'ordinary message ' + i, localOnly: i === 20 })) }] })
  const store = history(); let saved: BotState = state
  await store.persist(state, async value => { saved = value })
  const first = await index(store).query(saved.rooms[0]!, false, '发布审批')
  expect(first.map(row => row.id)).toEqual(['m10'])
  expect(JSON.stringify(first)).not.toContain('PRIVATE_OPERATOR_DATA')
  opened.length = 0
  const restarted = index(history())
  const result = await restarted.query(saved.rooms[0]!, false, '发布审批')
  expect(result).toEqual(first)
  expect(opened.filter(name => name.startsWith('bot_history_'))).toHaveLength(1)
  expect((await restarted.query(saved.rooms[0]!, true, '发布审批')).map(row => row.id)).toEqual(['m20', 'm10'])
  expect((await restarted.query(saved.rooms[0]!, false, 'no-such-term'))).toEqual([])
  const hash = saved.rooms[0]!.historyChunks![0]!
  docs.set('bot_search_' + hash, { broken: true })
  expect(await index(history()).query(saved.rooms[0]!, false, '发布审批')).toEqual(first)
  await expect(restarted.query({ ...saved.rooms[0]!, deleted: true }, false, '发布审批')).rejects.toThrow('deleted')
})

it('uses only committed chunk references, so edits cannot return obsolete indexed text', async () => {
  const docs = new Map<string, unknown>()
  const open = async (spec: { name: string; global: { schema: { parse(value: unknown): unknown }; initial: unknown } }) => ({ global: {
    get: () => spec.global.schema.parse(docs.get(spec.name) ?? spec.global.initial), set: async (value: unknown) => { docs.set(spec.name, value) },
  }, close: async () => {} })
  const store = new HistoryStore(async spec => await open(spec) as never), index = new ChatIndex(store, async spec => await open(spec) as never)
  const state = botDomain.global.schema.parse({ bots: [], rooms: [{ id: 'r', title: 'Chat', kind: 'dm', defaultBot: 'b', members: [],
    messages: Array.from({ length: 600 }, (_, i) => ({ id: 'm' + i, botId: null, replyTo: null, status: 'complete', error: null, time: i, text: i === 1 ? 'old_marker' : 'plain' })) }] })
  let saved: BotState = state
  await store.persist(state, async value => { saved = value })
  expect(await index.query(saved.rooms[0]!, false, 'old_marker')).toHaveLength(1)
  state.rooms[0]!.messages[1]!.text = 'new_marker'
  await store.persist(state, async value => { saved = value })
  expect(await index.query(saved.rooms[0]!, false, 'old_marker')).toHaveLength(0)
  expect(await index.query(saved.rooms[0]!, false, 'new_marker')).toHaveLength(1)
})
