import { useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { MicrophoneIcon } from './Icons.tsx'
import css from './Panel.module.css'
/** Microphone capture starts only on an explicit click and releases every track on close. */
export function VoiceInput({ disabled, onAudio, label, stopLabel, onError }: {
  disabled: boolean; onAudio(file: File): Promise<void>; label: string; stopLabel: string; onError(message: string): void
}) {
  const active = useRef<{ recorder: MediaRecorder; stream: MediaStream; timer: ReturnType<typeof setTimeout> }>()
  const mounted = useRef(true)
  const [recording, setRecording] = useState(false)
  const [requesting, setRequesting] = useState(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      const current = active.current
      if (current) { clearTimeout(current.timer); current.stream.getTracks().forEach(track => track.stop()); if (current.recorder.state !== 'inactive') current.recorder.stop() }
    }
  }, [])
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') return null
  const start = async () => {
    setRequesting(true)
    let stream: MediaStream | undefined
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!mounted.current) { stream.getTracks().forEach(track => track.stop()); return }
      const recorder = new MediaRecorder(stream), chunks: Blob[] = []
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
      recorder.onerror = () => onError('Microphone recording failed')
      recorder.onstop = () => {
        stream!.getTracks().forEach(track => track.stop())
        if (active.current) clearTimeout(active.current.timer)
        active.current = undefined
        if (!mounted.current) return
        setRecording(false)
        const blob = new Blob(chunks, { type: recorder.mimeType })
        void onAudio(new File([blob], 'voice-recording', { type: recorder.mimeType })).catch(cause => onError(String(cause)))
      }
      const timer = setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop() }, 120000)
      active.current = { recorder, stream, timer }
      recorder.start(); setRecording(true)
    } catch (cause) { stream?.getTracks().forEach(track => track.stop()); if (mounted.current) onError(cause instanceof Error ? cause.message : String(cause)) }
    finally { if (mounted.current) setRequesting(false) }
  }
  return <Button size="sm" className={css.voiceButton} aria-label={recording ? stopLabel : label} title={recording ? stopLabel : label} aria-pressed={recording}
    icon={<MicrophoneIcon />} disabled={requesting || disabled && !recording} onClick={() => { if (recording) active.current?.recorder.stop(); else void start() }}>{recording ? stopLabel : null}</Button>
}
