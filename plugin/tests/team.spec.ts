import { expect, it } from 'vitest'
import { botDomain } from '../src/domain.ts'
import { parseTeamCommand, teamAuthority } from '../src/team.ts'

it('allows only current explicit Main Bot grants on a direct local human delivery', () => {
  const state = botDomain.global.schema.parse({ bots: [{ id: 'main', name: 'Main', preset: 'standard', instructions: '' }], teamSettings: { revision: 2, botId: 'main', operations: ['create-bot'] },
    rooms: [{ id: 'dm', title: 'Main', kind: 'dm', defaultBot: 'main', members: [{ botId: 'main', sessionId: 's', cursor: 0 }], messages: [
      { id: 'human', botId: null, replyTo: null, text: 'Create a researcher', status: 'complete', time: 0, error: null },
      { id: 'answer', botId: 'main', replyTo: 'human', text: '', status: 'running', time: 1, error: null },
    ] }],
  })
  const room = state.rooms[0]!, delivery = room.messages[1]!, human = room.messages[0]!
  expect(teamAuthority(state, room, delivery, 2).operations).toEqual(['create-bot'])
  expect(() => teamAuthority(state, room, delivery, 1)).toThrow('grant')
  expect(() => teamAuthority(state, { ...room, kind: 'group' }, delivery)).toThrow('direct')
  expect(() => teamAuthority(state, { ...room, external: { provider: 'feishu', accountId: 'a', kind: 'private', id: 'u' } }, delivery)).toThrow('direct')
  expect(() => teamAuthority(state, room, { ...delivery, delegation: { rootId: human.id, task: 'Create a Bot' } })).toThrow('direct')
  expect(() => teamAuthority(state, room, { ...delivery, continuationOf: delivery.id })).toThrow('direct')
  human.scheduleId = 'schedule'; expect(() => teamAuthority(state, room, delivery)).toThrow('direct')
  delete human.scheduleId; state.teamSettings!.operations = []; expect(() => teamAuthority(state, room, delivery)).toThrow('grant')
})
it('rejects team self-elevation fields, credential requests and deletion commands', () => {
  const input = { operation: 'create-bot', id: 'worker', name: 'Worker', instructions: 'Research' }
  expect(parseTeamCommand(JSON.stringify(input))).toEqual(input)
  for (const extra of [{ preset: 'unsafe' }, { policy: { toolMode: 'inherit' } }, { credential: 'TOKEN' }, { operations: ['archive'] }]) expect(() => parseTeamCommand(JSON.stringify({ ...input, ...extra }))).toThrow()
  expect(() => parseTeamCommand(JSON.stringify({ operation: 'delete', kind: 'bot', id: 'worker' }))).toThrow()
})
