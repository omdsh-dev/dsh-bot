/** Chat input with keyboard-safe addressing; dispatch remains a Host command. */
import { useId, useRef, useState } from 'react'
import { Button, IconCloseOutline16, IconSendOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Bot, ChatMessage } from '../types.ts'
import type { BotKey } from './locales.ts'
import { Avatar } from './Avatar.tsx'
import css from './Panel.module.css'

interface ComposerProps {
  bots: Bot[]
  disabled: boolean
  draft: string
  onDraft: (text: string) => void
  reply: ChatMessage | undefined
  onCancelReply: () => void
  onSend: () => void
  t: (key: BotKey) => string
}

/**
 * Compose one public message and insert Bot mentions at the caret.
 * @param props - Room members, controlled draft, reply, and submit action.
 * @returns The composer and its inline recipient picker.
 */
export function Composer({ bots, disabled, draft, onDraft, reply, onCancelReply, onSend, t }: ComposerProps) {
  const input = useRef<HTMLTextAreaElement>(null)
  const menuId = useId()
  const [caret, setCaret] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [active, setActive] = useState(0)
  const match = /(?:^|\s)@([a-zA-Z0-9_-]*)$/.exec(draft.slice(0, caret))
  const query = match?.[1]?.toLowerCase()
  const options = [{ id: 'all', name: t('everyone') }, ...bots].filter(bot => query !== undefined && (bot.id.includes(query) || bot.name.toLowerCase().includes(query)))
  const open = !dismissed && query !== undefined && options.length > 0
  const activeIndex = Math.min(active, options.length - 1)
  const insert = (id: string) => {
    const start = caret - (query?.length ?? 0) - 1
    const text = `${draft.slice(0, start)}@${id} ${draft.slice(caret)}`
    const nextCaret = start + id.length + 2
    onDraft(text); setCaret(nextCaret); setDismissed(true)
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(nextCaret, nextCaret) })
  }
  const invite = (id = '') => {
    const next = `${draft}${draft && !/\s$/.test(draft) ? ' ' : ''}@${id}${id ? ' ' : ''}`
    onDraft(next); setCaret(next.length); setActive(0); setDismissed(false)
    requestAnimationFrame(() => { input.current?.focus(); input.current?.setSelectionRange(next.length, next.length) })
  }
  return <div className={css.composerWrap}>
    {bots.length > 1 && <div className={css.recipientBar} role="group" aria-label={t('quickMention')}>
      <span>{t('quickMention')}</span>
      {bots.map(bot => <button type="button" key={bot.id} title={`@${bot.id}`} onClick={() => { invite(bot.id) }}><Avatar id={bot.id} small /><span>{bot.name}</span></button>)}
      <button type="button" onClick={() => { invite('all') }}><span className={css.atMark}>@</span><span>{t('everyone')}</span></button>
    </div>}
    <form className={css.composer} onSubmit={(event) => { event.preventDefault(); if (!disabled && draft.trim()) onSend() }}>
      {reply && <div className={css.replyPreview}><div><strong>{t('replying')} {bots.find(bot => bot.id === reply.botId)?.name ?? t('you')}</strong><span>{reply.text}</span></div>
        <Button size="sm" aria-label={t('removeReply')} icon={<IconCloseOutline16 />} onClick={onCancelReply} /></div>}
      {open && <div className={css.mentionMenu} role="listbox" id={menuId} aria-label={t('invite')}>
        <div className={css.menuLabel}>{t('invite')}</div>
        {options.map((bot, index) => <button type="button" key={bot.id} role="option" id={`${menuId}-${index}`} aria-selected={index === activeIndex}
          onMouseDown={(event) => { event.preventDefault() }} onClick={() => { insert(bot.id) }}>
          <Avatar id={bot.id} small /><strong>{bot.name}</strong><span>@{bot.id}</span>
        </button>)}
      </div>}
      <textarea ref={input} aria-label={t('message')} placeholder={t(bots.length === 1 ? 'directPlaceholder' : 'placeholder')} rows={2} maxLength={32000} value={draft}
        aria-controls={open ? menuId : undefined} aria-expanded={open} aria-haspopup="listbox" aria-activedescendant={open ? `${menuId}-${activeIndex}` : undefined}
        onChange={(event) => { onDraft(event.target.value); setCaret(event.target.selectionStart); setDismissed(false); setActive(0) }}
        onSelect={(event) => { setCaret(event.currentTarget.selectionStart) }}
        onBlur={() => { setDismissed(true) }}
        onKeyDown={(event) => {
          // Some IMEs emit the legacy 229 signal without isComposing.
          // oxlint-disable-next-line typescript/no-deprecated
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
          if (open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault(); setActive((activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length)
          } else if (open && event.key === 'Escape') { event.preventDefault(); setDismissed(true) }
          else if (open && event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); const option = options[activeIndex]; if (option) insert(option.id) }
          else if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); if (!disabled && draft.trim()) onSend() }
        }} />
      <div className={css.composerTools}>
        <Button size="sm" onClick={() => { invite() }} aria-label={t('invite')}><span className={css.atMark}>@</span>{t('invite')}</Button>
        <div className={css.sendTools}><span>{t('sendHint')}</span><Button type="submit" variant="primary" aria-label={t('send')} title={t('send')} disabled={disabled || !draft.trim()} icon={<IconSendOutline16 />} /></div>
      </div>
    </form>
    <p className={css.composerHint}>{t('addressHint')}</p>
  </div>
}
