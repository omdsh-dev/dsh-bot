import { expect, it, vi } from 'vitest'
import { uploadMedia, validateMedia } from '../src/media.ts'
import { receiveMedia, readInfoFlowImage } from '../src/infoflow/media.ts'
import { decodeMessage } from '../src/feishu/sdk.ts'
import type { ChatAttachment } from '../src/types.ts'

const attachment: ChatAttachment = { type: 'file', attachment: { attachmentId: 'sha256:' + 'a'.repeat(64), name: 'notes.txt', bytes: 5 } }
it('admits binary bytes only through native storage and verifies referenced files before execution', async () => {
  const saveFile = vi.fn(async () => attachment.attachment), read = vi.fn()
  const host = { attachments: { saveFile, saveImage: saveFile, readImage: read, async *readFileStream() { read(); yield Buffer.from('hello') } } }
  expect(await uploadMedia(host, { name: '../../notes.txt', mediaType: 'text/plain', base64: Buffer.from('hello').toString('base64') })).toEqual(attachment)
  expect(saveFile).toHaveBeenCalledWith({ name: 'notes.txt', data: Buffer.from('hello') })
  await validateMedia(host, [attachment]); expect(read).toHaveBeenCalledOnce()
  await expect(validateMedia(host, [{ ...attachment, attachment: { ...attachment.attachment, name: '../secret' } }])).rejects.toThrow('Invalid')
  await expect(uploadMedia(host, { name: 'bad', mediaType: 'text/plain', base64: 'not base64' })).rejects.toThrow('Invalid')
})
it('rejects voice transcription when the configured native provider is missing', async () => {
  const save = vi.fn()
  await expect(uploadMedia({ attachments: { saveFile: save, saveImage: save, readImage: save, readFileStream: async function* () {} } },
    { name: 'voice.wav', mediaType: 'audio/wav', base64: Buffer.from('RIFF....WAVE').toString('base64'), transcribe: true })).rejects.toThrow('speech-to-text')
  expect(save).not.toHaveBeenCalled()
})
it('normalizes Feishu images, files, voice and rich post images while requiring a human and exact group mention', () => {
  const event = { sender: { sender_type: 'user', sender_id: { open_id: 'ou_person' } }, message: {
    message_id: 'om_msg', chat_id: 'oc_chat', chat_type: 'p2p', message_type: 'image', content: '{"image_key":"img_key"}',
  } }
  expect(decodeMessage(event, 'app', 'ou_bot')).toMatchObject({ resources: [{ key: 'img_key', type: 'image' }] })
  expect(decodeMessage({ ...event, message: { ...event.message, message_type: 'audio', content: '{"file_key":"audio_key"}' } }, 'app', 'ou_bot')).toMatchObject({ resources: [{ type: 'audio' }] })
  expect(decodeMessage({ ...event, message: { ...event.message, chat_type: 'group' } }, 'app', 'ou_bot')).toBeNull()
  expect(decodeMessage({ ...event, message: { ...event.message, message_type: 'post', content: JSON.stringify({ zh_cn: { title: 'Read', content: [[{ tag: 'text', text: 'this' }, { tag: 'img', image_key: 'img_key' }]] } }) } }, 'app', 'ou_bot')).toMatchObject({ text: 'Read\nthis', resources: [{ type: 'image' }] })
})
it('uses authenticated InfoFlow details and SDK downloads, and never follows arbitrary media URLs', async () => {
  const upload = vi.fn(async () => attachment)
  const download = vi.fn(async () => ({ buffer: Buffer.from('hello'), fileName: 'notes.txt' }))
  const input = { conversation: { provider: 'infoflow' as const, accountId: 'app', kind: 'group' as const, id: 'group' }, message: { id: 'msg', sender: { id: 'alice', name: 'Alice' } }, text: 'review' }
  const api = { message: { getMessage: vi.fn(async () => ({ msgType: 'file', content: { type: 'file', fid: 'fid', fileName: 'notes.txt' } })) }, file: { download } }
  expect(await receiveMedia(api, input, upload)).toMatchObject({ attachments: [attachment] })
  expect(download).toHaveBeenCalledWith(expect.objectContaining({ fid: 'fid', chatId: 'group', fileMsgId: 'msg', maxBytes: 20 * 1024 * 1024 }))
  await expect(readInfoFlowImage('http://127.0.0.1/admin')).rejects.toThrow('Unsupported')
  await expect(readInfoFlowImage('https://bcebos.com.attacker.example/image')).rejects.toThrow('Unsupported')
})
