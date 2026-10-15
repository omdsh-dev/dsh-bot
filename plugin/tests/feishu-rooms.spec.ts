/** Legacy history migration retains response references, queue aliases and native Sessions. */
import { expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import { mergeFeishuRooms } from '../src/feishu/rooms.ts'
import type { BotId, BotState, RoomId, ChatMessageId, Room } from '../src/types.ts'
const bot = (id: string) => brandString<BotId>(id)
const msg = (id: string) => brandString<ChatMessageId>(id)
function room(id: string, target: string): Room {
  return { id: brandString<RoomId>(id), title: `Team · ${target}`, kind: 'group', defaultBot: bot(target),
    external: { provider: 'feishu', accountId: `cli_${target}`, kind: 'group', id: 'oc_shared' },
    members: [{ botId: bot(target), sessionId: SessionId(`session-${target}`), cursor: 2 }],
    messages: [
      { id: msg(`user-${target}`), botId: null, text: 'same human message', replyTo: null, status: 'complete', error: null, time: 10,
        external: { id: 'om_shared', sender: { id: `ou_${target}_owner`, name: 'Owner' } } },
      { id: msg(`answer-${target}`), botId: bot(target), text: `answer ${target}`, replyTo: msg(`user-${target}`), status: 'complete', error: null, time: target === 'alpha' ? 11 : 12 },
    ] }
}
it('merges old split rooms once, preserves Sessions and replies, and records per-app human IDs', () => {
  const state: BotState = { bots: [], rooms: [room('one', 'alpha'), room('two', 'beta')] }
  const merged = mergeFeishuRooms(state, 'oc_shared')!
  expect(state.rooms).toHaveLength(1)
  expect(merged).toMatchObject({ id: 'one', aliases: ['two'], external: { accountId: 'group:oc_shared' } })
  expect(merged.members.map(member => [member.botId, member.sessionId, member.cursor])).toEqual([['alpha', 'session-alpha', 0], ['beta', 'session-beta', 0]])
  expect(merged.messages.map(message => [message.id, message.replyTo])).toEqual([['user-alpha', null], ['answer-alpha', 'user-alpha'], ['answer-beta', 'user-alpha']])
  expect(merged.messages[0]?.external?.sources).toEqual([{ accountId: 'cli_alpha', senderId: 'ou_alpha_owner' }, { accountId: 'cli_beta', senderId: 'ou_beta_owner' }])
  merged.members[0]!.cursor = 3
  const saved = structuredClone(state); mergeFeishuRooms(state, 'oc_shared'); expect(state).toEqual(saved)
})
it('never folds private chats or separate platform groups into a shared group', () => {
  const other = room('other', 'beta'); other.external!.id = 'oc_other'
  const dm = room('dm', 'alpha'); dm.kind = 'dm'; dm.external!.kind = 'private'
  const state: BotState = { bots: [], rooms: [room('one', 'alpha'), other, dm] }
  mergeFeishuRooms(state, 'oc_shared'); expect(state.rooms).toHaveLength(3)
  expect(dm.external!.accountId).toBe('cli_alpha'); expect(other.external!.accountId).toBe('cli_beta')
})
it('refuses to move active responses or choose between conflicting native Sessions', () => {
  const one = room('one', 'alpha'), two = room('two', 'beta'), state: BotState = { bots: [], rooms: [one, two] }
  one.messages[1]!.status = 'running'
  expect(() => mergeFeishuRooms(state, 'oc_shared')).toThrow('active'); expect(state.rooms).toHaveLength(2)
  one.messages[1]!.status = 'complete'; two.members = [{ ...one.members[0]!, sessionId: SessionId('different') }]
  expect(() => mergeFeishuRooms(state, 'oc_shared')).toThrow('Conflicting Bot Sessions'); expect(state.rooms).toHaveLength(2)
})
