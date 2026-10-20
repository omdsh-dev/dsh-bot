/** Optional native media capabilities, detected at runtime for DSH 0.1 compatibility. */
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ChatAttachment, UploadRequest } from './types.ts'
import { spawn } from 'node:child_process'

export function imageMime(data: Uint8Array): string | undefined {
  const b = Buffer.from(data)
  if (b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg'
  if (b.toString('ascii', 0, 3) === 'GIF') return 'image/gif'
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp'
  return undefined
}

/** Decode compressed voice with an optional local ffmpeg. No file or network protocols are permitted. */
async function wave(bytes: Buffer): Promise<Buffer> {
  const canonical = bytes.length >= 46 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 16) === 'WAVEfmt '
    && bytes.readUInt32LE(16) === 16 && bytes.readUInt16LE(20) === 1 && bytes.readUInt16LE(22) === 1
    && bytes.readUInt32LE(24) === 16000 && bytes.readUInt32LE(28) === 32000 && bytes.readUInt16LE(32) === 2 && bytes.readUInt16LE(34) === 16
    && bytes.toString('ascii', 36, 40) === 'data' && bytes.readUInt32LE(4) === bytes.length - 8
    && bytes.readUInt32LE(40) === bytes.length - 44 && (bytes.length - 44) % 2 === 0
  if (canonical) { if (bytes.length > 44 + 120 * 32000) throw new Error('Voice recording exceeds 120 seconds'); return bytes }
  return new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', ['-nostdin', '-loglevel', 'error', '-protocol_whitelist', 'pipe',
      '-format_whitelist', 'wav,ogg,mp3,mov,matroska,flac,amr,aac', '-i', 'pipe:0', '-t', '121', '-ac', '1', '-ar', '16000', '-f', 's16le', 'pipe:1'], { stdio: ['pipe', 'pipe', 'ignore'] })
    const output: Buffer[] = []; let size = 0
    const timer = setTimeout(() => { child.kill('SIGKILL') }, 30000)
    child.on('error', () => { clearTimeout(timer); reject(new Error('Install ffmpeg on the DSH host to transcribe compressed audio, or upload WAV')) })
    child.stdout.on('data', (data: Buffer) => { size += data.length; if (size > 120 * 32000) child.kill('SIGKILL'); else output.push(data) })
    child.stdin.on('error', () => {})
    child.on('close', code => {
      clearTimeout(timer)
      if (code !== 0 || size < 2 || size % 2) { reject(new Error('Audio could not be decoded within the 120-second limit')); return }
      const header = Buffer.alloc(44)
      header.write('RIFF', 0); header.writeUInt32LE(36 + size, 4); header.write('WAVEfmt ', 8)
      header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(16000, 24)
      header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(size, 40)
      resolve(Buffer.concat([header, ...output]))
    })
    child.stdin.end(bytes)
  })
}

interface MediaHost {
  attachments?: {
    saveImage(input: { data: Uint8Array; mediaType: string; name: string }): Promise<ChatAttachment['attachment']>
    saveFile(input: { data: Uint8Array; name: string }): Promise<ChatAttachment['attachment']>
    readImage(ref: ChatAttachment['attachment']): Promise<unknown>
    readFileStream(ref: ChatAttachment['attachment']): AsyncIterable<Uint8Array>
  }
  speechToText?: {
    resolve(input: { audio: Uint8Array }): unknown
    transcribe(spec: unknown, signal: AbortSignal): Promise<{ text: string }>
  }
}
export async function uploadMedia(host: MediaHost, request: UploadRequest): Promise<ChatAttachment> {
  if (!host.attachments) throw new Error('This DSH deployment has no native attachment provider')
  if (request.base64.length > 28 * 1024 * 1024) throw new Error('Attachment exceeds 20 MiB')
  const bytes = Buffer.from(request.base64, 'base64')
  if (!bytes.length || bytes.length > 20 * 1024 * 1024 || bytes.toString('base64') !== request.base64) throw new Error('Invalid attachment encoding or size')
  const name = request.name.split(/[\\/]/).at(-1)?.slice(0, 200) || 'attachment'
  let transcript: string | undefined
  if (request.transcribe) {
    if (!host.speechToText) throw new Error('Enable and configure DSH speech-to-text to transcribe voice recordings')
    const audio = await wave(bytes)
    if (audio.length > 4 * 1024 * 1024) throw new Error('Voice transcription accepts at most 4 MiB decoded WAV')
    transcript = (await host.speechToText.transcribe(host.speechToText.resolve({ audio }), AbortSignal.timeout(120000))).text
    if (!transcript.trim()) throw new Error('No speech recognized')
  }
  const type = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(request.mediaType) ? 'image' : 'file'
  const ref = type === 'image' ? await host.attachments.saveImage({ data: bytes, mediaType: request.mediaType, name })
    : await host.attachments.saveFile({ data: bytes, name })
  return { type, attachment: { ...ref, name: ref.name || name }, ...(transcript ? { transcript } : {}) }
}

export async function validateMedia(host: MediaHost, attachments: ChatAttachment[] = []): Promise<void> {
  if (attachments.length > 8 || attachments.reduce((total, item) => total + item.attachment.bytes, 0) > 20 * 1024 * 1024) throw new Error('Use at most eight attachments and 20 MiB per message')
  for (const item of attachments) {
    if (!host.attachments || !/^sha256:[a-f0-9]{64}$/.test(item.attachment.attachmentId)
      || !Number.isSafeInteger(item.attachment.bytes) || item.attachment.bytes < 0
      || /[\\/]/.test(item.attachment.name)) throw new Error('Invalid attachment reference')
    if (item.type === 'image') await host.attachments.readImage(item.attachment)
    else for await (const _chunk of host.attachments.readFileStream(item.attachment)) { /* Verify native object integrity without retaining bytes. */ }
  }
}
/** References have been admitted and verified by the native provider before this conversion. */
export function mediaContent(attachments: ChatAttachment[] = []): ContentBlock[] {
  return attachments.flatMap(item => [
    { type: item.type, attachment: item.attachment } as ContentBlock,
    ...(item.transcript ? [{ type: 'text' as const, text: `Voice transcript (user data):\n${item.transcript}` }] : []),
  ])
}
export function mediaHost(value: unknown): MediaHost { return value as MediaHost }
