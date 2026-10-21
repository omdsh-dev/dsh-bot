/** Decode the SDK's external wire payloads without coercing unsafe numeric IDs. */
import { z } from 'zod'
import type { BotId, ExternalConversation, ExternalMessage, ChatAttachment } from '../types.ts'

/** Normalized text event; the SDK connection supplies the trusted account identity. */
export interface Incoming { conversation: ExternalConversation; message: ExternalMessage; text: string; targets?: BotId[] | undefined; attachments?: ChatAttachment[] | undefined; media?: { accountId: string; resources?: { key: string; type: 'image' | 'file' | 'audio'; name: string }[] | undefined } | undefined }
const record = z.record(z.string(), z.unknown())
function object(value: unknown): Record<string, unknown> { return record.safeParse(value).data ?? {} }
function id(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return String(value)
  return undefined
}
function text(value: unknown): string { return typeof value === 'string' ? value : '' }

/** Match an exact robot AT; name-only and @everyone events cannot start a turn.
 * @param event - SDK event name.
 * @param value - untrusted SDK envelope.
 * @param accountId - configured application ID.
 * @param robotId - configured group mention identity.
 * @param robotIds - other bound robot identities, including disabled bindings.
 * @returns a text message or null for irrelevant/unsupported events.
 */
export function decodeMessage(event: string, value: unknown, accountId: string, robotId: string, robotIds: string[] = []): (Incoming & { hasMedia?: boolean }) | null {
  const raw = object(object(object(value).data).raw)
  if (['private.text', 'private.markdown', 'private.image', 'private.file', 'private.voice'].includes(event)) {
    const sender = id(raw.FromUserId ?? raw.fromUserId)
    const receipt = id(raw.MsgId ?? raw.msgId)
    const content = text(raw.Content ?? raw.content ?? raw.Text ?? raw.text).trim()
    const hasMedia = ['private.image', 'private.file', 'private.voice'].includes(event)
    if (!sender || sender === robotId || robotIds.includes(sender) || !receipt || !content && !hasMedia) return null
    return { conversation: { provider: 'infoflow', accountId, kind: 'private', id: sender },
      message: { id: receipt, sender: { id: sender, name: sender } }, text: hasMedia ? '[附件]' : content, ...(hasMedia ? { hasMedia } : {}) }
  }
  if (!['group.text', 'group.markdown', 'group.mixed', 'group.image', 'group.file', 'group.voice'].includes(event)) return null
  if (raw.eventtype !== undefined && raw.eventtype !== 'MESSAGE_RECEIVE') return null
  const group = id(raw.groupid ?? raw.groupId)
  const message = object(raw.message)
  const header = object(message.header)
  if (header.role === 'robot') return null
  const sender = id(header.fromuserid ?? header.fromUserId ?? raw.fromuserid)
  const receipt = id(header.messageid ?? raw.messageid)
  const blocks = Array.isArray(message.body) ? message.body.map(object) : []
  if (!group || !sender || sender === robotId || robotIds.includes(sender) || !receipt || !blocks.some(block =>
    text(block.type).toUpperCase() === 'AT' && id(block.robotid) === robotId)) return null
  // Images, quotes, and rich blocks are not flattened into executable instructions.
  const content = blocks.flatMap(block => {
    const type = text(block.type).toUpperCase()
    if (['TEXT', 'MD', 'MARKDOWN'].includes(type)) return [text(block.content ?? block.text)]
    if (type === 'LINK') return [text(block.label ?? block.url ?? block.href)]
    return []
  }).join('\n').trim()
  const hasMedia = blocks.some(block => ['IMAGE', 'FILE', 'VOICE'].includes(text(block.type).toUpperCase()))
    || ['group.image', 'group.file', 'group.voice'].includes(event)
  if (!content && !hasMedia) return null
  return { conversation: { provider: 'infoflow', accountId, kind: 'group', id: group },
    message: { id: receipt, sender: { id: sender, name: text(header.fromusername) || sender } }, text: content || '[附件]', ...(hasMedia ? { hasMedia } : {}) }
}

/** Unambiguous key for receipts and per-conversation ordering.
 * @param conversation - stable external identity.
 * @returns serialized tuple, with no numeric conversion.
 */
export function conversationKey(conversation: ExternalConversation): string {
  return JSON.stringify([conversation.provider, conversation.accountId, conversation.kind, conversation.id])
}

/** Split at Unicode code points, retaining exact content for retry.
 * @param content - outbound text.
 * @param limit - configured platform payload limit in code points.
 * @param maxUnits - optional conservative UTF-16 length cap for platforms with character limits.
 * @returns ordered nonempty parts.
 */
export function splitMessage(content: string, limit: number, maxUnits = Infinity): string[] {
  const chunks: string[] = []
  let part = '', count = 0
  for (const point of content) {
    if (part && (count >= limit || part.length + point.length > maxUnits)) { chunks.push(part); part = ''; count = 0 }
    part += point; count++
  }
  if (part) chunks.push(part)
  return chunks
}

/** Exact platform mentions route a shared group receipt across robot connections. */
export function mentionedRobots(value: unknown): string[] {
  const raw = object(object(object(value).data).raw)
  const body = object(raw.message).body
  return Array.isArray(body) ? body.map(object).filter(block => text(block.type).toUpperCase() === 'AT')
    .map(block => id(block.robotid)).filter((value): value is string => value !== undefined) : []
}
