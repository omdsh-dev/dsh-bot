/** Task control is a separate Host path: inspecting or stopping work never starts a model turn. */
import { useEffect, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AttemptRequest } from '../types.ts'
import type { TaskInspection } from '../task-control-types.ts'
import type { TaskStatus, RunStatus } from '../task-types.ts'
import type { CapabilityFace } from './capability-face.ts'
import css from './Panel.module.css'

export function TaskInspector({ face, request, english }: { face: CapabilityFace; request: AttemptRequest; english: boolean }) {
  const l = (zh: string, en: string) => english ? en : zh
  const key = JSON.stringify([request.roomId, request.messageId])
  const current = useRef(key); current.current = key
  const [open, setOpen] = useState(false), [refresh, setRefresh] = useState(0)
  const [result, setResult] = useState<{ key: string; view: TaskInspection }>()
  const [error, setError] = useState<{ key: string; message: string }>()
  const [pending, setPending] = useState<string>()
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  useEffect(() => { setChecked({}); setPending(undefined) }, [key])
  useEffect(() => {
    if (!open || !face.taskView) return
    let active = true
    setError(undefined)
    void face.taskView(request).then(view => { if (active) setResult({ key, view }) })
      .catch(cause => { if (active) setError({ key, message: String(cause) }) })
    return () => { active = false }
  }, [open, refresh, key, face.taskView])
  const view = result?.key === key ? result.view : undefined
  const busy = pending === key
  const change = async (action: () => Promise<unknown>) => {
    setPending(key); setError(undefined)
    try {
      await action()
      if (current.current === key) { setChecked({}); setRefresh(value => value + 1) }
    } catch (cause) { if (current.current === key) setError({ key, message: String(cause) }) }
    finally { if (current.current === key) setPending(undefined) }
  }
  const status = (value: TaskStatus | RunStatus): string => ({
    queued: l('等待执行', 'Queued'), running: l('执行中', 'Running'), waiting: l('等待子任务', 'Waiting for delegated work'),
    complete: l('本次执行结束', 'Run finished'), awaiting_verification: l('执行结束，待验收', 'Finished; awaiting verification'),
    verified: l('已由用户验收', 'Accepted by user'), failed: l('失败或验收未通过', 'Failed or rejected'),
    canceled: l('已停止', 'Canceled'), interrupted: l('执行中断，未自动重放', 'Interrupted; not replayed'),
  })[value]
  const uncertain = view?.operations.filter(operation => operation.status === 'started' || operation.status === 'unknown' && !operation.resolution) ?? []
  return <details className={css.toolDetails} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{l('任务与恢复', 'Task & recovery')}</summary>
    {error?.key === key && <p role="alert">{error.message}</p>}
    {open && !view && !error && <p role="status">{l('读取任务状态…', 'Loading task state…')}</p>}
    {view && <>
      <p><strong>{status(view.task.status)}</strong></p>
      <small>{l('任务 ID', 'Task ID')}: {view.task.id}</small>
      <p>{l('模型结束回复不代表目标已达成；请检查产物后再验收。刷新和停止不会启动新的模型请求。', 'A finished model turn is not proof that the goal was achieved. Inspect the deliverables before acceptance. Refreshing and stopping do not start a model request.')}</p>
      {view.task.cancelRequestedAt !== undefined && <p role="status">{l('已记录停止请求；仍在运行的工具可能尚未退出，请核实外部影响。新的执行仍可停止。', 'A stop request was recorded. Running tools may not have exited yet; check external effects. New runs can still be stopped.')}</p>}
      {face.stopTask && ['queued', 'running', 'waiting'].includes(view.task.status) && <Button size="sm" disabled={busy}
        onClick={() => { void change(() => face.stopTask!({ roomId: request.roomId, taskId: view.task.id })) }}>{l('停止整个任务', 'Stop whole task')}</Button>}
      {!!uncertain.length && <p role="status">{l(`有 ${uncertain.length} 项工具操作尚未确认结果。不会自动重放，请先检查实际状态。`, `${uncertain.length} tool operation(s) have an uncertain outcome. They will not be replayed automatically; inspect the actual state first.`)}</p>}
      {view.operations.length > 0 && <details><summary>{l('工具操作凭据', 'Tool operation receipts')} ({view.operations.length})</summary>
        <p>{l('这里只保存调用标识和状态，不保存参数或结果正文。收到工具返回也不等于业务成功。', 'Only call identities and states are recorded here, not arguments or result bodies. A tool return is not proof of business success.')}</p>
        {view.operations.map(operation => <article key={operation.id} className={css.memoryCard}>
          <strong>{operation.name}</strong><p><small>{operation.callId}</small></p>
          <p>{operation.resolution ? operation.resolution.outcome === 'verified_applied'
            ? l('用户已核实：已生效', 'User checked: applied') : l('用户已核实：未生效', 'User checked: not applied')
            : operation.status === 'unknown' ? l('结果未知', 'Outcome unknown') : operation.status === 'started'
              ? l('已记录执行意图，尚无返回凭据', 'Dispatch intent recorded; no return receipt yet') : l('已收到返回，业务结果待核实', 'Return received; business outcome not verified')}</p>
          {operation.status === 'unknown' && !operation.resolution && face.resolveTaskOperation && <>
            <label><input type="checkbox" checked={checked[operation.id] === true} disabled={busy}
              onChange={event => setChecked(value => ({ ...value, [operation.id]: event.target.checked }))}/>
              {l(`我已检查 ${operation.name}（${operation.callId}）的实际外部状态`, `I checked the actual external state of ${operation.name} (${operation.callId})`)}</label>
            <div className={css.controlActions}>
              {(['verified_applied', 'verified_not_applied'] as const).map(resolution => <Button key={resolution} size="sm" disabled={busy || !checked[operation.id]}
                onClick={() => { void change(() => face.resolveTaskOperation!({ roomId: operation.roomId, messageId: operation.messageId, callId: operation.callId, resolution })) }}>
                {resolution === 'verified_applied' ? l('确认已生效', 'Confirm applied') : l('确认未生效', 'Confirm not applied')}
              </Button>)}
            </div><small>{l('此确认只记录核实结论，不会重试操作或启动任务。', 'This records your reconciliation only. It does not retry an operation or start work.')}</small>
          </>}
        </article>)}
      </details>}
      {view.task.status === 'awaiting_verification' && face.verifyTask && <div className={css.controlActions}>
        <Button size="sm" disabled={busy || uncertain.length > 0} onClick={() => { void change(() => face.verifyTask!({ roomId: request.roomId, taskId: view.task.id, outcome: 'accepted' })) }}>{l('检查产物后验收通过', 'Accept checked result')}</Button>
        <Button size="sm" disabled={busy || uncertain.length > 0} onClick={() => { void change(() => face.verifyTask!({ roomId: request.roomId, taskId: view.task.id, outcome: 'rejected' })) }}>{l('验收未通过', 'Reject result')}</Button>
      </div>}
      <details><summary>{l('执行记录', 'Execution records')} ({view.task.runs.length})</summary>
        {view.task.runs.map(run => <article key={run.id} className={css.memoryCard}>
          <strong>@{run.botId} · {status(run.status)}</strong><p><small>{run.id}</small></p>
          {run.sessionId && <p>{l('会话', 'Session')}: {run.sessionId}</p>}
          {run.parentRunId && <p>{l('父执行', 'Parent run')}: {run.parentRunId}</p>}
          {run.retryOf && <p>{l('重试来源', 'Retry of')}: {run.retryOf}</p>}
          {run.continuationOf && <p>{l('接续来源', 'Continuation of')}: {run.continuationOf}</p>}
          {run.resultIds.length > 0 && <p>{l('结果消息', 'Result messages')}: {run.resultIds.join(', ')}</p>}
        </article>)}
      </details>
      <details><summary>{l('近期生命周期事件', 'Recent lifecycle events')} ({view.task.events.length})</summary>
        {view.task.droppedEvents > 0 && <p>{l(`更早的 ${view.task.droppedEvents} 条事件已按保留上限裁剪。`, `${view.task.droppedEvents} older events were trimmed by retention limits.`)}</p>}
        <ol>{view.task.events.map(event => <li key={event.sequence}>#{event.sequence} · {new Date(event.time).toLocaleString()} · {event.kind}{event.status ? ` · ${status(event.status)}` : ''}{event.runId ? ` · ${event.runId}` : ''}</li>)}</ol>
      </details>
    </>}
    <Button size="sm" disabled={busy} onClick={() => setRefresh(value => value + 1)}>{l('刷新任务状态', 'Refresh task state')}</Button>
  </details>
}
