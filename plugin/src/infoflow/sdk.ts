/** Optional SDK transport. Loading Bot Mode alone never resolves the private SDK. */
import { PermanentChatError } from '../external-errors.ts'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import type { Delivery } from './domain.ts'
import { decodeMessage, mentionedRobots, type Incoming } from './messages.ts'
import { receiveMedia, type InfoFlowMediaApi } from './media.ts'
import type { ChatAttachment, AttachmentData, UploadRequest } from '../types.ts'

/** SDK management results are validated before they become saved configuration. */
export interface RobotIdentity { agentId: number | string; imId?: number | string; name: string }
export interface GroupResult { groupId: number | string; failList?: string[]; failRobotIds?: number[] }
export interface RobotApi { identity(): Promise<RobotIdentity>; testMessage(user: string): Promise<void>; createGroup(options: Record<string, unknown>): Promise<GroupResult>; groupInfo?(id: string): Promise<{ groupId: string | number; masterUserId: string; agentIds: string[] }> }
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
    groupInfo: async id => {
      if (!client.im.group?.getGroupInfo || !client.im.group.getMembers) throw new Error('SDK group lookup unavailable')
      const [info, members] = await Promise.all([client.im.group.getGroupInfo(id), client.im.group.getMembers(id)])
      return { ...info, agentIds: members.filter(member => member.type === 'agent').map(member => String(member.agentId)) }
    },
    createGroup: async options => { if (!client.im.group) throw new Error('SDK group API unavailable'); return client.im.group.create(options) },
  }
}

