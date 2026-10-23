import { useEffect, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { KnowledgeStatus } from '../knowledge-types.ts'
import type { MemoryCatalog } from '../memory-types.ts'
import type { CapabilityFace } from './capability-face.ts'
import css from './Panel.module.css'

export function KnowledgeControls({ face, english, catalog, refresh }: { face: CapabilityFace; english: boolean; catalog: MemoryCatalog; refresh(): void }) {
  const l = (zh: string, en: string) => english ? en : zh
  const [status, setStatus] = useState<KnowledgeStatus>(), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [name, setName] = useState(''), [first, setFirst] = useState(''), [second, setSecond] = useState('')
  const load = () => face.knowledgeStatus().then(setStatus)
  useEffect(() => { let active = true; if (face.knowledgeStatus) void face.knowledgeStatus().then(value => { if (active) setStatus(value) }).catch(cause => { if (active) setError(String(cause)) }); return () => { active = false } }, [face])
  const act = async (action: () => Promise<unknown>) => { setBusy(true); setError(''); try { await action(); await load(); refresh() } catch (cause) { setError(String(cause)) } finally { setBusy(false) } }
  const accounts = catalog.users.filter(user => user.id !== 'local:operator' && !user.id.startsWith('person:') && !status?.identities.some(identity => identity.aliases.includes(user.id)))
  const labels = { pending: l('等待整理', 'Pending'), running: l('整理中', 'Running'), complete: l('已整理', 'Complete'), failed: l('需要处理', 'Needs attention'), skipped: l('已跳过', 'Skipped') }
  if (!status) return error ? <p role="alert">{error}</p> : null
  return <details><summary>{l('自动整理、账号关联与辅助用量', 'Automatic review, linked accounts & auxiliary usage')}</summary>
    {error && <p role="alert" className={css.controlError}>{error}</p>}
    <label className={css.checkOption}><input type="checkbox" checked={status.settings.reviewEnabled} disabled={busy} onChange={event => { void act(() => face.configureKnowledge({ reviewEnabled: event.target.checked })) }}/>{l('对话空闲后自动提取记忆候选', 'Extract memory candidates after conversations settle')}</label>
    <p>{l('自动整理使用回复 Bot 的模型并计入其预算；提取的内容仍需确认后生效。失败会退避重试，连续三次失败后暂停该条。', 'Reviews use the responding Bot’s model and budget. Candidates still require approval. Failures retry with backoff and pause after three attempts.')}</p>
    <Button size="sm" disabled={busy} onClick={() => { void act(async () => {}) }}>{l('刷新整理状态', 'Refresh review status')}</Button>
    {status.reviews.slice(0, 20).map(review => <article key={review.id} className={css.memoryCard}>
      <strong>{labels[review.status]} · @{review.botId}</strong><small>{new Date(review.createdAt).toLocaleString()} · {review.candidates ?? 0} {l('条候选', 'candidates')}</small>
      {review.error && <p>{review.error}</p>}
      {(review.status === 'failed' || review.status === 'pending' || review.status === 'skipped') && <div className={css.controlActions}>
        <Button size="sm" disabled={busy} onClick={() => { void act(() => face.reviewAction({ id: review.id, action: 'retry' })) }}>{l('重新整理', 'Retry review')}</Button>
        {review.status !== 'skipped' && <Button size="sm" disabled={busy} onClick={() => { void act(() => face.reviewAction({ id: review.id, action: 'skip' })) }}>{l('跳过', 'Skip')}</Button>}
      </div>}
    </article>)}
    <h4>{l('关联同一用户的账号', 'Link accounts belonging to one user')}</h4>
    <p>{l('关联后，这些账号可在各自私聊中召回同一人的个人记忆。只关联已核实为同一人的账号。变更关联会停止当前执行并重建上下文；解除后，共同身份下的记忆保留在管理页，不再自动召回。', 'Link only verified accounts of the same person. Changes stop current work and refresh context. Unlinking stops shared recall; memories remain available for operator review.')}</p>
    <label>{l('用户名称', 'Person name')}<Input value={name} maxLength={100} onChange={event => setName(event.target.value)}/></label>
    <label>{l('账号一', 'First account')}<select value={first} onChange={event => setFirst(event.target.value)}><option value="">{l('选择账号', 'Select an account')}</option>{accounts.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
    <label>{l('账号二', 'Second account')}<select value={second} onChange={event => setSecond(event.target.value)}><option value="">{l('选择账号', 'Select an account')}</option>{accounts.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
    <Button disabled={busy || !name.trim() || !first || !second || first === second} onClick={() => { void act(async () => { await face.linkIdentity({ name, aliases: [first, second] }); setName(''); setFirst(''); setSecond('') }) }}>{l('关联并共享个人记忆', 'Link & share personal memories')}</Button>
    {status.identities.map(person => <p key={person.id}>{person.name} · {person.aliases.map(id => catalog.users.find(user => user.id === id)?.name ?? id).join(' / ')} <Button size="sm" disabled={busy} onClick={() => { void act(() => face.unlinkIdentity({ id: person.id })) }}>{l('解除关联', 'Unlink')}</Button></p>)}
    <h4>{l('辅助调用用量', 'Auxiliary model usage')}</h4>
    <p>{l('以下用量已计入总预算。费用沿用 Bot 单价；未报告用量的失败调用按预留额度计入预算。', 'Included in the total budget, using Bot token prices. Failed calls without reported usage consume their reserved budget.')}</p>
    {status.usage.map(row => <p key={`${row.botId}:${row.purpose}`}>@{row.botId} · {row.purpose === 'memory' ? l('记忆整理', 'Memory') : l('上下文交接', 'Handoff')} · {row.calls} {l('次', 'calls')} · {row.input + row.output} tokens · {row.cost.toFixed(6)}</p>)}
  </details>
}
