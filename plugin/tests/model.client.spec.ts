import { expect, it, vi } from 'vitest'
import { BotModel } from '../src/client/model.ts'
it('keeps source snapshots stable and replaces authoritative state after reconnect', () => {
  const model = new BotModel(), notify = vi.fn()
  const detach = model.subscribe(notify), first = model.getSnapshot()
  expect(model.getSnapshot()).toBe(first)
  model.replace({ bots: [], rooms: [] })
  expect(model.getSnapshot().ready).toBe(true)
  expect(model.getSnapshot()).not.toBe(first)
  model.failed(new Error('Disconnected'))
  expect(model.getSnapshot().error).toBe('Disconnected')
  model.replace({ bots: [], rooms: [] })
  expect(model.getSnapshot().error).toBeNull()
  expect(notify).toHaveBeenCalledTimes(3)
  detach()
  model.failed('Stopped')
  expect(notify).toHaveBeenCalledTimes(3)
})
