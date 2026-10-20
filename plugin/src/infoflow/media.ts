/** Fetch authenticated message details before resolving official media references. */
import type { ChatAttachment, UploadRequest } from '../types.ts'
import type { Incoming } from './messages.ts'
import { imageMime } from '../media.ts'
export interface InfoFlowMediaApi {
  message: {
    getMessage?(request: { fromId: string; receiverId: string; receiverType: 2 | 7; msgId: string }): Promise<{ content: Record<string, unknown>; msgType: string }>
    transcribeVoiceMessage?(md5: string): Promise<{ content: string }>
  }
  file?: { download(request: { fid: string; chatType: 'group' | 'private'; chatId?: string; fileMsgId?: string; maxBytes: number }): Promise<{ buffer: Uint8Array; fileName?: string; contentType?: string }> }
}
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {} }
/** Signed media URLs never reach persistent chat state. Redirects and arbitrary hosts are rejected. */
export async function readInfoFlowImage(url: string): Promise<Uint8Array> {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port && parsed.port !== '443'
    || !['baidu.com', 'baidu-int.com', 'bcebos.com'].some(host => parsed.hostname === host || parsed.hostname.endsWith('.' + host))) throw new Error('Unsupported InfoFlow media host')
  const response = await fetch(parsed, { redirect: 'error', signal: AbortSignal.timeout(15000) })
  if (!response.ok || !response.body || Number(response.headers.get('content-length') ?? 0) > 20 * 1024 * 1024) throw new Error('Media download failed or exceeds 20 MiB')
  const chunks: Uint8Array[] = []; let size = 0
  for await (const chunk of response.body) {
    size += chunk.byteLength
    if (size > 20 * 1024 * 1024) throw new Error('Media exceeds 20 MiB')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}
export async function receiveMedia(api: InfoFlowMediaApi, input: Incoming, upload: (request: UploadRequest) => Promise<ChatAttachment>): Promise<Incoming> {
  if (!api.message.getMessage) throw new Error('InfoFlow SDK media API unavailable')
  const detail = await api.message.getMessage({ fromId: input.message.sender.id, receiverId: input.conversation.kind === 'group' ? input.conversation.id : input.conversation.accountId,
    receiverType: input.conversation.kind === 'group' ? 2 : 7, msgId: input.message.id })
  const content = detail.content
  if (detail.msgType === 'voice' || content.type === 'voice') {
    const transcript = typeof content.voiceText === 'string' && content.voiceText.trim() ? content.voiceText
      : typeof content.md5 === 'string' && api.message.transcribeVoiceMessage ? (await api.message.transcribeVoiceMessage(content.md5)).content : ''
    if (!transcript.trim()) throw new Error('InfoFlow has not supplied a voice transcript; retry when ASR is ready')
    return { ...input, text: transcript }
  }
  const blocks = Array.isArray(content.blocks) ? content.blocks.map(record) : [content]
  const media = blocks.filter(block => ['image', 'file'].includes(String(block.type).toLowerCase()))
  if (!media.length || media.length > 8) throw new Error('No supported media references or too many attachments')
  const attachments: ChatAttachment[] = []; let total = 0
  for (const block of media) {
    let bytes: Uint8Array, name = typeof block.fileName === 'string' ? block.fileName : 'image'
    if (typeof block.fid === 'string' && block.fid && api.file) {
      const file = await api.file.download({ fid: block.fid, chatType: input.conversation.kind, ...(input.conversation.kind === 'group' ? { chatId: input.conversation.id, fileMsgId: input.message.id } : {}), maxBytes: 20 * 1024 * 1024 - total })
      bytes = file.buffer; name = file.fileName ?? name
    } else if (typeof block.downloadUrl === 'string') bytes = await readInfoFlowImage(block.downloadUrl)
    else throw new Error('InfoFlow did not supply a downloadable media reference')
    total += bytes.byteLength
    if (total > 20 * 1024 * 1024) throw new Error('Attachments exceed 20 MiB')
    attachments.push(await upload({ name, mediaType: imageMime(bytes) ?? 'application/octet-stream', base64: Buffer.from(bytes).toString('base64') }))
  }
  return { ...input, attachments }
}
