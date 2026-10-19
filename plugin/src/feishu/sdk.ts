/** Pinned official Feishu SDK, with lifecycle and wire validation at this seam. */
import { createRequire } from 'node:module'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import type { Delivery } from '../infoflow/domain.ts'
import type { Incoming } from '../infoflow/messages.ts'
import type { Brand, FeishuBindingView } from './types.ts'
const logger = { error() {}, warn() {}, info() {}, debug() {}, trace() {} }
const domain = (brand: Brand) => brand === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn'
export interface RegistrationOptions {
  signal: AbortSignal; name: string
  qr(info: { url: string; expireIn: number }): void
}
export interface RegistrationResult { client_id: string; client_secret: string; user_info?: { open_id?: string; tenant_brand?: Brand } }
export interface Identity { openId: string; name: string }
interface Api { request(options: Record<string, unknown>): Promise<unknown> }
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
function checked(value: unknown): Record<string, unknown> {
  const result = object(value)
  if (result.code !== 0) throw new Error('飞书接口未成功，请检查机器人权限、发布状态和网络')
  return result
}
export async function identity(sdk: Sdk, appId: string, appSecret: string, brand: Brand, timeoutMs: number): Promise<Identity> {
  const client = new sdk.Client({ appId, appSecret, domain: domain(brand), logger })
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
  const client = new sdk.Client({ appId, appSecret, domain: domain(brand), logger })
  let response: unknown
  try { response = await client.request({ method: 'POST', url: '/open-apis/im/v1/chats', timeout: timeoutMs,
    params: { user_id_type: 'open_id', set_bot_manager: false, uuid: options.requestId },
    data: { name: options.title, owner_id: options.owner, user_id_list: [options.owner], bot_id_list: options.botAppIds,
      chat_mode: 'group', chat_type: 'private' } }) }
  catch (cause) {
    // The SDK rejects HTTP 4xx with an Axios response. Never expose its credential-bearing config.
    const error = object(cause), wire = object(error.response)
    if (typeof object(wire.data).code !== 'number') throw new Error('建群结果待确认，请使用同一请求继续，勿重复新建')
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
    addons: { preset: false, scopes: { tenant: ['im:message.p2p_msg:readonly', 'im:message.group_at_msg:readonly', 'im:message:send_as_bot', 'im:chat:create'] },
      events: { items: { tenant: ['im.message.receive_v1'] } } } })
}
export async function qrImage(url: string): Promise<string> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || !['feishu.cn', 'larksuite.com'].some(host => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`))) throw new Error('飞书返回了无法识别的授权地址')
  const require = createRequire(import.meta.url)
  const qr = require('qrcode') as { toDataURL(value: string, options: Record<string, unknown>): Promise<string> }
  return qr.toDataURL(url, { width: 280, margin: 2, errorCorrectionLevel: 'M' })
}
/** Text-only ingress, explicit human sender and exact bot mentions. */
export function decodeMessage(event: unknown, appId: string, botOpenId: string): Incoming | null {
  const body = object(event), sender = object(body.sender), msg = object(body.message)
  const senderId = text(object(sender.sender_id).open_id), messageId = text(msg.message_id), chatId = text(msg.chat_id)
  if (sender.sender_type !== 'user' || !senderId || senderId === botOpenId || !messageId || !chatId || msg.message_type !== 'text') return null
  if (msg.chat_type !== 'p2p' && msg.chat_type !== 'group') return null
  const mentions = Array.isArray(msg.mentions) ? msg.mentions.map(object) : []
  const ownMentions = mentions.filter(mention => object(mention.id).open_id === botOpenId)
  if (msg.chat_type === 'group' && !ownMentions.length) return null
  let content: string
  try { content = text(object(JSON.parse(text(msg.content))).text) } catch { return null }
  for (const mention of msg.chat_type === 'group' ? mentions : ownMentions) { const key = text(mention.key); if (key) content = content.split(key).join('') }
  content = content.trim()
  if (!content) return null
  return { conversation: { provider: 'feishu', accountId: appId, kind: msg.chat_type === 'p2p' ? 'private' : 'group', id: chatId },
    message: { id: messageId, sender: { id: senderId, name: senderId } }, text: content }
}
export class FeishuTransport {
  private readonly client: Api
  private readonly socket: InstanceType<Sdk['WSClient']>
  private stopped = false
  private connection: Promise<void> | undefined
  private readonly handlers = new Set<Promise<void>>()
  constructor(sdk: Sdk, private readonly config: { appId: string; appSecret: string; brand: Brand; botOpenId: string; timeoutMs: number }, receive: (input: Incoming) => Promise<unknown>,
    status: (status: FeishuBindingView['status']) => void, private readonly report: () => void) {
    const common = { appId: config.appId, appSecret: config.appSecret, domain: domain(config.brand), logger }
    this.client = new sdk.Client(common)
    this.socket = new sdk.WSClient({ ...common, handshakeTimeoutMs: config.timeoutMs,
      onReady: () => { if (!this.stopped) status('connected') }, onReconnected: () => { if (!this.stopped) status('connected') },
      onReconnecting: () => { if (!this.stopped) status('connecting') }, onError: () => { if (!this.stopped) status('error') } })
    const dispatcher = new sdk.EventDispatcher({ logger }).register({ 'im.message.receive_v1': async event => {
      if (this.stopped) return
      const input = decodeMessage(event, config.appId, config.botOpenId)
      if (!input) return
      const task = receive(input).then(() => {}, () => { this.report(); throw new Error('DSH could not persist this message') })
      this.handlers.add(task)
      try { await task } finally { this.handlers.delete(task) }
    } })
    this.begin = () => {
      this.connection = this.socket.start({ eventDispatcher: dispatcher }).catch(() => { if (!this.stopped) { status('error'); this.report() } })
        .finally(() => { if (this.stopped) this.socket.close({ force: true }) })
    }
  }
  private readonly begin: () => void
  start(): void { if (!this.stopped && !this.connection) this.begin() }
  async send(delivery: Delivery): Promise<void> {
    if (this.stopped) throw new Error('Feishu is stopping')
    const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
    const mentions = delivery.conversation.kind === 'group' ? (delivery.mentions ?? [])
      .filter(mention => /^ou_[\w-]+$/.test(mention.id) && mention.id !== this.config.botOpenId)
      .map(mention => `<at user_id="${mention.id}">${escape(mention.name)}</at>`).join(' ') : ''
    const content = mentions ? `${mentions}\n${delivery.text}` : delivery.text
    // Feishu honors uuid deduplication for a bounded window; retries retain it.
    checked(await this.client.request({ method: 'POST', url: '/open-apis/im/v1/messages', params: { receive_id_type: 'chat_id' }, timeout: this.config.timeoutMs,
      data: { receive_id: delivery.conversation.id, msg_type: 'text', content: JSON.stringify({ text: content }),
        uuid: createHash('sha256').update(delivery.id).digest('hex').slice(0, 48) } }))
  }
  async close(): Promise<void> { this.stopped = true; this.socket.close({ force: true }); await this.connection; await Promise.allSettled(this.handlers) }
}
