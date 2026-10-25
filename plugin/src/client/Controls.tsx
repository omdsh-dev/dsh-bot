/** Explicit controls for lifecycle, execution policy, automation and retained delivery failures. */
import { useEffect, useRef, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CapabilityCatalog, ScheduleRun, BotId, BotState, FailureView, Room, Schedule, UpdateBotRequest } from '../types.ts'
import type { CapabilityFace } from './capability-face.ts'
import css from './Panel.module.css'
import { Memories } from './Memories.tsx'
import { AccessControls } from './AccessControls.tsx'
import { TeamControls } from './TeamControls.tsx'
import { SettingsHome, settingsSections } from './SettingsHome.tsx'
import { HistoryBrowser } from './HistoryBrowser.tsx'
import { ModelPicker, ToolPicker } from './ModelPicker.tsx'

function localDateTime(time = Date.now() + 60000): string {
  return new Date(time - new Date(time).getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
export function download(name: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }))
  const a = document.createElement('a'); a.href = url; a.download = name; a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function Controls({ state, room, face, updateBot, english, openRoom, initialTab = 'overview' }: {
  state: BotState; room: Room | undefined; face: CapabilityFace; updateBot(request: UpdateBotRequest): Promise<unknown>; english: boolean; openRoom(room: Room): void; initialTab?: string
}) {
  const l = (zh: string, en: string) => english ? en : zh
  const [tab, setTab] = useState(initialTab), [more, setMore] = useState(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const current = settingsSections(english).find(item => item.id === tab)
  const [saved, setSaved] = useState(''), [scheduleForm, setScheduleForm] = useState(false)
  useEffect(() => { heading.current?.focus(); heading.current?.closest(`.${css.settingsScroll}`)?.scrollTo?.({ top: 0 }) }, [tab])
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
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
  const [name, setName] = useState(''), [prompt, setPrompt] = useState(''), [interval, setInterval] = useState('0')
  const [date, setDate] = useState(localDateTime)
  const [notify, setNotify] = useState(false), [delegate, setDelegate] = useState(false), [editing, setEditing] = useState<string>()
  const [catalog, setCatalog] = useState<CapabilityCatalog>({ providers: [], tools: [] })
  const [catalogLoading, setCatalogLoading] = useState(initialTab === 'policy'), [catalogError, setCatalogError] = useState(''), [catalogRefresh, setCatalogRefresh] = useState(0)
  const [budgetScope, setBudgetScope] = useState('*'), [period, setPeriod] = useState<'never' | 'day' | 'month'>('never')
  const [reserveTokens, setReserveTokens] = useState('8192'), [reserveCost, setReserveCost] = useState('0')
  const selectedBudget = budgetScope === '*' ? state.budget : state.botBudgets?.[budgetScope]
  const [repeat, setRepeat] = useState<'once' | 'interval' | 'week'>('once'), [zone, setZone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone)
  const calendar = repeat === 'week'
  const [wallTime, setWallTime] = useState('09:00'), [days, setDays] = useState([1, 2, 3, 4, 5])
  const [runs, setRuns] = useState<ScheduleRun[]>([]), [runSchedule, setRunSchedule] = useState('')
  useEffect(() => {
    if (tab !== 'policy') return
    let active = true
    setCatalog({ providers: [], tools: [] }); setCatalogLoading(true); setCatalogError('')
    void face.catalog(botId).then(value => { if (active) setCatalog(value) }).catch(cause => { if (active) setCatalogError(String(cause)) }).finally(() => { if (active) setCatalogLoading(false) })
    return () => { active = false }
  }, [face, botId, tab, catalogRefresh])
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
  const act = async (fn: () => Promise<unknown>, message = '') => { setBusy(true); setError(''); setSaved(''); try { await fn(); setSaved(message) } catch (cause) { setError(String(cause instanceof Error ? cause.message : cause)) } finally { setBusy(false) } }
  const editSchedule = (schedule: Schedule) => {
    setScheduleForm(true)
    setRepeat(schedule.calendar ? 'week' : schedule.intervalMinutes > 0 ? 'interval' : 'once'); setZone(schedule.calendar?.timeZone ?? zone); setWallTime(schedule.calendar?.time ?? '09:00'); setDays(schedule.calendar?.weekdays ?? [1, 2, 3, 4, 5])
    setEditing(schedule.id); setName(schedule.name); setPrompt(schedule.text); setInterval(String(schedule.intervalMinutes))
    setDate(localDateTime(schedule.nextAt)); setNotify(schedule.notify); setDelegate(schedule.allowDelegation); setBotId(schedule.targets[0] ?? room?.defaultBot)
  }
  return <div className={css.controls}>
    {tab !== 'overview' && <div className={css.controlActions}><Button size="sm" disabled={busy} onClick={() => { setTab('overview'); setError(''); setSaved('') }}>{l('‹ 返回设置', 'Back to settings')}</Button></div>}
    <header className={css.settingsHeading}>
      <h3 ref={heading} tabIndex={-1}>{current?.title ?? l('你想调整什么？', 'What would you like to change?')}</h3>
      <p>{current?.description ?? l('选择一项开始，设置会在保存后生效。', 'Choose a topic to get started. Changes take effect when saved.')}</p>
      {current?.needsRoom && room && <span className={css.settingsScope}>{l('当前聊天：', 'Current chat: ')}{room.title}</span>}
    </header>
    {tab === 'overview' && <SettingsHome english={english} room={room} more={more} setMore={setMore} open={key => { if (key === 'policy') setCatalogLoading(true); setTab(key); setError(''); setSaved(''); if (key === 'failures') void act(async () => setFailures(await face.failures())) }}/>}
    {saved && <p role="status" className={css.savedNotice}>{saved}</p>}
    {current?.needsRoom && !room && <p>{l('先关闭设置并打开一个聊天，再来这里操作。', 'Close settings and open a chat first.')}</p>}
    {error && <p className={css.controlError} role="alert">{error}</p>}
    {tab === 'memories' && <Memories key={room?.id ?? 'global'} state={state} room={room} face={face} english={english}/>}
    {tab === 'history' && room && <HistoryBrowser key={room.id} room={room} bots={state.bots} face={face} english={english} exporting={busy} exportChat={format => { void act(async () => download(`chat-${room.id}.${format === 'json' ? 'json' : 'md'}`, await face.exportChat({ roomId: room.id, format }), 'text/plain')) }}/>}
    {tab === 'access' && <AccessControls state={state} face={face} english={english}/>}
    {tab === 'team' && <TeamControls state={state} face={face} english={english}/>}
    {tab === 'policy' && <section>
      <label>Bot<select value={botId} onChange={event => { setCatalogLoading(true); setBotId(event.target.value as BotId) }}>{state.bots.map(bot => <option key={bot.id} value={bot.id}>{bot.name}</option>)}</select></label>
      {catalogError && <p role="alert">{l('无法读取模型和工具列表：', 'Could not load models and tools: ')}{catalogError} <Button onClick={() => setCatalogRefresh(value => value + 1)}>{l('重试', 'Retry')}</Button></p>}
      <ModelPicker key={botId} providers={catalog.providers} provider={provider} model={model} loading={catalogLoading} english={english} select={(nextProvider, nextModel) => { setProvider(nextProvider); setModel(nextModel) }}/>
      <details><summary>{l('工具和文件权限', 'Tool and file permissions')}</summary><div className={css.settingsFields}>
      <label>{l('工具权限', 'Tool permissions')}<select value={toolMode} onChange={event => setToolMode(event.target.value as typeof toolMode)}>
        <option value="inherit">{l('继承部署权限', 'Inherit deployment policy')}</option><option value="none">{l('禁止所有工具', 'No tools')}</option><option value="allow">{l('仅允许列出的工具', 'Allow listed tools only')}</option>
      </select></label>
      <label>{l('文件权限（只能收紧现有沙箱）', 'File policy (only narrows the current sandbox)')}<select value={fileMode} onChange={event => setFileMode(event.target.value as typeof fileMode)}>
        <option value="inherit">{l('继承 DSH', 'Inherit DSH')}</option><option value="read-only">{l('只读', 'Read only')}</option><option value="workspace-write">{l('仅工作目录可写', 'Workspace writes only')}</option>
      </select></label>
      <ToolPicker key={botId} available={catalog.tools} value={tools} change={setTools} editable={toolMode === 'allow'} loading={catalogLoading} english={english}/>
      <p>{l('工具设置只能收紧部署权限。文件目录隔离由 DSH 的沙箱配置负责；需要只读访问时，仅列出部署中实际存在的读取工具。', 'These restrictions only narrow deployment permissions. Filesystem isolation belongs to the DSH sandbox; for read-only access, list only the deployment’s actual read tools.')}</p>
      </div></details>
      <details><summary>{l('费用估算单价（可选）', 'Prices for cost estimates (optional)')}</summary><div className={css.settingsFields}>
        <p>{l('只影响用量页面的费用估算。需要费用限额时再填写。', 'Used to estimate costs on the Usage page. Configure prices before enabling a cost limit.')}</p>
      <label>{l('每百万输入 token 单价（含缓存）', 'Price per million input tokens (including cache)')}<Input type="number" min="0" value={inputPrice} onChange={event => setInputPrice(event.target.value)}/></label>
      <label>{l('每百万输出 token 单价', 'Price per million output tokens')}<Input type="number" min="0" value={outputPrice} onChange={event => setOutputPrice(event.target.value)}/></label>
      </div></details>
      <Button variant="primary" disabled={busy || !bot} onClick={() => { if (bot) void act(() => updateBot({ id: bot.id, name: bot.name, instructions: bot.instructions, policy: {
        provider, model, fileMode, toolMode, tools: tools.split(/[\n,]/), ...(inputPrice !== '' ? { inputPrice: Number(inputPrice) } : {}), ...(outputPrice !== '' ? { outputPrice: Number(outputPrice) } : {}),
      } }), l('已保存，下次对话使用新设置。', 'Saved. The next conversation will use these settings.')) }}>{l('保存模型设置', 'Save model settings')}</Button>
    </section>}
    {tab === 'budget' && <section>
      <label>{l('预算范围', 'Budget scope')}<select value={budgetScope} onChange={event => setBudgetScope(event.target.value)}><option value="*">{l('全部 Bot', 'All Bots')}</option>{state.bots.map(bot => <option key={bot.id} value={bot.id}>{bot.name}</option>)}</select></label>
      <label>{l('额度多久重置一次（UTC）', 'When limits reset (UTC)')}<select value={period} onChange={event => setPeriod(event.target.value as typeof period)}><option value="never">{l('不自动重置', 'Never')}</option><option value="day">{l('每日', 'Daily')}</option><option value="month">{l('每月', 'Monthly')}</option></select></label>
      <p>{l('已用', 'Used')}: {selectedBudget?.used.input ?? 0} input + {selectedBudget?.used.output ?? 0} output · {(selectedBudget?.used.cost ?? 0).toFixed(6)} {selectedBudget?.currency ?? 'USD'}</p>
      <label>{l('Token 上限（填 0 表示不限）', 'Token limit (0 means unlimited)')}<Input type="number" min="0" value={tokenLimit} onChange={event => setTokenLimit(event.target.value)}/></label>
      <label>{l('费用上限（填 0 表示不限）', 'Cost limit (0 means unlimited)')}<Input type="number" min="0" value={costLimit} onChange={event => setCostLimit(event.target.value)}/></label>
      <label>{l('币种', 'Currency')}<Input value={currency} onChange={event => setCurrency(event.target.value)}/></label>
      <details><summary>{l('高级：并发调用的预留额度', 'Advanced: reservations for concurrent calls')}</summary><div className={css.settingsFields}>
      <label>{l('每次调用预留 token', 'Reserved tokens per call')}<Input type="number" min="1" value={reserveTokens} onChange={event => setReserveTokens(event.target.value)}/></label>
      <label>{l('每次调用预留费用', 'Reserved cost per call')}<Input type="number" min="0" step="any" value={reserveCost} onChange={event => setReserveCost(event.target.value)}/></label>
      <p>{l('费用按 Bot 单价估算。并发调用先占用预留额度，结算后换成实际用量；实际调用超过预留时仍可能超限，后续调用会暂停。', 'Concurrent calls reserve quota before dispatch. Reported usage replaces the reservation; actual calls can exceed a reservation and block subsequent calls.')}</p>
      </div></details>
      <div className={css.controlActions}>
        <Button variant="primary" disabled={busy} onClick={() => { void act(() => face.configureBudget({ tokenLimit: Number(tokenLimit), costLimit: Number(costLimit), currency, period, reservationTokens: Number(reserveTokens), reservationCost: Number(reserveCost), ...(budgetScope === '*' ? {} : { botId: budgetScope as BotId }) }), l('用量限额已保存。', 'Usage limits saved.')) }}>{l('保存限额', 'Save limits')}</Button>
        <Button disabled={busy} onClick={() => { if (window.confirm(l('清零累计用量？', 'Reset accumulated usage?'))) void act(() => face.configureBudget({ tokenLimit: Number(tokenLimit), costLimit: Number(costLimit), currency, period, reservationTokens: Number(reserveTokens), reservationCost: Number(reserveCost), ...(budgetScope === '*' ? {} : { botId: budgetScope as BotId }), reset: true })) }}>{l('重置用量', 'Reset usage')}</Button>
      </div>
    </section>}
    {tab === 'schedules' && room && <section>
      {(state.schedules ?? []).filter(item => item.roomId === room.id).map(schedule => <article key={schedule.id}>
        <strong>{schedule.name}</strong> · {schedule.enabled ? new Date(schedule.nextAt).toLocaleString() : l('已暂停', 'Paused')}
        {schedule.error && <p role="alert">{schedule.error}</p>}
        <div className={css.controlActions}>
          <Button size="sm" disabled={busy} onClick={() => { void act(async () => { setRunSchedule(schedule.id); setRuns(await face.scheduleRuns({ id: schedule.id })) }) }}>{l('运行记录', 'Run history')}</Button>
          <Button size="sm" disabled={busy} onClick={() => editSchedule(schedule)}>{l('编辑', 'Edit')}</Button>
          <Button size="sm" disabled={busy} onClick={() => { void act(() => face.saveSchedule({ ...schedule, enabled: !schedule.enabled })) }}>{schedule.enabled ? l('暂停', 'Pause') : l('启用', 'Enable')}</Button>
          <Button className={css.dangerButton} size="sm" disabled={busy} onClick={() => { void act(() => face.deleteSchedule(schedule.id)) }}>{l('删除', 'Delete')}</Button>
        </div>
      </article>)}
      {runSchedule && <section aria-label={l('运行记录', 'Run history')}><h4>{l('运行记录', 'Run history')}</h4>{runs.map(run => <details key={run.messageId}><summary>{new Date(run.time).toLocaleString()} · {run.status}</summary>{run.replies.map((reply, i) => <article key={i}><strong>{reply.botId} · {reply.status}</strong><pre>{reply.text}</pre>{reply.error && <p>{reply.error}</p>}</article>)}</details>)}
        {!!runs.length && <Button disabled={busy} onClick={() => { void act(async () => { const earlier = await face.scheduleRuns({ id: runSchedule, before: runs.at(-1)!.time }); setRuns(current => current.concat(earlier)) }) }}>{l('更早的记录', 'Earlier runs')}</Button>}
      </section>}
      {!scheduleForm && <><p>{(state.schedules ?? []).some(item => item.roomId === room.id) ? l('可以编辑已有任务，也可以添加一个新任务。', 'Edit an existing task or add a new one.') : l('还没有定时任务。例如：每个工作日上午 9 点整理待办。', 'No schedules yet. Try a weekday task that reviews your to-dos at 9 am.')}</p><Button variant="primary" disabled={busy} onClick={() => { setEditing(undefined); setName(''); setPrompt(''); setNotify(false); setDelegate(false); setRepeat('once'); setInterval('0'); setBotId(room.defaultBot); setDate(localDateTime()); setScheduleForm(true) }}>{l('添加定时任务', 'Add schedule')}</Button></>}
      {scheduleForm && <div className={css.settingsFields}>
      <h4>{editing ? l('编辑任务', 'Edit schedule') : l('新定时任务', 'New schedule')}</h4>
      <label>{l('任务名称', 'Task name')}<Input value={name} onChange={event => setName(event.target.value)}/></label>
      <label>{l('任务要求', 'Prompt')}<textarea value={prompt} onChange={event => setPrompt(event.target.value)}/></label>
      <label>Bot<select value={botId} onChange={event => setBotId(event.target.value as BotId)}>{state.bots.filter(bot => room.members.some(member => member.botId === bot.id)).map(bot => <option key={bot.id} value={bot.id}>{bot.name}</option>)}</select></label>
      <label>{l('重复方式', 'Repeat')}<select value={repeat} onChange={event => { setRepeat(event.target.value as typeof repeat); setInterval(event.target.value === 'interval' ? '60' : '0') }}>
        <option value="once">{l('只运行一次', 'Once')}</option><option value="interval">{l('固定间隔', 'At regular intervals')}</option><option value="week">{l('按星期重复', 'On selected weekdays')}</option>
      </select></label>
      {calendar && <><label>{l('时区', 'Time zone')}<Input list="schedule-zones" value={zone} onChange={event => setZone(event.target.value)}/></label><datalist id="schedule-zones">{['Asia/Shanghai', 'Asia/Tokyo', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'UTC'].map(z => <option key={z} value={z}/>)}</datalist>
        <label>{l('当地时间', 'Local time')}<Input type="time" value={wallTime} onChange={event => setWallTime(event.target.value)}/></label>
        <div className={css.weekdays}>{[1, 2, 3, 4, 5, 6, 7].map(day => <label className={css.checkOption} key={day}><input type="checkbox" checked={days.includes(day)} onChange={event => setDays(old => event.target.checked ? [...old, day] : old.filter(d => d !== day))}/>{english ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][day - 1] : `周${['一', '二', '三', '四', '五', '六', '日'][day - 1]}`}</label>)}</div></>}
      {!calendar && <label>{l('运行时间（本地时间）', 'Run time (your local time)')}<Input type="datetime-local" value={date} onChange={event => setDate(event.target.value)}/></label>}
      {repeat === 'interval' && <label>{l('每隔多少分钟', 'Minutes between runs')}<Input type="number" min="1" value={interval} onChange={event => setInterval(event.target.value)}/></label>}
      {room.kind === 'group' && <label className={css.checkOption}><input type="checkbox" checked={delegate} onChange={event => setDelegate(event.target.checked)}/>{l('允许群内派活', 'Allow group handoffs')}</label>}
      {room.external && <label className={css.checkOption}><input type="checkbox" checked={notify} onChange={event => setNotify(event.target.checked)}/>{l('将任务回复发送到此 IM 会话', 'Send results to this IM chat')}</label>}
      <Button variant="primary" disabled={busy || !name.trim() || !prompt.trim() || repeat === 'interval' && !(Number(interval) >= 1) || !calendar && !Number.isFinite(new Date(date).getTime())} onClick={() => { void act(async () => {
        await face.saveSchedule({ ...(editing ? { id: editing } : {}), roomId: room.id, name, text: prompt, targets: botId ? [botId] : [room.defaultBot], nextAt: calendar ? Date.now() : new Date(date).getTime(), intervalMinutes: Number(interval), ...(calendar ? { calendar: { timeZone: zone, time: wallTime, weekdays: days } } : {}), enabled: true, allowDelegation: delegate, notify })
        setEditing(undefined); setName(''); setPrompt(''); setScheduleForm(false)
      }, l('定时任务已启用。', 'Schedule enabled.')) }}>{l('保存并启用', 'Save and enable')}</Button>
      <Button disabled={busy} onClick={() => setScheduleForm(false)}>{l('取消', 'Cancel')}</Button>
      </div>}
    </section>}
    {tab === 'failures' && <section>
      <p>{l('包含已停用机器人的失败项；停用时重试会放回队列，启用后再处理。补发只重试选中项；平台未确认送达的消息仍有重复风险。', 'Includes disabled robots. Retrying while disabled restores work to the queue for the next connection. Resend retries only the selected item; unconfirmed deliveries may duplicate.')}</p>
      <Button disabled={busy} onClick={() => { void act(async () => setFailures(await face.failures())) }}>{l('刷新', 'Refresh')}</Button>
      {!busy && !error && !failures.length && <p>{l('没有需要处理的失败消息。', 'No failed messages need attention.')}</p>}
      {failures.map(item => <article key={item.queue + item.id}><strong>{item.provider} · {item.destination} · {item.kind} · {item.reason} ({item.attempts})</strong><pre>{item.text}</pre>
        <div className={css.controlActions}><Button size="sm" disabled={busy} onClick={() => { void act(async () => { await face.resolveFailure({ ...item, action: 'retry' }); setFailures(await face.failures()) }) }}>{l('重试此项', 'Retry item')}</Button>
        <Button disabled={busy} onClick={() => { void act(async () => { await face.resolveFailure({ ...item, action: 'discard' }); setFailures(await face.failures()) }) }}>{l('丢弃', 'Discard')}</Button></div>
      </article>)}
    </section>}
    {tab === 'lifecycle' && <section>
      <p>{l('删除清除聊天展示记录；DSH 原生执行记录仍由 DSH 管理。删除前请先导出需要保留的内容。', 'Deletion clears public chat records; native execution logs remain managed by DSH. Export any history you need first.')}</p>
      {[...state.rooms.map(item => ({ kind: 'room' as const, id: item.id, name: item.title, archived: item.archived })),
        ...state.bots.map(item => ({ kind: 'bot' as const, id: item.id, name: '@' + item.id, archived: item.archived }))].map(item =>
        <article key={item.kind + item.id}><strong>{item.name}</strong><div className={css.controlActions}>
          {item.kind === 'bot' && !item.archived && <Button size="sm" disabled={busy} onClick={() => { void act(async () => openRoom(await face.openDirect(item.id as BotId))) }}>{l('打开私聊', 'Open direct chat')}</Button>}
          <Button size="sm" disabled={busy} onClick={() => { void act(() => face.lifecycle({ ...item, action: item.archived ? 'restore' : 'archive' })) }}>{item.archived ? l('恢复', 'Restore') : l('归档', 'Archive')}</Button>
          {confirm === item.kind + item.id ? <><span>{l('确定删除？', 'Confirm deletion?')}</span><Button className={css.dangerButton} size="sm" disabled={busy} onClick={() => { void act(async () => { await face.lifecycle({ ...item, action: 'delete' }); setConfirm('') }) }}>{l('确认删除', 'Delete permanently')}</Button><Button size="sm" onClick={() => setConfirm('')}>{l('取消', 'Cancel')}</Button></>
            : <Button className={css.dangerButton} size="sm" disabled={busy} onClick={() => setConfirm(item.kind + item.id)}>{l('删除', 'Delete')}</Button>}</div>
        </article>)}
    </section>}
  </div>
}