/** Pinned SDK surface used by this adapter; unrelated SDK objects stay opaque. */
export interface Sdk {
  Client: new (options: Record<string, unknown>) => { im: { message: {
    sendToUser(user: string, text: unknown, type: string): Promise<unknown>
    sendToGroupWithOptions(options: Record<string, unknown>): Promise<unknown>
  }; file?: { upload(request: { file: Buffer; fileName: string; objectKey: string; expirationSeconds: number }): Promise<{ url: string }>; getBosFileUrl?(request: { objectKey: string; expirationSeconds: number }): Promise<{ url: string }> }; group?: { getMembers?(id: string): Promise<{ type?: string; agentId?: number }[]>; getGroupInfo?(id: string): Promise<{ groupId: string | number; masterUserId: string }>; create(options: Record<string, unknown>): Promise<GroupResult> } }; robot?: { getInfo(): Promise<RobotIdentity> } }
  WSClient: new (options: Record<string, unknown>) => {
    on(event: string, callback: (event: unknown) => void): unknown
    connect(): Promise<void>; disconnect(): void; eventDispatcher?: unknown
  }
}
/** Deployment options and resolved secrets, never persisted in the bridge domain. */
export interface TransportConfig {
  allowMedia?: (input: Incoming) => boolean
  upload?: (request: UploadRequest) => Promise<ChatAttachment>
  read?: (item: ChatAttachment) => Promise<AttachmentData>
  robotIds?: () => string[]
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
    for (const event of ['private.text', 'private.markdown', 'private.image', 'private.file', 'private.voice', 'group.text', 'group.markdown', 'group.mixed', 'group.image', 'group.file', 'group.voice']) {
      this.socket.on(event, (envelope) => {
        if (this.stopped) return
        const input = decodeMessage(event, envelope, config.accountId, config.robotId, config.robotIds?.())
        if (!input) return
        if (input.hasMedia && !config.allowMedia?.(input)) return
        const task = (async () => {
          const { hasMedia, ...message } = input
          if (hasMedia) message.media = { accountId: config.accountId }
          await receive(message, mentionedRobots(envelope))
        })().then(() => {}, () => { this.report('InfoFlow input or attachment could not be persisted; check media permissions and storage') })
        this.handlers.add(task)
        return task.finally(() => { this.handlers.delete(task) })
      })
    }
  }

  get accountId(): string { return this.config.accountId }

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

  async prepare(input: Incoming): Promise<Incoming> {
    if (!input.media) return input
    if (!this.config.upload) throw new PermanentChatError('Media upload provider unavailable')
    const result = await receiveMedia(this.client.im as unknown as InfoFlowMediaApi, { ...input, conversation: { ...input.conversation, accountId: input.media.accountId } }, this.config.upload)
    return { ...result, conversation: input.conversation }
  }

  /** Send one recorded chunk. A timeout is uncertain delivery and may duplicate on retry.
   * @param delivery - immutable recipient and content from the durable outbox.
   */
  async send(delivery: Delivery): Promise<void> {
    if (this.stopped) throw new Error('InfoFlow transport is stopping')
    if (delivery.attachment) {
      if (!this.client.im.file || !this.config.read) throw new PermanentChatError('Media delivery is unavailable')
      const data = await this.config.read(delivery.attachment)
      const { createHash } = await import('node:crypto')
      const inlineImage = delivery.attachment.type === 'image' && ['image/png', 'image/jpeg'].includes(data.mediaType) && Buffer.byteLength(data.base64, 'base64') < 1024 * 1024
      if (inlineImage) {
        if (delivery.conversation.kind === 'private') await this.client.im.message.sendToUser(delivery.conversation.id, { content: data.base64 }, 'image')
        else await this.client.im.message.sendToGroupWithOptions({ groupId: delivery.conversation.id, msgtype: 'IMAGE', body: [{ type: 'IMAGE', content: data.base64 }] })
      } else {
        const file = this.client.im.file, objectKey = `dsh-bot/${createHash('sha256').update(delivery.id).digest('hex')}`
        let uploaded: { url: string }
        try {
          uploaded = await file.upload({ file: Buffer.from(data.base64, 'base64'), fileName: data.name.replace(/[\r\n]/g, '_'), objectKey, expirationSeconds: 86400 })
        } catch (cause) {
          // Upload can commit before URL lookup or message delivery fails. Reuse this
          // immutable delivery's object; changing the key would leak another copy on every retry.
          const raw = (cause as { details?: { rawResponse?: { code?: unknown } } } | null)?.details?.rawResponse
          if (raw?.code !== 40900 || !file.getBosFileUrl) throw cause
          uploaded = await file.getBosFileUrl({ objectKey, expirationSeconds: 86400 })
        }
        const url = new URL(uploaded.url)
        // The official BOS gateway may return HTTP download links. BOS supports
        // the same signed path/query over TLS; never downgrade or upgrade other hosts.
        if (url.protocol === 'http:' && url.hostname.endsWith('.bcebos.com') && !url.port) url.protocol = 'https:'
        if (url.protocol !== 'https:' || url.username || url.password) throw new PermanentChatError('Invalid uploaded media URL')
        const label = `${data.name}（链接有效期 24 小时）`
        if (delivery.conversation.kind === 'private') await this.client.im.message.sendToUser(delivery.conversation.id, { content: [{ type: 'text', text: label }, { type: 'a', label: '下载', href: url.href }] }, 'richtext')
        else await this.client.im.message.sendToGroupWithOptions({ groupId: delivery.conversation.id, msgtype: 'TEXT', body: [{ type: 'TEXT', content: label }, { type: 'LINK', href: url.href }] })
      }
      return
    }
    const agents = (delivery.mentions ?? []).map(mention => Number(mention.id))
      .filter(id => Number.isSafeInteger(id) && id > 0 && String(id) !== this.config.accountId)
    // InfoFlow's Markdown renderer hides AT tokens. Native text renders clickable robot mentions.
    const groupType = agents.length ? 'TEXT' : 'MD'
    const sending = delivery.conversation.kind === 'private'
      ? this.client.im.message.sendToUser(delivery.conversation.id, delivery.text, 'md')
      : this.client.im.message.sendToGroupWithOptions({ groupId: delivery.conversation.id, msgtype: groupType,
        // MD messages accept only one AT block; separate human/robot blocks fail with 40067.
        body: [...(delivery.user || agents.length ? [{ type: 'AT', atall: false, atuserids: delivery.user ? [delivery.user] : [], ...(agents.length ? { atagentids: agents } : {}) }] : []),
          { type: groupType, content: delivery.text }] })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([sending, new Promise<never>((_, reject) => {
        timer = setTimeout(() => { reject(new Error('InfoFlow delivery confirmation timed out')) }, this.config.sendTimeoutMs)
        timer.unref()
      })])
    } catch (cause) {
      if (cause instanceof Error && /errcode:\s*(?:40068|40070)\b/.test(cause.message)) throw new PermanentChatError('InfoFlow rejected the recipient or message')
      throw cause
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
