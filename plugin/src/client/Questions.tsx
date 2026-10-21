import { useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { QuestionAnswer, QuestionView, RoomId } from '../types.ts'
import type { CapabilityFace } from './capability-face.ts'

export function Questions({ view, roomId, face, english }: { view: QuestionView; roomId: RoomId; face: CapabilityFace; english: boolean }) {
  const [answers, setAnswers] = useState<QuestionAnswer['answers']>(() => view.questions.map(q => ({ id: q.id, selected: [] })))
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const update = (id: string, patch: Partial<QuestionAnswer['answers'][number]>) => setAnswers(items => items.map(item => item.id === id ? { ...item, ...patch } : item))
  return <form onSubmit={event => {
    event.preventDefault(); setBusy(true); setError('')
    void face.answerQuestion({ roomId, id: view.id, answer: { answers } }).catch(cause => setError(String(cause))).finally(() => setBusy(false))
  }}>
    {view.questions.map(q => {
      const answer = answers.find(a => a.id === q.id)!
      return <fieldset key={q.id} disabled={busy}><legend>{q.header ? `${q.header}: ` : ''}{q.question}</legend>
        {q.detail && <pre style={{ whiteSpace: 'pre-wrap' }}>{q.detail}</pre>}
        {q.options?.map(option => <label key={option.label} style={{ display: 'block' }}><input type={q.multiSelect ? 'checkbox' : 'radio'} name={q.id}
          checked={answer.selected.includes(option.label)} onChange={event => update(q.id, { selected: q.multiSelect ? event.target.checked ? [...answer.selected, option.label] : answer.selected.filter(v => v !== option.label) : [option.label] })}/>
          {option.label} {option.description && <small>{option.description}</small>}</label>)}
        <label>{english ? 'Your answer / additional details' : '自定义回答／补充说明'}<textarea value={answer.custom ?? ''} onChange={event => update(q.id, { custom: event.target.value })}/></label>
      </fieldset>
    })}
    {error && <p role="alert">{error}</p>}
    <Button type="submit" disabled={busy || answers.some(a => !a.selected.length && !a.custom?.trim())}>{english ? 'Submit answers' : '提交回答'}</Button>
  </form>
}
