import { expect, it } from 'vitest'
import { botDomain } from '../src/domain.ts'
import { imCreationAuthority, parseIMBotDraft } from '../src/im-bot-creation.ts'
import type { FeishuState } from '../src/feishu/types.ts'
import type { InfoFlowState } from '../src/types.ts'

function fixture(provider: 'feishu' | 'infoflow' = 'feishu') {
  const state = botDomain.global.schema.parse({ bots: [{ id: 'helper', name: 'Helper', preset: 'standard', instructions: '' }], rooms: [{
    id: 'im', title: 'IM', kind: 'dm', defaultBot: 'helper', members: [{ botId: 'helper', sessionId: 's', cursor: 0 }],
    external: { provider, accountId: 'app', kind: 'private', id: provider === 'feishu' ? 'oc_private_chat' : 'admin' }, messages: [
      { id: 'human', botId: null, replyTo: null, text: 'Create a researcher', status: 'complete', time: 0, error: null, external: { id: 'receipt', sender: { id: 'admin', name: 'Admin' } } },
      { id: 'reply', botId: 'helper', replyTo: 'human', text: '', status: 'running', time: 1, error: null },
    ],
  }] })
  const common = { botId: state.bots[0]!.id, enabled: true, status: 'connected' as const, error: null, robotName: 'Robot', credentialsConfigured: true,
    allowUsers: ['admin', 'guest'], allowGroups: ['group'], admins: ['admin'] }
  const feishu: FeishuState = { available: true, groups: [], registrations: [], bindings: [{ ...common, appId: 'app', brand: 'feishu', botOpenId: 'ou_bot' }] }
  const infoflow: InfoFlowState = { available: true, groups: [], bindings: [{ ...common, agentId: 'app', robotId: 'robot' }] }
  const room = state.rooms[0]!, human = room.messages[0]!, delivery = room.messages[1]!
  const grant = () => imCreationAuthority(state, room, delivery, { feishu, infoflow })
  const group = () => { room.kind = 'group'; room.external = { provider, accountId: 'group:group', kind: 'group', id: 'group' }; human.external!.sources = [{ accountId: 'app', senderId: 'admin' }] }
  return { state, room, human, delivery, feishu, infoflow, grant, group }
}

it.each(['feishu', 'infoflow'] as const)('authorizes only direct %s administrators and rechecks access on use', provider => {
  const f = fixture(provider), binding = f[provider].bindings[0]!
  expect(f.grant()).toEqual({ provider, accountId: 'app', senderId: 'admin' })
  binding.admins = []; expect(f.grant).toThrow('administrator'); binding.admins = ['admin']
  binding.enabled = false; expect(f.grant).toThrow(); binding.enabled = true
  binding.allowUsers = []; expect(f.grant).toThrow(); binding.allowUsers = ['admin']
  f.human.external!.sender.id = 'guest'; expect(f.grant).toThrow(); f.human.external!.sender.id = 'admin'
  f.human.scheduleId = 'scheduled'; expect(f.grant).toThrow(); delete f.human.scheduleId
  f.delivery.localOnly = true; expect(f.grant).toThrow(); delete f.delivery.localOnly
  f.delivery.continuationOf = f.delivery.id; expect(f.grant).toThrow(); delete f.delivery.continuationOf
  f.delivery.delegation = { rootId: f.human.id, task: 'Create a Bot' }; expect(f.grant).toThrow(); delete f.delivery.delegation
  f.delivery.status = 'complete'; expect(f.grant).toThrow(); f.delivery.status = 'running'
  f.group(); expect(f.grant().senderId).toBe('admin')
  binding.allowGroups = []; expect(f.grant).toThrow(); binding.allowGroups = ['group']
  f.human.external!.sources = [{ accountId: 'different-app', senderId: 'admin' }]; expect(f.grant).toThrow()
  f.human.external!.sources.push({ accountId: 'app', senderId: 'guest' }); expect(f.grant).toThrow()
  f.human.external!.sources[1]!.senderId = 'admin'; f.human.external!.sender.id = 'other-app-open-id'
  expect(f.grant().senderId).toBe('admin')
  f.state.bots[0]!.archived = true; expect(f.grant).toThrow()
})

it('uses the owner of the matching managed InfoFlow group and never a different binding admin', () => {
  const f = fixture('infoflow'); f.group()
  f.infoflow.groups.push({ requestId: 'r', title: 'Managed group', groupId: 'group', roomId: f.room.id, botIds: [f.state.bots[0]!.id], defaultBot: f.state.bots[0]!.id, owner: 'owner', members: [], status: 'ready', warning: null })
  expect(f.grant).toThrow()
  f.human.external!.sources = [{ accountId: 'group:group', senderId: 'owner' }]
  expect(f.grant()).toEqual({ provider: 'infoflow', accountId: 'group:group', senderId: 'owner' })
  f.infoflow.groups[0]!.owner = 'new-owner'; expect(f.grant).toThrow()
  f.infoflow.groups[0]!.status = 'linking'; expect(f.grant).toThrow()
})

it('rejects attempts to use IM creation for editing, grants, credentials or preset changes', () => {
  const draft = { id: 'writer', name: 'Writer', instructions: 'Write summaries.', capabilities: 'Summaries' }
  expect(parseIMBotDraft(JSON.stringify(draft))).toEqual(draft)
  for (const extra of [{ operation: 'edit-bot' }, { preset: 'unrestricted' }, { policy: {} }, { credentials: 'SECRET' }, { capabilities: 'x'.repeat(501) }]) {
    expect(() => parseIMBotDraft(JSON.stringify({ ...draft, ...extra }))).toThrow()
  }
})
