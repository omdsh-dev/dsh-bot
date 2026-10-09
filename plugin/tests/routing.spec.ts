import { describe, expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { BotId, BotState, ChatMessageId, Room, RoomId } from '../src/types.ts'
import { route } from '../src/routing.ts'
const a = brandString<BotId>('architect'), b = brandString<BotId>('critic'), absent = brandString<BotId>('outsider')
const reply = brandString<ChatMessageId>('answer')
const room: Room = { id: brandString<RoomId>('group'), title: 'Group', kind: 'group', defaultBot: a,
  members: [a, b].map(botId => ({ botId, sessionId: SessionId(botId), cursor: 0 })),
  messages: [{ id: reply, botId: b, text: 'Answer', replyTo: null, status: 'complete', error: null, time: 0 }] }
const state: BotState = { bots: [a, b, absent].map(id => ({ id, name: id, instructions: '', preset: 'minimal' })), rooms: [room] }
describe('explicit addressing', () => {
  it('uses the default, reply author, explicit mentions, then explicit recipients', () => {
    expect(route(state, room, { roomId: room.id, text: 'hi' })).toEqual([a])
    expect(route(state, room, { roomId: room.id, text: 'hi', replyTo: reply })).toEqual([b])
    expect(route(state, room, { roomId: room.id, text: '@ARCHITECT hi', replyTo: reply })).toEqual([a])
    expect(route(state, room, { roomId: room.id, text: '@all hi', targets: [b] })).toEqual([b])
    expect(route(state, room, { roomId: room.id, text: '@everyone hi' })).toEqual([a, b])
  })
  it('never broadcasts fenced, quoted, inline code or email mentions', () => {
    const text = '````js\n@all\n```\n@critic\n````\n> @all\n``@everyone`` a@critic.com @unknown\n~~~\n@all'
    expect(route(state, room, { roomId: room.id, text })).toEqual([a])
  })
  it('rejects nonmembers and empty targets, and keeps direct chats canonical', () => {
    expect(() => route(state, room, { roomId: room.id, text: '@outsider hi' })).toThrow(/members/)
    expect(() => route(state, room, { roomId: room.id, text: 'hi', targets: [] })).toThrow(/members/)
    const dm: Room = { ...room, kind: 'dm', members: [room.members[0]!] }
    expect(route(state, dm, { roomId: dm.id, text: 'tell me about @critic' })).toEqual([a])
    expect(() => route(state, dm, { roomId: dm.id, text: 'hi', targets: [b] })).toThrow(/members/)
  })
})
