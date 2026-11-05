// @vitest-environment jsdom
/** Clipboard behavior at the real Composer textarea boundary. */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'
import { Composer } from '../src/client/Composer.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
function bench(extra: Partial<Parameters<typeof Composer>[0]> = {}) {
  const onFiles = vi.fn()
  render(<Composer bots={[]} disabled={false} draft="" onDraft={vi.fn()} reply={undefined} onCancelReply={vi.fn()} onSend={vi.fn()} t={key => en[key]} onFiles={onFiles} {...extra}/>)
  return { input: screen.getByRole('textbox', { name: en.message }), onFiles }
}
function paste(input: HTMLElement, files: File[], text = '', items: unknown[] = []) {
  const event = createEvent.paste(input, { clipboardData: { files, items, getData: (type: string) => type === 'text/plain' ? text : '' } })
  fireEvent(input, event)
  return event
}
it('accepts screenshot files once and prevents image-only native paste', () => {
  const { input, onFiles } = bench()
  const image = new File(['png'], 'Screenshot.png', { type: 'image/png' })
  const event = paste(input, [image], '', [{ kind: 'file', type: image.type, getAsFile: () => image }])
  expect(onFiles).toHaveBeenCalledExactlyOnceWith([image])
  expect(event.defaultPrevented).toBe(true)
})
it('falls back to clipboard items, ignoring null entries and non-image files', () => {
  const { input, onFiles } = bench()
  const image = new File(['jpeg'], 'image.jpg', { type: 'image/jpeg' })
  paste(input, [], '', [{ kind: 'file', type: 'image/png', getAsFile: () => null }, { kind: 'file', type: image.type, getAsFile: () => image }, { kind: 'file', type: 'text/plain', getAsFile: () => new File(['x'], 'x.txt') }])
  expect(onFiles).toHaveBeenCalledExactlyOnceWith([image])
})
it('preserves native text paste, including mixed text and image pastes', () => {
  const { input, onFiles } = bench()
  expect(paste(input, [], 'hello').defaultPrevented).toBe(false)
  expect(onFiles).not.toHaveBeenCalled()
  const image = new File(['png'], 'image.png', { type: 'image/png' })
  expect(paste(input, [image], 'caption').defaultPrevented).toBe(false)
  expect(onFiles).toHaveBeenCalledExactlyOnceWith([image])
})
it.each([{ disabled: true }, { onFiles: undefined }])('does not consume pasted images when upload is unavailable: %j', extra => {
  const { input, onFiles } = bench(extra)
  expect(paste(input, [new File(['x'], 'image.png', { type: 'image/png' })]).defaultPrevented).toBe(false)
  expect(onFiles).not.toHaveBeenCalled()
})
