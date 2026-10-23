import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ContextView } from '../knowledge-types.ts'
import type { AttemptRequest } from '../types.ts'
import type { CapabilityFace } from './capability-face.ts'
import css from './Panel.module.css'

export function ContextInspector({ face, request, english }: { face: CapabilityFace; request: AttemptRequest; english: boolean }) {
  const l = (zh: string, en: string) => english ? en : zh
  const [open, setOpen] = useState(false), [view, setView] = useState<ContextView>(), [error, setError] = useState(''), [refresh, setRefresh] = useState(0)
  useEffect(() => {
    if (!open) return
    let active = true
    void face.contextView(request).then(result => { if (active) { setView(result); setError('') } }).catch(cause => { if (active) setError(String(cause)) })
    return () => { active = false }
  }, [open, refresh, face, request.roomId, request.messageId])
  const frame = view?.trace ?? view?.current
  return <details className={css.toolDetails} onToggle={event => setOpen(event.currentTarget.open)}><summary>{l('记忆与上下文', 'Memory & context')}</summary>
    {error && <p role="alert">{error}</p>}
    {view && <>
      <p>{frame?.window ? `${frame.tokens.toLocaleString()} / ${frame.window.toLocaleString()} tokens · ${Math.round(frame.tokens / frame.window * 100)}%` : l('当前模型未提供上下文窗口信息', 'Context window is unavailable for this model')}</p>
      {frame && frame.window > 0 && <progress aria-label={l('上下文占用', 'Context occupancy')} value={Math.min(frame.tokens, frame.window)} max={frame.window}/>}
      <small>{frame?.measurement === 'provider' ? l('本次回复最后一次模型调用报告的输入 Token', 'Input tokens reported by the last model call for this reply') : frame?.measurement === 'meter' ? l('原生 Token 计量估算', 'Native token meter estimate') : frame?.measurement === 'characters' ? l('按字符数保守估算，并非精确 Token 数', 'Conservative character estimate, not an exact token count') : l('尚无计量数据', 'No measurement yet')}</small>
      <h4>{l('本次召回的记忆', 'Memories recalled for this reply')}</h4>
      {!view.trace && <p>{l('此旧回复未保存召回明细。', 'Recall details were not recorded for this older response.')}</p>}
      {view.trace && <p>{view.trace.recalls} {l('次召回', 'recalls')} · {view.trace.omitted} {l('条因预算未纳入或未保留在明细中', 'omitted by budget or trace limits')}</p>}
      {view.memories.map(memory => <article key={memory.id} className={css.memoryCard}><strong>{memory.scope} · {memory.subject} / {memory.topic}</strong><p>{memory.body || l('内容已遗忘或不可用', 'Content forgotten or unavailable')}</p><small>{memory.status} · {memory.id} · v{memory.revision}</small>{view.trace?.conflicts.some(ids => ids.includes(memory.id)) && <p>{l('当时存在冲突，需要核实', 'Conflicting at recall time; verification required')}</p>}</article>)}
      <h4>{l('上下文分段', 'Context segments')}</h4><small>{l('本次执行会话', 'Execution session')}: {view.sessionId}</small>
      {view.decisions.map((decision, index) => <p key={index}>{new Date(decision.time).toLocaleString()} · {decision.action === 'compact' ? l('压缩后继续当前会话', 'Compacted; continuing this session') : l('压缩后仍接近容量，准备交接', 'Still near capacity after compaction; preparing handoff')} · {decision.before.toLocaleString()} → {decision.after.toLocaleString()} tokens</p>)}
      {view.segments.map(segment => <details key={segment.sessionId}><summary>{new Date(segment.endedAt).toLocaleString()} · {segment.reason === 'memory-access-changed' ? l('记忆访问变更', 'Memory access changed') : l('上下文容量切换', 'Context capacity rotation')}</summary><small>{segment.sessionId} → {segment.nextSessionId}</small>{segment.handoff ? <pre>{segment.handoff}</pre> : <p>{l('无交接摘要，或已因记忆变更清除', 'No handoff, or cleared after a memory change')}</p>}</details>)}
      {view.pendingHandoff && <details><summary>{l('待加载的交接摘要', 'Pending handoff')}</summary><pre>{view.pendingHandoff}</pre></details>}
    </>}
    <Button size="sm" onClick={() => setRefresh(value => value + 1)}>{l('刷新上下文', 'Refresh context')}</Button>
  </details>
}
