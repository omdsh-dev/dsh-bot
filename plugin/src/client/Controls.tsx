/** Explicit controls for lifecycle, execution policy, automation and retained delivery failures. */
import { useEffect, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CapabilityCatalog, ScheduleRun, BotId, BotState, FailureView, HistoryPage, Room, Schedule, UpdateBotRequest } from '../types.ts'
import type { CapabilityFace } from './capability-face.ts'
import css from './Panel.module.css'

export function download(name: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const a = document.createElement('a'); a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function Controls({ state, room, face, updateBot, english, openRoom }: {
  state: BotState; room: Room | undefined; face: CapabilityFace; updateBot(request: UpdateBotRequest): Promise<unknown>; english: boolean; openRoom(room: Room): void
}) {
  const l = (zh: string, en: string) => english ? en : zh
  const [tab, setTab] = useState('history')
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [query, setQuery] = useState(''), [page, setPage] = useState<HistoryPage>()
  const [botId, setBotId] = useState<BotId | undefined>(room?.defaultBot ?? state.bots[0]?.id)
  const bot = state.bots.find(item => item.id === botId)
  const [provider, setProvider] = useState(''), [model, setModel] = useState(''), [tools, setTools] = useState('')
  const [toolMode, setToolMode] = useState<'inherit' | 'none' | 'allow'>('inherit')
  const [fileMode, setFileMode] = useState<'inherit' | 'read-only' | 'workspace-write'>('inherit')
  const [inputPrice, setInputPrice] = useState(''), [outputPrice, setOutputPrice] = useState('')
  const [tokenLimit, setTokenLimit] = useState(String(state.budget?.tokenLimit ?? 0))
  const [costLimit, setCostLimit] = useState(String(state.budget?.costLimit ?? 0))
  const [currency, setCurrency] = useState(state.budget?.currency ?? 'USD')
  const [failures, setFailures] = useState<FailureView[]>([])
  const [name, setName] = useState(''), [prompt, setPrompt] = useState(''), [interval, setInterval] = useState('60')
  const [date, setDate] = useState(new Date(Date.now() + 60000).toISOString().slice(0, 16))
  const [notify, setNotify] = useState(false), [delegate, setDelegate] = useState(false), [editing, setEditing] = useState<string>()
  const [catalog, setCatalog] = useState<CapabilityCatalog>({ providers: [], tools: [] })
  const [budgetScope, setBudgetScope] = useState('*'), [period, setPeriod] = useState<'never' | 'day' | 'month'>('never')
  const [reserveTokens, setReserveTokens] = useState('8192'), [reserveCost, setReserveCost] = useState('0')
  const selectedBudget = budgetScope === '*' ? state.budget : state.botBudgets?.[budgetScope]
  const [calendar, setCalendar] = useState(false), [zone, setZone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [wallTime, setWallTime] = useState('09:00'), [days, setDays] = useState([1, 2, 3, 4, 5])
  const [runs, setRuns] = useState<ScheduleRun[]>([]), [runSchedule, setRunSchedule] = useState('')
  useEffect(() => {
    let active = true
    void face.catalog(botId).then(value => { if (active) setCatalog(value) }).catch(cause => { if (active) setError(String(cause)) })
    return () => { active = false }
  }, [face, botId])
  useEffect(() => {
    setTokenLimit(String(selectedBudget?.tokenLimit ?? 0)); setCostLimit(String(selectedBudget?.costLimit ?? 0)); setCurrency(selectedBudget?.currency ?? 'USD')
    setPeriod(selectedBudget?.period ?? 'never'); setReserveTokens(String(selectedBudget?.reservationTokens ?? 8192)); setReserveCost(String(selectedBudget?.reservationCost ?? 0))
  }, [budgetScope])
  const [confirm, setConfirm] = useState('')
  useEffect(() => {
    setProvider(bot?.policy?.provider ?? ''); setModel(bot?.policy?.model ?? ''); setTools(bot?.policy?.tools?.join('\n') ?? '')
    setToolMode(bot?.policy?.toolMode ?? 'inherit'); setInputPrice(bot?.policy?.inputPrice === undefined ? '' : String(bot.policy.inputPrice))
    setFileMode(bot?.policy?.fileMode ?? 'inherit')
    setOutputPrice(bot?.policy?.outputPrice === undefined ? '' : String(bot.policy.outputPrice))
  }, [bot?.id, bot?.policy?.provider, bot?.policy?.model, bot?.policy?.tools?.join('\n'),
    bot?.policy?.toolMode, bot?.policy?.fileMode, bot?.policy?.inputPrice, bot?.policy?.outputPrice])
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn() } catch (cause) { setError(String(cause instanceof Error ? cause.message : cause)) } finally { setBusy(false) } }
  const editSchedule = (schedule: Schedule) => {
    setCalendar(!!schedule.calendar); setZone(schedule.calendar?.timeZone ?? zone); setWallTime(schedule.calendar?.time ?? '09:00'); setDays(schedule.calendar?.weekdays ?? [1, 2, 3, 4, 5])
    setEditing(schedule.id); setName(schedule.name); setPrompt(schedule.text); setInterval(String(schedule.intervalMinutes))
    setDate(new Date(schedule.nextAt).toISOString().slice(0, 16)); setNotify(schedule.notify); setDelegate(schedule.allowDelegation); setBotId(schedule.targets[0] ?? room?.defaultBot)
  }
  return <div className={css.controls}>
    <nav>{[['history', l('历史', 'History')], ['policy', l('模型与权限', 'Model & tools')], ['budget', l('预算', 'Budget')], ['schedules', l('定时任务', 'Schedules')], ['failures', l('失败投递', 'Failed deliveries')], ['lifecycle', l('归档与删除', 'Archive & delete')]].map(([key, label]) =>
      <Button key={key} size="sm" disabled={busy} onClick={() => { setTab(key!); setError(''); if (key === 'failures') void act(async () => setFailures(await face.failures())) }}>{label}</Button>)}</nav>
    {error && <p role="alert">{error}</p>}
    {tab === 'history' && room && <section>
      <label>{l('搜索聊天原文', 'Search message text')}<Input value={query} onChange={event => setQuery(event.target.value)}/></label>
      <Button disabled={busy} onClick={() => { void act(async () => setPage(await face.history({ roomId: room.id, query, limit: 50 }))) }}>{l('搜索', 'Search')}</Button>
      {(['markdown', 'json'] as const).map(format => <Button key={format} disabled={busy} onClick={() => { void act(async () => download(`chat-${room.id}.${format === 'json' ? 'json' : 'md'}`, await face.exportChat({ roomId: room.id, format }), 'text/plain')) }}>{l('导出', 'Export')} {format}</Button>)}
      {page && <p>{page.total} {l('条结果', 'results')}</p>}
      {page?.messages.map(message => <article key={message.id}><strong>{message.botId ?? l('用户', 'User')} · {new Date(message.time).toLocaleString()}</strong><pre>{message.text}</pre></article>)}
      {page?.before && <Button disabled={busy} onClick={() => { void act(async () => { const next = await face.history({ roomId: room.id, query, before: page.before!, limit: 50 }); setPage({ ...next, messages: [...next.messages, ...page.messages] }) }) }}>{l('更早的结果', 'Earlier results')}</Button>}
    </section>}
    {tab === 'policy' && <section>
      <label>Bot<select value={botId} onChange={event => setBotId(event.target.value as BotId)}>{state.bots.map(bot => <option key={bot.id} value={bot.id}>{bot.name}</option>)}</select></label>
      <label>{l('模型提供方（留空继承 DSH）', 'Provider (blank inherits DSH)')}<Input list="bot-providers" value={provider} onChange={event => setProvider(event.target.value)}/></label>
      <label>{l('模型 ID', 'Model ID')}<Input list="bot-models" value={model} onChange={event => setModel(event.target.value)}/></label>
      <datalist id="bot-providers">{catalog.providers.map(p => <option key={p.id} value={p.id}/>)}</datalist>
      <datalist id="bot-models">{catalog.providers.find(p => p.id === provider)?.models.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</datalist>
      {catalog.providers.find(p => p.id === provider)?.error && <p>{catalog.providers.find(p => p.id === provider)!.error}</p>}
      {toolMode === 'allow' && <details><summary>{l('选择已发现的工具', 'Choose discovered tools')}</summary>{catalog.tools.map(tool => <label key={tool.name} style={{ display: 'block' }} title={tool.description}><input type="checkbox" checked={tools.split(/[\n,]/).includes(tool.name)} onChange={event => setTools(list => event.target.checked ? [...new Set([...list.split(/[\n,]/).filter(Boolean), tool.name])].join('\n') : list.split(/[\n,]/).filter(name => name !== tool.name).join('\n'))}/>{tool.name}</label>)}</details>}
      <label>{l('工具权限', 'Tool permissions')}<select value={toolMode} onChange={event => setToolMode(event.target.value as typeof toolMode)}>
        <option value="inherit">{l('继承部署权限', 'Inherit deployment policy')}</option><option value="none">{l('禁止所有工具', 'No tools')}</option><option value="allow">{l('仅允许列出的工具', 'Allow listed tools only')}</option>
      </select></label>
      <label>{l('文件权限（只能收紧现有沙箱）', 'File policy (only narrows the current sandbox)')}<select value={fileMode} onChange={event => setFileMode(event.target.value as typeof fileMode)}>
        <option value="inherit">{l('继承 DSH', 'Inherit DSH')}</option><option value="read-only">{l('只读', 'Read only')}</option><option value="workspace-write">{l('仅工作目录可写', 'Workspace writes only')}</option>
      </select></label>
      {toolMode === 'allow' && <label>{l('完整工具名，每行一个', 'Exact tool names, one per line')}<textarea value={tools} onChange={event => setTools(event.target.value)}/></label>}
      <p>{l('工具设置只能收紧部署权限。文件目录隔离由 DSH 的沙箱配置负责；需要只读访问时，仅列出部署中实际存在的读取工具。', 'These restrictions only narrow deployment permissions. Filesystem isolation belongs to the DSH sandbox; for read-only access, list only the deployment’s actual read tools.')}</p>
      <label>{l('每百万输入 token 单价（含缓存）', 'Price per million input tokens (including cache)')}<Input type="number" min="0" value={inputPrice} onChange={event => setInputPrice(event.target.value)}/></label>
      <label>{l('每百万输出 token 单价', 'Price per million output tokens')}<Input type="number" min="0" value={outputPrice} onChange={event => setOutputPrice(event.target.value)}/></label>
      <Button disabled={busy || !bot} onClick={() => { if (bot) void act(() => updateBot({ id: bot.id, name: bot.name, instructions: bot.instructions, policy: {
        provider, model, fileMode, toolMode, tools: tools.split(/[\n,]/), ...(inputPrice !== '' ? { inputPrice: Number(inputPrice) } : {}), ...(outputPrice !== '' ? { outputPrice: Number(outputPrice) } : {}),
      } })) }}>{l('保存', 'Save')}</Button>
    </section>}
    {tab === 'budget' && <section>
      <label>{l('预算范围', 'Budget scope')}<select value={budgetScope} onChange={event => setBudgetScope(event.target.value)}><option value="*">{l('全部 Bot', 'All Bots')}</option>{state.bots.map(bot => <option key={bot.id} value={bot.id}>{bot.name}</option>)}</select></label>
      <label>{l('自动清零周期（UTC）', 'Reset period (UTC)')}<select value={period} onChange={event => setPeriod(event.target.value as typeof period)}><option value="never">{l('不自动重置', 'Never')}</option><option value="day">{l('每日', 'Daily')}</option><option value="month">{l('每月', 'Monthly')}</option></select></label>
      <label>{l('每次调用预留 token', 'Reserved tokens per call')}<Input type="number" min="1" value={reserveTokens} onChange={event => setReserveTokens(event.target.value)}/></label>
      <label>{l('每次调用预留费用', 'Reserved cost per call')}<Input type="number" min="0" step="any" value={reserveCost} onChange={event => setReserveCost(event.target.value)}/></label>
      <p>{l('已用', 'Used')}: {selectedBudget?.used.input ?? 0} input + {selectedBudget?.used.output ?? 0} output · {(selectedBudget?.used.cost ?? 0).toFixed(6)} {selectedBudget?.currency ?? 'USD'}</p>
      <label>{l('总 token 上限（0 不限）', 'Total token limit (0 unlimited)')}<Input type="number" min="0" value={tokenLimit} onChange={event => setTokenLimit(event.target.value)}/></label>
      <label>{l('估算费用上限（0 不限）', 'Estimated cost limit (0 unlimited)')}<Input type="number" min="0" value={costLimit} onChange={event => setCostLimit(event.target.value)}/></label>
      <label>{l('币种', 'Currency')}<Input value={currency} onChange={event => setCurrency(event.target.value)}/></label>
      <p>{l('费用按 Bot 单价估算。并发调用先占用预留额度，结算后换成实际用量；实际调用超过预留时仍可能超限，后续调用会暂停。', 'Concurrent calls reserve quota before dispatch. Reported usage replaces the reservation; actual calls can exceed a reservation and block subsequent calls.')}</p>
      <Button disabled={busy} onClick={() => { void act(() => face.configureBudget({ tokenLimit: Number(tokenLimit), costLimit: Number(costLimit), currency, period, reservationTokens: Number(reserveTokens), reservationCost: Number(reserveCost), ...(budgetScope === '*' ? {} : { botId: budgetScope as BotId }) })) }}>{l('保存预算', 'Save budget')}</Button>
      <Button disabled={busy} onClick={() => { if (window.confirm(l('清零累计用量？', 'Reset accumulated usage?'))) void act(() => face.configureBudget({ tokenLimit: Number(tokenLimit), costLimit: Number(costLimit), currency, period, reservationTokens: Number(reserveTokens), reservationCost: Number(reserveCost), ...(budgetScope === '*' ? {} : { botId: budgetScope as BotId }), reset: true })) }}>{l('重置用量', 'Reset usage')}</Button>
    </section>}
    {tab === 'schedules' && room && <section>
      {(state.schedules ?? []).filter(item => item.roomId === room.id).map(schedule => <article key={schedule.id}>
        <strong>{schedule.name}</strong> · {schedule.enabled ? new Date(schedule.nextAt).toLocaleString() : l('已暂停', 'Paused')}
        {schedule.error && <p role="alert">{schedule.error}</p>}
        <Button disabled={busy} onClick={() => { void act(async () => { setRunSchedule(schedule.id); setRuns(await face.scheduleRuns({ id: schedule.id })) }) }}>{l('运行记录', 'Run history')}</Button>
        <Button disabled={busy} onClick={() => editSchedule(schedule)}>{l('编辑', 'Edit')}</Button>
        <Button disabled={busy} onClick={() => { void act(() => face.saveSchedule({ ...schedule, enabled: !schedule.enabled })) }}>{schedule.enabled ? l('暂停', 'Pause') : l('启用', 'Enable')}</Button>
        <Button disabled={busy} onClick={() => { void act(() => face.deleteSchedule(schedule.id)) }}>{l('删除', 'Delete')}</Button>
      </article>)}
      {runSchedule && <section aria-label={l('运行记录', 'Run history')}><h4>{l('运行记录', 'Run history')}</h4>{runs.map(run => <details key={run.messageId}><summary>{new Date(run.time).toLocaleString()} · {run.status}</summary>{run.replies.map((reply, i) => <article key={i}><strong>{reply.botId} · {reply.status}</strong><pre>{reply.text}</pre>{reply.error && <p>{reply.error}</p>}</article>)}</details>)}
        {!!runs.length && <Button disabled={busy} onClick={() => { void act(async () => { const earlier = await face.scheduleRuns({ id: runSchedule, before: runs.at(-1)!.time }); setRuns(current => current.concat(earlier)) }) }}>{l('更早的记录', 'Earlier runs')}</Button>}
      </section>}
      <label><input type="checkbox" checked={calendar} onChange={event => setCalendar(event.target.checked)}/>{l('按日历重复', 'Calendar recurrence')}</label>
      {calendar && <><label>{l('时区', 'Time zone')}<Input list="schedule-zones" value={zone} onChange={event => setZone(event.target.value)}/></label><datalist id="schedule-zones">{['Asia/Shanghai', 'Asia/Tokyo', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'UTC'].map(z => <option key={z} value={z}/>)}</datalist>
        <label>{l('当地时间', 'Local time')}<Input type="time" value={wallTime} onChange={event => setWallTime(event.target.value)}/></label>
        <div>{[1, 2, 3, 4, 5, 6, 7].map(day => <label key={day}><input type="checkbox" checked={days.includes(day)} onChange={event => setDays(old => event.target.checked ? [...old, day] : old.filter(d => d !== day))}/>{english ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][day - 1] : `周${['一', '二', '三', '四', '五', '六', '日'][day - 1]}`}</label>)}</div></>}
      <label>{l('任务名称', 'Task name')}<Input value={name} onChange={event => setName(event.target.value)}/></label>
      <label>{l('任务要求', 'Prompt')}<textarea value={prompt} onChange={event => setPrompt(event.target.value)}/></label>
      <label>Bot<select value={botId} onChange={event => setBotId(event.target.value as BotId)}>{state.bots.filter(bot => room.members.some(member => member.botId === bot.id)).map(bot => <option key={bot.id} value={bot.id}>{bot.name}</option>)}</select></label>
      <label>{l('下次运行时间（UTC）', 'Next run (UTC)')}<Input type="datetime-local" value={date} onChange={event => setDate(event.target.value)}/></label>
      <label>{l('间隔分钟（0 为单次）', 'Interval minutes (0 runs once)')}<Input type="number" min="0" value={interval} onChange={event => setInterval(event.target.value)}/></label>
      <label><input type="checkbox" checked={delegate} onChange={event => setDelegate(event.target.checked)}/>{l('允许群内派活', 'Allow group handoffs')}</label>
      {room.external && <label><input type="checkbox" checked={notify} onChange={event => setNotify(event.target.checked)}/>{l('将任务回复发送到此 IM 会话', 'Send results to this IM chat')}</label>}
      <Button disabled={busy || !name.trim() || !prompt.trim()} onClick={() => { void act(async () => {
        await face.saveSchedule({ ...(editing ? { id: editing } : {}), roomId: room.id, name, text: prompt, targets: botId ? [botId] : [room.defaultBot], nextAt: new Date(date + 'Z').getTime(), intervalMinutes: Number(interval), ...(calendar ? { calendar: { timeZone: zone, time: wallTime, weekdays: days } } : {}), enabled: true, allowDelegation: delegate, notify })
        setEditing(undefined); setName(''); setPrompt('')
      }) }}>{l('保存并启用', 'Save and enable')}</Button>
    </section>}
    {tab === 'failures' && <section>
      <p>{l('包含已停用机器人的失败项；停用时重试会放回队列，启用后再处理。补发只重试选中项；平台未确认送达的消息仍有重复风险。', 'Includes disabled robots. Retrying while disabled restores work to the queue for the next connection. Resend retries only the selected item; unconfirmed deliveries may duplicate.')}</p>
      <Button disabled={busy} onClick={() => { void act(async () => setFailures(await face.failures())) }}>{l('刷新', 'Refresh')}</Button>
      {failures.map(item => <article key={item.queue + item.id}><strong>{item.provider} · {item.destination} · {item.kind} · {item.reason} ({item.attempts})</strong><pre>{item.text}</pre>
        <Button disabled={busy} onClick={() => { void act(async () => { await face.resolveFailure({ ...item, action: 'retry' }); setFailures(await face.failures()) }) }}>{l('重试此项', 'Retry item')}</Button>
        <Button disabled={busy} onClick={() => { void act(async () => { await face.resolveFailure({ ...item, action: 'discard' }); setFailures(await face.failures()) }) }}>{l('丢弃', 'Discard')}</Button>
      </article>)}
    </section>}
    {tab === 'lifecycle' && <section>
      <p>{l('删除清除聊天展示记录；DSH 原生执行记录仍由 DSH 管理。删除前请先导出需要保留的内容。', 'Deletion clears public chat records; native execution logs remain managed by DSH. Export any history you need first.')}</p>
      {[...state.rooms.map(item => ({ kind: 'room' as const, id: item.id, name: item.title, archived: item.archived })),
        ...state.bots.map(item => ({ kind: 'bot' as const, id: item.id, name: '@' + item.id, archived: item.archived }))].map(item =>
        <article key={item.kind + item.id}><strong>{item.name}</strong>
          {item.kind === 'bot' && !item.archived && <Button disabled={busy} onClick={() => { void act(async () => openRoom(await face.openDirect(item.id as BotId))) }}>{l('打开私聊', 'Open direct chat')}</Button>}
          <Button disabled={busy} onClick={() => { void act(() => face.lifecycle({ ...item, action: item.archived ? 'restore' : 'archive' })) }}>{item.archived ? l('恢复', 'Restore') : l('归档', 'Archive')}</Button>
          {confirm === item.kind + item.id ? <><span>{l('确定删除？', 'Confirm deletion?')}</span><Button disabled={busy} onClick={() => { void act(async () => { await face.lifecycle({ ...item, action: 'delete' }); setConfirm('') }) }}>{l('确认删除', 'Delete permanently')}</Button><Button onClick={() => setConfirm('')}>{l('取消', 'Cancel')}</Button></>
            : <Button disabled={busy} onClick={() => setConfirm(item.kind + item.id)}>{l('删除', 'Delete')}</Button>}
        </article>)}
    </section>}
  </div>
}
