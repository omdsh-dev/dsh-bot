import { expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { QueueRegistry } from '../src/infoflow/queues.ts'
import type { InfoFlowBridge } from '../src/infoflow/bridge.ts'
import type { BridgeState } from '../src/infoflow/domain.ts'

it('serializes concurrent mounts and rejects stale recovery writes after reconnect', async () => {
  let state: BridgeState = { receipts: [], notices: [], pending: [], outbox: [] }
  const close = vi.fn(async () => {}), detach = vi.fn(), bridgeClose = vi.fn(async () => {})
  const open = vi.fn(async () => ({ global: { get: () => state, set: async (next: BridgeState) => { state = next } }, close }))
  const queues = new QueueRegistry({ storageDomain: { open }, botMode: { attachQueue: () => detach } } as unknown as Context, 'feishu')
  const first = queues.open('queue')
  let mounted = false
  const second = queues.open('queue').then(value => { mounted = true; return value })
  const old = await first
  expect(mounted).toBe(false)
  await old.global.set({ ...state, receipts: ['accepted'] })
  queues.bind('bot', 'queue', { close: bridgeClose } as unknown as InfoFlowBridge)
  queues.cancel('queue')
  const current = await second
  expect(bridgeClose).toHaveBeenCalledOnce()
  expect(current.global.get().receipts).toEqual(['accepted'])
  await expect(old.global.set({ ...state, receipts: ['stale'] })).rejects.toThrow('reconnected')
  expect(current.global.get().receipts).toEqual(['accepted'])
  queues.cancel('queue')
  await queues.close()
  expect(open).toHaveBeenCalledOnce()
  expect(close).toHaveBeenCalledOnce()
  expect(detach).toHaveBeenCalledOnce()
  await expect(queues.open('queue')).rejects.toThrow('closing')
})
