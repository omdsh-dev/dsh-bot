/** Queue storage outlives network connections, so disabled robots remain recoverable. */
import { CONNECTOR_PROTOCOL } from '../compatibility.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { Domain } from '@deepseek-ai/dsh-storage-domain'
import { BridgeArchive } from './archive.ts'
import { bridgeDomain } from './domain.ts'
import { InfoFlowBridge, type BridgeConfig, type BridgeStore } from './bridge.ts'

export class QueueRegistry {
  private domains = new Map<string, Promise<Domain<ReturnType<typeof bridgeDomain>>>>()
  private archives = new Map<string, BridgeArchive>()
  private mounting = new Map<string, { task: Promise<void>; done(): void }>()
  private closing = false
  private epochs = new Map<string, number>()
  private writes = new Map<string, Promise<unknown>>()
  private bridges = new Map<string, InfoFlowBridge>()
  private detach = new Map<string, () => void>()
  constructor(private readonly ctx: Context, private readonly provider: 'infoflow' | 'feishu') {}
  private serial<T>(name: string, action: () => Promise<T>): Promise<T> {
    const operation = (this.writes.get(name) ?? Promise.resolve()).then(action)
    this.writes.set(name, operation.catch(() => {})); return operation
  }
  async open(name: string): Promise<{ global: BridgeStore }> {
    if (this.closing) throw new Error('Queue registry is closing')
    while (this.mounting.has(name)) await this.mounting.get(name)!.task
    if (this.closing) throw new Error('Queue registry is closing')
    let done!: () => void
    const task = new Promise<void>(resolve => { done = resolve })
    this.mounting.set(name, { task, done })
    try {
      await this.bridges.get(name)?.close()
      let pending = this.domains.get(name)
      if (!pending) {
        pending = this.ctx.storageDomain.open(bridgeDomain(name))
        this.domains.set(name, pending)
        void pending.catch(() => this.domains.delete(name))
      }
      const domain = await pending
      let archive = this.archives.get(name)
      if (!archive) { archive = await BridgeArchive.load(domain.global, spec => this.ctx.storageDomain.open(spec)); this.archives.set(name, archive) }
      const store = archive
      const epoch = await this.serial(name, async () => { const value = (this.epochs.get(name) ?? 0) + 1; this.epochs.set(name, value); return value })
      return { global: { get: () => store.get(), set: state => this.serial(name, async () => {
        if (this.epochs.get(name) !== epoch) throw new Error('Queue reconnected; refresh before retrying this action')
        await store.set(state)
      }) } }
    } catch (cause) { this.cancel(name); throw cause }
  }
  cancel(name: string): void { this.mounting.get(name)?.done(); this.mounting.delete(name) }
  bind(id: string, name: string, bridge: InfoFlowBridge): void {
    this.detach.get(name)?.()
    this.bridges.set(name, bridge)
    this.detach.set(name, this.ctx.botMode.attachQueue(this.provider, id, bridge, CONNECTOR_PROTOCOL))
  }
  async offline(id: string, name: string, config: BridgeConfig): Promise<void> {
    if (this.bridges.has(name) || this.mounting.has(name)) return
    const domain = await this.open(name)
    try {
      const bridge = new InfoFlowBridge(this.ctx.botMode, domain.global, { send: async () => { throw new Error('Robot is disabled') } }, config, () => {})
      await bridge.close()
      this.bind(id, name, bridge)
    } finally { this.cancel(name) }
  }
  async close(): Promise<void> {
    this.closing = true
    await Promise.all([...this.mounting.values()].map(mount => mount.task))
    for (const detach of this.detach.values()) detach()
    for (const bridge of this.bridges.values()) await bridge.close()
    await Promise.all(this.writes.values())
    for (const domain of this.domains.values()) await (await domain).close()
  }
}
