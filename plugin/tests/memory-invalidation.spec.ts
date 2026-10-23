import { expect, it } from 'vitest'
import { botDomain } from '../src/domain.ts'
import { saveMemory } from '../src/memory.ts'
import { memoryAudience, memoryVersion, invalidateMemories } from '../src/memory-invalidation.ts'

function fixture() {
  return botDomain.global.schema.parse({ memoryEpoch: 4, bots: ['a', 'b'].map(id => ({ id, name: id, instructions: '', preset: 'standard' })),
    rooms: [
      { id: 'local', title: 'Local', kind: 'dm', defaultBot: 'a', members: [{ botId: 'a', sessionId: 'sa', cursor: 0, memoryEpoch: 4 }], messages: [] },
      ...['alice', 'bob'].map(id => ({ id, title: id, kind: 'dm', defaultBot: 'a', external: { provider: 'feishu', accountId: 'app', kind: 'private', id }, members: [{ botId: 'a', sessionId: id, cursor: 1, memoryEpoch: 4 }],
        messages: [{ id: id + 'm', botId: null, text: '', status: 'complete', replyTo: null, error: null, time: 1, external: { id: id + 'e', sender: { id, name: id } } }] })),
      { id: 'group', title: 'Group', kind: 'group', aliases: ['old-group'], defaultBot: 'a', members: ['a', 'b'].map(botId => ({ botId, sessionId: 'g' + botId, cursor: 0, memoryEpoch: 4 })), messages: [] },
    ] })
}
it('invalidates only memberships that could have recalled the edited or forgotten memory', () => {
  const state = fixture()
  const bot = saveMemory(state, { scope: 'bot', ownerId: 'b', kind: 'preference', subject: 'reply', topic: 'style', body: 'Be concise', evidence: '' })
  const targets = memoryAudience(state, [bot])
  expect(targets).toEqual([{ roomId: 'group', botId: 'b' }])
  invalidateMemories(state, targets)
  expect(memoryVersion(state, state.rooms[3]!, 'b')).toBe(5)
  expect(memoryVersion(state, state.rooms[3]!, 'a')).toBe(4)
  expect(memoryVersion(state, state.rooms[0]!, 'a')).toBe(4)
  const group = { ...bot, scope: 'group' as const, ownerId: 'old-group' }
  expect(memoryAudience(state, [group])).toEqual([{ roomId: 'group', botId: 'a' }, { roomId: 'group', botId: 'b' }])
})
it('keeps user-private, source-room and linked-account invalidation isolated', () => {
  const state = fixture(), alice = JSON.stringify(['feishu', 'app', 'alice']), bob = JSON.stringify(['feishu', 'app', 'bob'])
  const memory = saveMemory(state, { scope: 'user', ownerId: alice, kind: 'preference', subject: 'reply', topic: 'style', body: 'Be concise', evidence: '' })
  expect(memoryAudience(state, [memory])).toEqual([{ roomId: 'alice', botId: 'a' }])
  expect(memoryAudience(state, [{ ...memory, access: 'source-room', source: { ...memory.source, roomId: 'group' } }])).toEqual([])
  state.userIdentities = [{ id: 'person:ab', name: 'AB', aliases: [alice, bob] }]
  expect(memoryAudience(state, [memory])).toEqual([{ roomId: 'alice', botId: 'a' }, { roomId: 'bob', botId: 'a' }])
  expect(memoryAudience(state, [], ['person:ab'])).toEqual([{ roomId: 'alice', botId: 'a' }, { roomId: 'bob', botId: 'a' }])
  expect(memoryAudience(state, [{ ...memory, scope: 'global', ownerId: '*', access: 'scope' }])).toHaveLength(5)
})
