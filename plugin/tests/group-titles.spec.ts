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
  await target.join!('group', '撤销后的进群事件')
  expect(ensure).toHaveBeenCalledTimes(1)
  allowed = true
  await target.join!('new', '新群')
  expect(ensure).toHaveBeenLastCalledWith({ conversation: { provider: 'feishu', accountId: 'app', kind: 'group', id: 'new' },
    title: '新群', botIds: ['sage'], defaultBot: 'sage' })
})

it.each(['success', 'failure'])('keeps an event name when an older API lookup finishes with %s', async outcome => {
  let resolve!: (value: string) => void, reject!: (cause: Error) => void
  const update = vi.fn(async () => {})
  const titles = new GroupTitles(() => new Promise<string>((yes, no) => { resolve = yes; reject = no }), 100,
    { groups: () => ['group'], update })
  const lookup = titles.get('group')
  await titles.observe('group', '新群名', { at: 200 })
  if (outcome === 'success') resolve('查询开始时的旧名'); else reject(new Error('permission denied'))
  expect(await lookup).toBe('新群名')
  expect(update).toHaveBeenCalledTimes(1)
  expect(update).toHaveBeenCalledWith('group', '新群名')
  await titles.close()
})

it('ignores older event replays and preserves an event name after metadata permission failures', async () => {
  vi.useFakeTimers()
  const lookup = vi.fn(async () => { throw new Error('denied') }), update = vi.fn(async () => {})
  const titles = new GroupTitles(lookup, 100, { groups: () => ['group'], update })
  await titles.observe('group', '新群名', { at: 200 })
  await titles.observe('group', '旧群名', { at: 100, joined: true })
  await titles.observe('group', '冲突重投', { at: 200 })
  await vi.advanceTimersByTimeAsync(60000)
  expect(await titles.get('group')).toBe('新群名')
  expect(update).toHaveBeenCalledTimes(1)
  expect(lookup).toHaveBeenCalledTimes(1)
  await titles.close()
})

it('keeps the join when a rename overtakes its queued write and drains admitted events on close', async () => {
  const join = vi.fn(async () => {}), update = vi.fn(async () => {})
  const titles = new GroupTitles(async () => '', 100, { groups: () => [], join, update })
  const first = titles.observe('group', '加入时', { at: 100, joined: true })
  const second = titles.observe('group', '改名后', { at: 200 })
  await titles.close(); await Promise.all([first, second])
  expect(join).toHaveBeenCalledExactlyOnceWith('group', '改名后')
  expect(update).not.toHaveBeenCalled()
})

it('serializes a rename behind an in-flight write so that the latest title wins', async () => {
  let release!: () => void, entered!: () => void
  const started = new Promise<void>(done => { entered = done })
  let saved = ''
  const update = vi.fn(async (_id: string, title: string) => {
    if (title === '旧群名') { entered(); await new Promise<void>(done => { release = done }) }
    saved = title
  })
  const titles = new GroupTitles(async () => '', 100, { groups: () => [], update })
  const first = titles.observe('group', '旧群名', { at: 100 }); await started
  const second = titles.observe('group', '新群名', { at: 200 }); release()
  await Promise.all([first, second]); expect(saved).toBe('新群名')
  await titles.close()
})
