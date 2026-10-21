import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AttachmentData, AttachmentRequest, ChatAttachment } from '../types.ts'
import type { CapabilityFace } from './capability-face.ts'

function objectUrl(data: AttachmentData): string {
  const bytes = Uint8Array.from(atob(data.base64), char => char.charCodeAt(0))
  return URL.createObjectURL(new Blob([bytes], { type: data.mediaType }))
}
export function AttachmentView({ item, request, face }: { item: ChatAttachment; request: AttachmentRequest; face: CapabilityFace }) {
  const [preview, setPreview] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => {
    let active = true, url = ''
    if (item.type === 'image') void face.attachment(request).then(data => {
      if (active && ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(data.mediaType)) { url = objectUrl(data); setPreview(url) }
    }).catch(cause => { if (active) setError(String(cause)) })
    return () => { active = false; if (url) URL.revokeObjectURL(url) }
  }, [face, request.roomId, request.messageId, request.attachmentId, item.type])
  return <div>
    {preview && <a href={preview} target="_blank" rel="noreferrer"><img src={preview} alt={item.attachment.name} style={{ maxWidth: '100%', maxHeight: 320 }}/></a>}
    <Button disabled={busy} onClick={() => {
      setBusy(true); setError('')
      void face.attachment(request).then(data => {
        const url = objectUrl(data), link = document.createElement('a'); link.href = url; link.download = data.name; link.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }).catch(cause => setError(String(cause))).finally(() => setBusy(false))
    }}>↓ {item.attachment.name} · {Math.ceil(item.attachment.bytes / 1024)} KB</Button>
    {item.transcript && <p>{item.transcript}</p>}{error && <p role="alert">{error}</p>}
  </div>
}
