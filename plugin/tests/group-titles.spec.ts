import { afterEach, expect, it, vi } from 'vitest'
import { GroupTitles, groupTitleTarget } from '../src/group-titles.ts'
import { brandString } from '@deepseek-ai/dsh-brand'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { BotState, BotId, RoomId, ExternalRoomRequest, Room } from '../src/types.ts'

afterEach(() => vi.useRealTimers())

it('backfills existing groups and follows renames without messages, preserving the title on lookup failure', async () => {
  vi.useFakeTimers()
  const update = vi.fn(async (_id: string, _title: string) => {})
  const lookup = vi.fn(async (_id: string) => '研发群')
  const titles = new GroupTitles(lookup, 100, { groups: () => ['group'], update })
  titles.start(); await titles.sync()
  expect(update).toHaveBeenLastCalledWith('group', '研发群')
  lookup.mockResolvedValue('研发二组')
  await vi.advanceTimersByTimeAsync(60000)
  expect(update).toHaveBeenLastCalledWith('group', '研发二组')
  lookup.mockRejectedValue(new Error('denied'))
  await vi.advanceTimersByTimeAsync(60000)
  expect(update).toHaveBeenCalledTimes(2)
  await titles.close(); await vi.advanceTimersByTimeAsync(120000)
  expect(lookup).toHaveBeenCalledTimes(3)
})

it('coalesces concurrent lookups and retries failed persistence on the next refresh', async () => {
  vi.useFakeTimers()
  const lookup = vi.fn(async () => '讨论群'), update = vi.fn(async () => {})
  update.mockRejectedValueOnce(new Error('disk full'))
  const titles = new GroupTitles(lookup, 100, { groups: () => ['group'], update })
  await Promise.all([titles.get('group'), titles.get('group')])
  expect(lookup).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(60000); await titles.sync()
  expect(update).toHaveBeenCalledTimes(2)
  await titles.close()
})

it('bounds stalled lookups and never applies a late result after shutdown', async () => {
  vi.useFakeTimers()
  let resolve!: (title: string) => void
  const lookup = vi.fn(() => new Promise<string>(done => { resolve = done })), update = vi.fn(async () => {})
  const titles = new GroupTitles(lookup, 100, { groups: () => ['group'], update })
  const result = titles.get('group')
  await vi.advanceTimersByTimeAsync(100)
  expect(await result).toBeUndefined()
  await titles.close(); resolve('late'); await Promise.resolve()
  expect(update).not.toHaveBeenCalled()
})

it('only updates currently allowed groups containing this robot and keeps group membership/default intact', async () => {
  const bot = brandString<BotId>('sage'), other = brandString<BotId>('other')
  const room: Room = { id: brandString<RoomId>('room'), kind: 'group', title: '旧群名', defaultBot: other, messages: [],
    members: [{ botId: bot, sessionId: SessionId('session'), cursor: 2 }, { botId: other, sessionId: SessionId('other'), cursor: 1 }],
    external: { provider: 'feishu', accountId: 'group:group', kind: 'group', id: 'group' } }
  const state: BotState = { bots: [], rooms: [room, { ...room, external: { ...room.external!, provider: 'infoflow' } }] }
  const ensure = vi.fn(async (_request: ExternalRoomRequest) => room)
  let allowed = true
  const target = groupTitleTarget({ snapshot: () => state, ensureExternalRoom: ensure }, 'feishu', 'app', [bot], () => allowed)
  expect(target.groups()).toEqual(['group'])
  await target.update('group', '新群名')
  expect(ensure).toHaveBeenCalledWith({ conversation: { provider: 'feishu', accountId: 'app', kind: 'group', id: 'group' },
    title: '新群名', botIds: [], defaultBot: 'other' })
  allowed = false
  await target.update('group', '撤销后'); expect(target.groups()).toEqual([])
  expect(ensure).toHaveBeenCalledTimes(1)
})
