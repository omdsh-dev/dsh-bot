import { useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatCard } from '../card-types.ts'
import type { ChatMessageId, RoomId } from '../types.ts'
import type { CapabilityFace } from './capability-face.ts'
import css from './Panel.module.css'

export function CardView({ card, roomId, messageId, enabled, face, english }: { card: ChatCard; roomId: RoomId; messageId: ChatMessageId; enabled: boolean; face: CapabilityFace; english: boolean }) {
  const [values, setValues] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false), [error, setError] = useState(''), [submitted, setSubmitted] = useState(false)
  const content = card.content, done = !!card.submitted || submitted
  return <section className={css.card} aria-label={content.title}><strong>{content.title}</strong>
    {content.kind === 'metric' && <><div className={css.cardMetric}>{content.value}</div>{content.detail && <p>{content.detail}</p>}</>}
    {content.kind === 'progress' && <><progress aria-label={content.title} value={content.value} max={content.total}/><span>{content.value} / {content.total}</span>{content.detail && <p>{content.detail}</p>}</>}
    {content.kind === 'table' && <div className={css.cardTable}><table><thead><tr>{content.columns.map((column, i) => <th key={i} scope="col">{column}</th>)}</tr></thead><tbody>{content.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>}
    {content.kind === 'form' && <form onSubmit={event => {
      event.preventDefault(); setBusy(true); setError('')
      void face.submitCard({ roomId, messageId, cardId: card.id, revision: card.revision, values }).then(() => setSubmitted(true)).catch(cause => setError(String(cause))).finally(() => setBusy(false))
    }}>{content.description && <p>{content.description}</p>}<fieldset disabled={!enabled || busy || done}>
      {content.fields.map(field => { const value = card.submitted?.values[field.name] ?? values[field.name] ?? '', update = (text: string) => setValues(old => ({ ...old, [field.name]: text })); return <label key={field.name}>{field.label}{field.required ? ' *' : ''}
        {field.type === 'select' ? <select required={field.required} value={value} onChange={event => update(event.target.value)}><option value="">{english ? 'Choose…' : '请选择…'}</option>{field.options!.map(option => <option key={option}>{option}</option>)}</select>
          : field.type === 'textarea' ? <textarea required={field.required} maxLength={2000} value={value} onChange={event => update(event.target.value)}/>
          : <Input required={field.required} maxLength={2000} value={value} onChange={event => update(event.target.value)}/>}</label> })}
      <Button type="submit" size="sm" variant="primary">{done ? english ? 'Submitted' : '已提交' : content.submitLabel}</Button>
    </fieldset><small>{english ? 'Sends a new message to this Bot in DSH.' : '提交后，在 DSH 中向此 Bot 发送一条新消息。'}</small>{error && <p role="alert">{error}</p>}</form>}
  </section>
}
