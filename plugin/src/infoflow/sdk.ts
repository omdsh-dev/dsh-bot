/** Optional SDK transport. Loading Bot Mode alone never resolves the private SDK. */
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import type { Delivery } from './domain.ts'
import { decodeMessage, mentionedRobots, type Incoming } from './messages.ts'

/** SDK management results are validated before they become saved configuration. */
export interface RobotIdentity { agentId: number | string; imId?: number | string; name: string }
export interface GroupResult { groupId: number | string; failList?: string[]; failRobotIds?: number[] }
export interface RobotApi { identity(): Promise<RobotIdentity>; testMessage(user: string): Promise<void>; createGroup(options: Record<string, unknown>): Promise<GroupResult> }
/** Suppress SDK payload/credential logging; the owner reports operation categories only. */
const logger = { error() {}, warn() {}, info() {}, debug() {}, trace() {} }
/** Read identity or create a user-requested group through the installed SDK. */
export function robotApi(sdk: Sdk, config: { appKey: string; appSecret: string; agentId: string; timeout: number; baseUrl?: string }): RobotApi {
  const client = new sdk.Client({ ...config, logger })
  return {
    identity: async () => { if (!client.robot) throw new Error('SDK robot API unavailable'); return client.robot.getInfo() },
    testMessage: async user => {
      try { await client.im.message.sendToUser(user, 'DSH 如流连接测试：消息发送成功。请回复“连接测试”，确认机器人能够接收并回答。', 'text') }
      catch (cause) {
        // The pinned SDK embeds business codes in its error message; never return the raw message or response.
        if (cause instanceof Error && /errcode:\s*40070\b/.test(cause.message)) throw new Error('接收者不在可见范围或未关注机器人（40070）。请在如流开放平台 → 可见范围中加入该账号，并关注机器人后重试。')
        throw new Error('测试消息未确认送达，请检查网络、消息发送权限及可见范围；请先查看如流再重试，避免重复消息。')
      }
    },
    createGroup: async options => { if (!client.im.group) throw new Error('SDK group API unavailable'); return client.im.group.create(options) },
  }
}

/** Pinned SDK surface used by this adapter; unrelated SDK objects stay opaque. */
export interface Sdk {
  Client: new (options: Record<string, unknown>) => { im: { message: {
    sendToUser(user: string, text: string, type: string): Promise<unknown>
    sendToGroupWithOptions(options: Record<string, unknown>): Promise<unknown>
  }; group?: { create(options: Record<string, unknown>): Promise<GroupResult> } }; robot?: { getInfo(): Promise<RobotIdentity> } }
  WSClient: new (options: Record<string, unknown>) => {
    on(event: string, callback: (event: unknown) => void): unknown
    connect(): Promise<void>; disconnect(): void; eventDispatcher?: unknown
  }
}
/** Deployment options and resolved secrets, never persisted in the bridge domain. */
export interface TransportConfig {
  accountId: string; robotId: string; appKey: string; appSecret: string
  baseUrl: string; wsGateway: string; wsConnectDomain: string
  endpointTimeoutMs: number; sendTimeoutMs: number; connectRetryMs: number; maxConnectRetryMs: number
}

/** Resolve the companion's installed SDK and refuse an unreviewed wire version.
 * @returns the pinned SDK constructor exports.
 */
export function loadSdk(): Sdk {
  const require = createRequire(import.meta.url)
  try {
    const metadata: unknown = require('@baidu/infoflow-sdk-nodejs/package.json')
    if (typeof metadata !== 'object' || metadata === null || !('version' in metadata) || metadata.version !== '2026.8.28') throw new Error('Unsupported SDK version')
    const sdk: unknown = require('@baidu/infoflow-sdk-nodejs')
    if (typeof sdk !== 'object' || sdk === null || !('Client' in sdk) || typeof sdk.Client !== 'function'
      || !('WSClient' in sdk) || typeof sdk.WSClient !== 'function') throw new Error('Invalid SDK exports')
    // The pinned package owns these constructors; the external export check precedes narrowing.
    return sdk as Sdk
  } catch { throw new Error('Install @baidu/infoflow-sdk-nodejs@2026.8.28 from your authorized registry in the InfoFlow companion package before enabling it') }
}

