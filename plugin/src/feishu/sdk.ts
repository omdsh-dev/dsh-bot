/** Pinned official Feishu SDK, with lifecycle and wire validation at this seam. */
import { createRequire } from 'node:module'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { PermanentChatError } from '../external-errors.ts'
import type { Delivery } from '../infoflow/domain.ts'
import type { Incoming } from '../infoflow/messages.ts'
import type { Brand, FeishuBindingView } from './types.ts'
import type { ChatAttachment, AttachmentData, UploadRequest } from '../types.ts'
import { imageMime } from '../media.ts'
import { GroupTitles, type GroupTitleTarget } from '../group-titles.ts'
const logger = { error() {}, warn() {}, info() {}, debug() {}, trace() {} }
const domain = (brand: Brand) => brand === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn'
export interface RegistrationOptions {
  signal: AbortSignal; name: string
  qr(info: { url: string; expireIn: number }): void
}
export interface RegistrationResult { client_id: string; client_secret: string; user_info?: { open_id?: string; tenant_brand?: Brand } }
export interface Identity { openId: string; name: string }
interface Api { request(options: Record<string, unknown>): Promise<unknown>
  im?: { image?: { create(payload: { data: { image_type: 'message'; image: Buffer } }): Promise<unknown> }; file?: { create(payload: { data: { file_type: 'stream'; file_name: string; file: Buffer } }): Promise<unknown> }; messageResource: { get(payload: { params: { type: string }; path: { message_id: string; file_key: string } }): Promise<{ getReadableStream(): AsyncIterable<Uint8Array> }> } }
}
export interface Sdk {
  defaultHttpInstance?: { defaults: { timeout: number } }
  Client: new (options: Record<string, unknown>) => Api
  WSClient: new (options: Record<string, unknown>) => { start(options: { eventDispatcher: unknown }): Promise<void>; close(options?: { force?: boolean }): void }
  EventDispatcher: new (options: Record<string, unknown>) => { register(handlers: Record<string, (event: unknown) => Promise<void>>): unknown }
  registerApp(options: Record<string, unknown>): Promise<RegistrationResult>
}
export function loadSdk(timeoutMs: number): Sdk {
  const require = createRequire(import.meta.url)
  const metadata: unknown = require('@larksuiteoapi/node-sdk/package.json')
  if (typeof metadata !== 'object' || !metadata || !('version' in metadata) || metadata.version !== '1.75.0') throw new Error('Install @larksuiteoapi/node-sdk@1.75.0 in the Feishu companion')
  const sdk: unknown = require('@larksuiteoapi/node-sdk')
  if (typeof sdk !== 'object' || !sdk || !('registerApp' in sdk) || typeof sdk.registerApp !== 'function') throw new Error('Feishu SDK registration support is missing')
  const loaded = sdk as Sdk
  // Registration and token refresh use the SDK's shared HTTP client, not request-level options.
  if (!loaded.defaultHttpInstance) throw new Error('Feishu SDK HTTP client is missing')
  loaded.defaultHttpInstance.defaults.timeout = timeoutMs
  return loaded
}
// The official dispatcher adds Symbol('event-type'); validate object fields without rejecting SDK metadata.
const record = z.looseObject({})
function object(value: unknown): Record<string, unknown> { return record.safeParse(value).data ?? {} }
function text(value: unknown): string { return typeof value === 'string' ? value : '' }
const permanentCodes = [99991672, 230002, 230003, 230006, 230013]
/** Axios rejects non-2xx responses before the SDK returns a business envelope. */
function transportError(cause: unknown): never {
  const response = object(object(cause).response), status = Number(response.status)
  if (status >= 400 && status < 500 && status !== 429 && permanentCodes.includes(Number(object(response.data).code))) {
    throw new PermanentChatError('飞书拒绝了请求，请检查应用权限（附件需要 im:resource）、发布状态和群成员')
  }
  throw cause
}
function checked(value: unknown): Record<string, unknown> {
  const result = object(value)
  // Documented authorization/recipient errors; unknown codes keep bounded retries.
  if (permanentCodes.includes(Number(result.code))) throw new PermanentChatError('飞书接口未成功，请检查机器人权限、发布状态和群成员')
  if (result.code !== 0) throw new Error('飞书接口未成功，请检查机器人权限、发布状态和网络')
  return result
}
/** Token caches must never cross credentials, even for the same app ID. */
function tokenCache() {
  const entries = new Map<string | symbol, { value: unknown; expires?: number | undefined }>()
  const keyFor = (key: string | symbol, options?: { namespace?: string }) => options?.namespace ? `${options.namespace}/${String(key)}` : key
  return {
    async get(key: string | symbol, options?: { namespace?: string }) {
      const entry = entries.get(keyFor(key, options))
      return entry && (!entry.expires || entry.expires > Date.now()) ? entry.value : undefined
    },
    async set(key: string | symbol, value: unknown, expires?: number, options?: { namespace?: string }) {
      entries.set(keyFor(key, options), { value, expires }); return true
    },
  }
}
export async function identity(sdk: Sdk, appId: string, appSecret: string, brand: Brand, timeoutMs: number): Promise<Identity> {
  const client = new sdk.Client({ appId, appSecret, domain: domain(brand), logger, cache: tokenCache() })
  const result = checked(await client.request({ method: 'GET', url: '/open-apis/bot/v3/info', timeout: timeoutMs }))
  const bot = object(result.bot ?? object(result.data).bot)
  const openId = text(bot.open_id), name = text(bot.app_name)
  if (!/^ou_[\w-]+$/.test(openId)) throw new Error('未查询到应用机器人，请在飞书启用机器人能力并发布应用')
  return { openId, name: name || appId }
}
/** Safe, classified errors let the manager distinguish API rejection from an unknown outcome. */
export class GroupCreateError extends Error {}
export interface GroupOptions { requestId: string; title: string; owner: string; botAppIds: string[] }
/** Create a private group; Feishu deduplicates the same uuid + owner for ten hours. */
export async function createGroup(sdk: Sdk, appId: string, appSecret: string, brand: Brand, timeoutMs: number, options: GroupOptions): Promise<string> {
  const client = new sdk.Client({ appId, appSecret, domain: domain(brand), logger, cache: tokenCache() })
  let response: unknown
  try { response = await client.request({ method: 'POST', url: '/open-apis/im/v1/chats', timeout: timeoutMs,
    params: { user_id_type: 'open_id', set_bot_manager: false, uuid: options.requestId },
    data: { name: options.title, owner_id: options.owner, user_id_list: [options.owner], bot_id_list: options.botAppIds,
      chat_mode: 'group', chat_type: 'private' } }) }
  catch (cause) {
    // The SDK rejects HTTP 4xx with an Axios response. Never expose its credential-bearing config.
    const error = object(cause), wire = object(error.response)
    if (typeof wire.status !== 'number' || wire.status < 400 || wire.status >= 500 || wire.status === 429 || wire.status === 408
      || typeof object(wire.data).code !== 'number') throw new Error('建群结果待确认，请使用同一请求继续，勿重复新建')
    response = wire.data
  }
  const result = object(response)
  if (typeof result.code === 'number' && result.code !== 0) {
    if (result.code === 99991672) throw new GroupCreateError('建群机器人缺少 im:chat:create 权限，请在飞书开放平台开通后继续')
    throw new GroupCreateError(`飞书拒绝建群（错误码 ${result.code}），请检查群主、机器人是否在同一企业及应用可用范围`)
  }
  const chatId = text(object(result.data).chat_id)
  if (result.code !== 0 || !/^oc_[\w-]+$/.test(chatId)) throw new Error('未取得群 ID，请使用同一请求继续，勿重复新建')
  return chatId
}
/** Official user-confirmed registration with messaging and group-creation permissions. */
export function register(sdk: Sdk, options: RegistrationOptions): Promise<RegistrationResult> {
  return sdk.registerApp({ signal: options.signal, source: 'dsh-bot', createOnly: true, onQRCodeReady: options.qr,
    appPreset: { name: options.name, desc: 'DSH Bot 独立 AI 助手' },
    addons: { preset: false, scopes: { tenant: ['im:message.p2p_msg:readonly', 'im:message.group_at_msg:readonly', 'im:message:send_as_bot', 'im:chat:create', 'im:resource', 'im:chat:read', 'im:chat.members:bot_access'] },
      events: { items: { tenant: ['im.message.receive_v1', 'im.chat.member.bot.added_v1', 'im.chat.updated_v1'] } } } })
}
export async function qrImage(url: string): Promise<string> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || !['feishu.cn', 'larksuite.com'].some(host => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))) throw new Error('飞书返回了无法识别的授权地址')
  const require = createRequire(import.meta.url)
  const qr = require('qrcode') as { toDataURL(value: string, options: Record<string, unknown>): Promise<string> }
  return qr.toDataURL(url, { width: 280, margin: 2, errorCorrectionLevel: 'M' })
}
/** Text and media ingress, explicit human sender and exact bot mentions. */
interface MediaResource { key: string; type: 'image' | 'file' | 'audio'; name: string }
interface FeishuIncoming extends Incoming { resources?: MediaResource[] }
export function decodeMessage(event: unknown, appId: string, botOpenId: string): FeishuIncoming | null {
  const body = object(event), sender = object(body.sender), msg = object(body.message)
  const senderId = text(object(sender.sender_id).open_id), messageId = text(msg.message_id), chatId = text(msg.chat_id)
  if (sender.sender_type !== 'user' || !senderId || senderId === botOpenId || !messageId || !chatId || !['text', 'post', 'image', 'file', 'audio'].includes(text(msg.message_type))) return null
  if (msg.chat_type !== 'p2p' && msg.chat_type !== 'group') return null
  const mentions = Array.isArray(msg.mentions) ? msg.mentions.map(object) : []
  const ownMentions = mentions.filter(mention => object(mention.id).open_id === botOpenId)
  if (msg.chat_type === 'group' && !ownMentions.length) return null
  let content: string, payload: Record<string, unknown>
  try { payload = object(JSON.parse(text(msg.content))); content = text(payload.text) } catch { return null }
  const resources: MediaResource[] = []
  if (msg.message_type === 'image') resources.push({ key: text(payload.image_key), type: 'image', name: 'image' })
  if (msg.message_type === 'file' || msg.message_type === 'audio') resources.push({ key: text(payload.file_key), type: msg.message_type, name: text(payload.file_name) || text(msg.message_type) })
  if (msg.message_type === 'post') {
    const post = Array.isArray(payload.content) ? payload : Object.values(payload).map(object).find(value => Array.isArray(value.content))
    if (post) {
      const blocks = (post.content as unknown[]).flatMap(row => Array.isArray(row) ? row.map(object) : [])
      content = [text(post.title), ...blocks.filter(block => block.tag === 'text' || block.tag === 'a').map(block => text(block.text))].join('\n')
      for (const block of blocks) if (block.tag === 'img') resources.push({ key: text(block.image_key), type: 'image', name: 'image' })
    }
  }
  for (const mention of msg.chat_type === 'group' ? mentions : ownMentions) { const key = text(mention.key); if (key) content = content.split(key).join('') }
  content = content.trim()
  if (!content && !resources.length || resources.length > 8 || resources.some(resource => !resource.key || resource.key.length > 512)) return null
  return { conversation: { provider: 'feishu', accountId: appId, kind: msg.chat_type === 'p2p' ? 'private' : 'group', id: chatId },
    message: { id: messageId, sender: { id: senderId, name: senderId } }, text: content || '[附件]', ...(resources.length ? { resources } : {}) }
}
export class FeishuTransport {
  private readonly client: Api
  private readonly titles: GroupTitles
  private readonly socket: InstanceType<Sdk['WSClient']>
  private stopped = false
  private connection: Promise<void> | undefined
  private readonly handlers = new Set<Promise<void>>()
  constructor(sdk: Sdk, private readonly config: { appId: string; appSecret: string; brand: Brand; botOpenId: string; timeoutMs: number; groupTitles?: GroupTitleTarget; groupNameStatus?: (status: NonNullable<FeishuBindingView['groupNameStatus']>) => void; allowUsers?: string[]; allowGroups?: string[]; allowAllGroups?: boolean | undefined }, receive: (input: Incoming) => Promise<unknown>,
    status: (status: FeishuBindingView['status']) => void, private readonly report: () => void, private readonly upload?: (request: UploadRequest) => Promise<ChatAttachment>, private readonly read?: (item: ChatAttachment) => Promise<AttachmentData>) {
    const common = { appId: config.appId, appSecret: config.appSecret, domain: domain(config.brand), logger, cache: tokenCache() }
    this.client = new sdk.Client(common)
    this.titles = new GroupTitles(async id => {
      try {
        const result = object(await this.client.request({ method: 'GET', url: `/open-apis/im/v1/chats/${encodeURIComponent(id)}`, timeout: Math.min(config.timeoutMs, 3000) }))
        if (result.code !== 0) throw { code: result.code }
        const title = text(object(result.data).name).trim()
        if (!title || title.length > 1000) throw new Error('Missing group name')
        if (!this.stopped) config.groupNameStatus?.('available')
        return title
      } catch (cause) {
        const response = object(object(cause).response), httpStatus = Number(response.status)
        const code = Number(object(cause).code ?? object(response.data).code)
        const denied = code === 99991672 && (!Number.isFinite(httpStatus) || httpStatus >= 400 && httpStatus < 500 && httpStatus !== 429)
        if (!this.stopped) config.groupNameStatus?.(denied ? 'permission-required' : 'unavailable')
        throw new Error('Group metadata unavailable')
      }
    }, Math.min(config.timeoutMs, 3000), config.groupTitles, report)
    this.socket = new sdk.WSClient({ ...common, handshakeTimeoutMs: config.timeoutMs,
      onReady: () => { if (!this.stopped) status('connected') }, onReconnected: () => { if (!this.stopped) status('connected') },
      onReconnecting: () => { if (!this.stopped) status('connecting') }, onError: () => { if (!this.stopped) status('error') } })
    const groupEvent = async (event: unknown, joined: boolean) => {
      if (this.stopped) return
      const body = object(event), id = text(body.chat_id)
      if (body.app_id !== undefined && body.app_id !== config.appId || !/^oc_[\w-]{1,128}$/.test(id)
        || config.allowGroups && !config.allowAllGroups && !config.allowGroups.includes(id)) return
      const time = Number(body.create_time)
      const task = this.titles.observe(id, joined ? body.name : object(body.after_change).name,
        { joined, at: Number.isSafeInteger(time) && time > 0 ? time : undefined })
        .catch(() => { this.report(); throw new Error('DSH could not persist the group name; retry this event') })
      this.handlers.add(task)
      try { await task } finally { this.handlers.delete(task) }
    }
    const dispatcher = new sdk.EventDispatcher({ logger }).register({
      'im.chat.member.bot.added_v1': event => groupEvent(event, true),
      'im.chat.updated_v1': event => groupEvent(event, false),
      'im.message.receive_v1': async event => {
      if (this.stopped) return
      const input = decodeMessage(event, config.appId, config.botOpenId)
      if (!input) return
      if (input.conversation.kind === 'private' ? config.allowUsers && !config.allowUsers.includes(input.message.sender.id)
        : config.allowGroups && !config.allowAllGroups && !config.allowGroups.includes(input.conversation.id)) return
      const task = (async () => {
        const { resources, ...message } = input
        if (message.conversation.kind === 'group') {
          const title = await this.titles.get(message.conversation.id)
          if (title) message.groupTitle = title
        }
        if (resources?.length) message.media = { accountId: config.appId, resources }
        await receive(message)
      })().then(() => {}, () => { this.report(); throw new Error('DSH could not persist this message or attachment; check media permissions and providers') })
      this.handlers.add(task)
      try { await task } finally { this.handlers.delete(task) }
    } })
    this.begin = () => {
      this.connection = this.socket.start({ eventDispatcher: dispatcher }).catch(() => { if (!this.stopped) { status('error'); this.report() } })
        .finally(() => { if (this.stopped) this.socket.close({ force: true }) })
    }
  }
  private readonly begin: () => void
  start(): void { if (!this.stopped && !this.connection) { this.begin(); this.titles.start() } }
  async prepare(input: Incoming): Promise<Incoming> {
    try { return await this.prepareOnce(input) } catch (cause) { return transportError(cause) }
  }
  private async prepareOnce(input: Incoming): Promise<Incoming> {
    if (!input.media) return input
    if (!this.upload || !this.client.im) throw new Error('Native media support is unavailable')
    const attachments: ChatAttachment[] = []; let total = 0
    for (const resource of input.media.resources ?? []) {
      const response = await this.client.im.messageResource.get({ params: { type: resource.type === 'image' ? 'image' : 'file' }, path: { message_id: input.message.id, file_key: resource.key } })
      const chunks: Buffer[] = []
      for await (const chunk of response.getReadableStream()) {
        total += chunk.byteLength; if (total > 20 * 1024 * 1024) throw new PermanentChatError('Media exceeds 20 MiB')
        chunks.push(Buffer.from(chunk))
      }
      const bytes = Buffer.concat(chunks)
      attachments.push(await this.upload({ name: resource.name, base64: bytes.toString('base64'), mediaType: imageMime(bytes) ?? 'application/octet-stream', transcribe: resource.type === 'audio' }))
    }
    return { ...input, attachments }
  }
  async send(delivery: Delivery): Promise<void> {
    try { await this.sendOnce(delivery) } catch (cause) { transportError(cause) }
  }
  private async sendOnce(delivery: Delivery): Promise<void> {
    if (this.stopped) throw new Error('Feishu is stopping')
    const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
    const mentions = delivery.conversation.kind === 'group' ? (delivery.mentions ?? [])
      .filter(mention => /^ou_[\w-]+$/.test(mention.id) && mention.id !== this.config.botOpenId)
      .map(mention => `<at user_id="${mention.id}">${escape(mention.name)}</at>`).join(' ') : ''
    const content = mentions ? `${mentions}\n${escape(delivery.text)}` : escape(delivery.text)
    let msgType = 'text', body: Record<string, string> = { text: content }
    if (delivery.attachment) {
      if (!this.read) throw new PermanentChatError('Attachment reader unavailable')
      const item = delivery.attachment, data = await this.read(item)
      const dimensionLimit = data.mediaType === 'image/gif' ? 2000 : 12000
      const asImage = item.type === 'image' && item.attachment.bytes <= 10000000
        && (item.attachment.width ?? 0) <= dimensionLimit && (item.attachment.height ?? 0) <= dimensionLimit
      if (!item.attachment.bytes) throw new PermanentChatError('Feishu does not accept empty files')
      const response = asImage
        ? await this.client.im?.image?.create({ data: { image_type: 'message', image: Buffer.from(data.base64, 'base64') } })
        : await this.client.im?.file?.create({ data: { file_type: 'stream', file_name: data.name, file: Buffer.from(data.base64, 'base64') } })
      const raw = object(response), result = raw.code === undefined ? raw : object(checked(raw).data), key = text(result[asImage ? 'image_key' : 'file_key'])
      if (!key) throw new Error('Feishu did not return an uploaded resource key')
      msgType = asImage ? 'image' : 'file'; body = { [asImage ? 'image_key' : 'file_key']: key }
    }
    // Feishu honors uuid deduplication for a bounded window; retries retain it.
    checked(await this.client.request({ method: 'POST', url: '/open-apis/im/v1/messages', params: { receive_id_type: 'chat_id' }, timeout: this.config.timeoutMs,
      data: { receive_id: delivery.conversation.id, msg_type: msgType, content: JSON.stringify(body),
        uuid: createHash('sha256').update(delivery.id).digest('hex').slice(0, 48) } }))
  }
  async close(): Promise<void> { this.stopped = true; this.socket.close({ force: true }); await this.titles.close(); await this.connection; await Promise.allSettled(this.handlers) }
}
