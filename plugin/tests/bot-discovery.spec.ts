import { expect, it } from 'vitest'
import { botDomain } from '../src/domain.ts'
import { discoverBots, discoveryPrompt, type DiscoveryContext } from '../src/bot-discovery.ts'

function context(): DiscoveryContext {
  const state = botDomain.global.schema.parse({ bots: [
    { id: 'helper', name: '助手', instructions: 'PRIVATE_SELF_PROMPT', preset: 'standard' },
    { id: 'writer', name: '文案伙伴', capabilities: '产品文案、发布公告、营销内容', instructions: 'PRIVATE_WRITER_PROMPT', preset: 'standard' },
    { id: 'coder', name: '工程伙伴', capabilities: '代码审查与自动化测试', instructions: 'PRIVATE_CODER_PROMPT', preset: 'standard', policy: { tools: ['secret-tool'] } },
    { id: 'retired', name: '旧文案', capabilities: '文案', instructions: '', preset: 'standard', archived: true },
  ], rooms: [{ id: 'chat', title: 'Local chat', kind: 'group', defaultBot: 'helper', members: [{ botId: 'helper', sessionId: 's1', cursor: 0 }, { botId: 'writer', sessionId: 's2', cursor: 0 }], messages: [] }] })
  return { bots: state.bots, room: state.rooms[0]!, botId: state.bots[0]!.id, eligible: [state.bots[1]!.id], delegationEnabled: false, canCreate: false, manager: { id: 'manager', name: 'Main Bot' } }
}

it('ranks public capabilities without exposing prompts, policies or granting actions', () => {
  const input = context(), before = structuredClone(input)
  const result = discoverBots(input, '帮我写产品文案')
  expect(result.entries[0]).toMatchObject({ id: 'writer', capabilities: '产品文案、发布公告、营销内容', canDelegate: false, matchesQuery: true })
  expect(result.entries.find(item => item.id === 'helper')).toMatchObject({ descriptionMissing: true, isSelf: true })
  expect(result.entries.find(item => item.id === 'coder')).toMatchObject({ inCurrentChat: false, canDelegate: false })
  expect(result.total).toBe(3)
  expect(result.creation.allowedHere).toBe(false)
  expect(JSON.stringify(result)).not.toMatch(/PRIVATE_|secret-tool|instructions|preset/)
  expect(input).toEqual(before)
  input.delegationEnabled = true
  expect(discoverBots(input).entries.find(item => item.id === 'writer')?.canDelegate).toBe(true)
})

it('limits IM discovery to eligible current members and private IM to the responding Bot', () => {
  const input = context()
  input.room.external = { provider: 'feishu', accountId: 'a', kind: 'group', id: 'external-chat' }
  expect(discoverBots(input, '工程').entries.map(item => item.id).sort()).toEqual(['helper', 'writer'])
  expect(discoverBots(input).creation.manager).toBeNull()
  input.canCreate = true
  expect(discoverBots(input).creation).toMatchObject({ allowedHere: true, tool: 'create_bot', manager: null })
  input.eligible = []
  expect(discoverBots(input).entries.map(item => item.id)).toEqual(['helper'])
  input.room.kind = 'dm'; input.room.external.kind = 'private'; input.eligible = [input.bots[1]!.id]
  expect(discoverBots(input).entries.map(item => item.id)).toEqual(['helper'])
  expect(discoveryPrompt(input, '')).not.toMatch(/PRIVATE_|工程伙伴|文案伙伴|"id":"manager"/)
})

it('keeps unknown matches browsable and paginates without implying no specialist exists', () => {
  const input = context()
  input.bots = Array.from({ length: 25 }, (_, index) => ({ ...input.bots[0]!, id: `bot-${index}` as typeof input.botId }))
  const page = discoverBots(input, 'unmatched')
  expect(page).toMatchObject({ total: 25, matched: 0, nextOffset: 20 })
  const next = discoverBots(input, 'unmatched', page.nextOffset!)
  expect(next.entries).toHaveLength(5)
  expect(next.nextOffset).toBeNull()
  expect(new Set([...page.entries, ...next.entries].map(item => item.id)).size).toBe(25)
  expect(() => discoverBots(input, 'x'.repeat(301))).toThrow('300')
  expect(() => discoverBots(input, '', -1)).toThrow('offset')
  input.room.deleted = true
  expect(discoverBots(input).entries).toEqual([])
})