/** SDK lifecycle plus exact private/group formatting. */
export class InfoFlowTransport {
  private readonly client: InstanceType<Sdk['Client']>
  private readonly socket: InstanceType<Sdk['WSClient']>
  private stopped = false
  private connection: Promise<void> | undefined
  private retry: ReturnType<typeof setTimeout> | undefined
  private attempt = 0
  private readonly handlers = new Set<Promise<void>>()
  private readonly errorGuard = () => {}
  /** @param sdk - installed constructors (or the test transport).
   * @param config - resolved configuration. @param receive - durable ingress handler.
   * @param report - reports operation categories without credentials or payloads.
   */
  constructor(sdk: Sdk, private readonly config: TransportConfig, receive: (input: Incoming, mentions: string[]) => Promise<unknown>, private readonly report: (message: string) => void, private readonly status: (value: 'connecting' | 'connected' | 'error') => void = () => {}) {
    const options = { appKey: config.appKey, appSecret: config.appSecret, logger, timeout: config.sendTimeoutMs,
      ...(config.baseUrl ? { baseUrl: config.baseUrl } : {}) }
    this.client = new sdk.Client({ ...options, agentId: config.accountId })
    this.socket = new sdk.WSClient({ ...options, endpointTimeout: config.endpointTimeoutMs,
      ...(config.wsGateway ? { wsGateway: config.wsGateway } : {}), ...(config.wsConnectDomain ? { wsConnectDomain: config.wsConnectDomain } : {}) })
    // This SDK also emits through EventEmitter after its own async error dispatch.
    if (this.socket.eventDispatcher instanceof EventEmitter) this.socket.eventDispatcher.on('error', this.errorGuard)
    this.socket.on('error', () => { if (!this.stopped) { status('error'); this.report('InfoFlow connection error; SDK reconnect is active') } })
    this.socket.on('disconnected', () => { if (!this.stopped) status('connecting') })
    this.socket.on('connected', () => { status('connected'); this.attempt = 0; if (this.retry) clearTimeout(this.retry); this.retry = undefined })
    for (const event of ['private.text', 'private.markdown', 'group.text', 'group.markdown', 'group.mixed']) {
      this.socket.on(event, (envelope) => {
        if (this.stopped) return
        const input = decodeMessage(event, envelope, config.accountId, config.robotId)
        if (!input) return
        const task = receive(input, mentionedRobots(envelope)).then(() => {}, () => { this.report('InfoFlow input could not be persisted; the sender has not received an acceptance receipt') })
        this.handlers.add(task)
        return task.finally(() => { this.handlers.delete(task) })
      })
    }
  }

  /** Connect without blocking Host startup; initial failures use bounded exponential backoff. */
  start(): void {
    if (this.stopped || this.connection) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const connecting = Promise.resolve().then(() => { if (!this.stopped) return this.socket.connect() })
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        this.socket.disconnect()
        reject(new Error('InfoFlow connection timed out'))
      }, this.config.endpointTimeoutMs)
      timer.unref()
    })
    this.connection = Promise.race([connecting, deadline]).catch(() => {
      if (this.stopped) return
      this.status('error')
      this.report('InfoFlow initial connection failed; retry scheduled')
      const delay = Math.min(this.config.maxConnectRetryMs, this.config.connectRetryMs * 2 ** Math.min(this.attempt++, 20))
      this.retry = setTimeout(() => { this.retry = undefined; this.start() }, delay)
      this.retry.unref()
    }).finally(() => { if (timer) clearTimeout(timer); this.connection = undefined; if (this.stopped) this.socket.disconnect() })
  }

  /** Send one recorded chunk. A timeout is uncertain delivery and may duplicate on retry.
   * @param delivery - immutable recipient and content from the durable outbox.
   */
  async send(delivery: Delivery): Promise<void> {
    if (this.stopped) throw new Error('InfoFlow transport is stopping')
    const agents = (delivery.mentions ?? []).map(mention => Number(mention.id))
      .filter(id => Number.isSafeInteger(id) && id > 0 && String(id) !== this.config.accountId)
    // InfoFlow's Markdown renderer hides AT tokens. Native text renders clickable robot mentions.
    const groupType = agents.length ? 'TEXT' : 'MD'
    const sending = delivery.conversation.kind === 'private'
      ? this.client.im.message.sendToUser(delivery.conversation.id, delivery.text, 'md')
      : this.client.im.message.sendToGroupWithOptions({ groupId: delivery.conversation.id, msgtype: groupType,
        // MD messages accept only one AT block; separate human/robot blocks fail with 40067.
        body: [{ type: 'AT', atall: false, atuserids: [delivery.user], ...(agents.length ? { atagentids: agents } : {}) },
          { type: groupType, content: delivery.text }] })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([sending, new Promise<never>((_, reject) => {
        timer = setTimeout(() => { reject(new Error('InfoFlow delivery confirmation timed out')) }, this.config.sendTimeoutMs)
        timer.unref()
      })])
    } finally { if (timer) clearTimeout(timer) }
  }

  /** Disconnect, stop initial retries, and drain admitted callbacks. */
  async close(): Promise<void> {
    this.stopped = true
    if (this.retry) clearTimeout(this.retry)
    this.socket.disconnect()
    await this.connection
    await Promise.allSettled(this.handlers)
    // Keep the no-op error guard: the SDK may emit a final close error asynchronously.
  }
}
