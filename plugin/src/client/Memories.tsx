import { useEffect, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { BotState, Room } from '../types.ts'
import type { Memory, MemoryCatalog, MemoryScope, MemorySelection, MemoryStatus, SaveMemoryRequest } from '../memory-types.ts'
import type { CapabilityFace } from './capability-face.ts'
import { KnowledgeControls } from './KnowledgeControls.tsx'
import { MemoryGovernance } from './MemoryGovernance.tsx'
import css from './Panel.module.css'

export function Memories({ state, room, face, english }: { state: BotState; room?: Room | undefined; face: CapabilityFace; english: boolean }) {
  const l = (zh: string, en: string) => english ? en : zh
  const [scope, setScope] = useState<MemoryScope>('global'), [owner, setOwner] = useState('*')
  const [catalog, setCatalog] = useState<MemoryCatalog>({ users: [] }), [items, setItems] = useState<Memory[]>([])
  const [status, setStatus] = useState<MemoryStatus | ''>(''), [query, setQuery] = useState('')
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0)
  const [editing, setEditing] = useState<Memory>(), [kind, setKind] = useState<'preference' | 'fact'>('preference')
  const [subject, setSubject] = useState('response'), [topic, setTopic] = useState(''), [body, setBody] = useState(''), [evidence, setEvidence] = useState('')
  const [effectiveAt, setEffectiveAt] = useState(''), [expiresAt, setExpiresAt] = useState(''), [share, setShare] = useState(false)
  const [previewBot, setPreviewBot] = useState(room?.defaultBot ?? ''), [previewUser, setPreviewUser] = useState('local:operator')
  const [previewQuery, setPreviewQuery] = useState(''), [preview, setPreview] = useState<MemorySelection>()
  const labels = { global: l('全局', 'Global'), bot: 'Bot', group: l('群聊', 'Group'), user: l('用户', 'User') }
  const statuses = { pending: l('待确认', 'Pending'), active: l('生效中', 'Active'), superseded: l('已替代', 'Superseded'), forgotten: l('已遗忘', 'Forgotten') }
  const owners = scope === 'global' ? [{ id: '*', name: l('当前部署的所有 Bot 与聊天', 'All Bots and chats in this deployment') }]
    : scope === 'bot' ? state.bots.map(bot => ({ id: bot.id, name: bot.name + (bot.archived ? l('（已归档）', ' (archived)') : '') }))
    : scope === 'group' ? state.rooms.filter(room => room.kind === 'group' && !room.deleted).map(room => ({ id: room.id, name: room.title })) : catalog.users
  useEffect(() => {
    let active = true
    void face.memoryCatalog().then(value => { if (active) setCatalog(value) }).catch(cause => { if (active) setError(String(cause)) })
    return () => { active = false }
  }, [face, refresh])
  useEffect(() => {
    let active = true
    setItems([])
    if (owner) void face.listMemories({ scope, ownerId: owner, ...(status ? { status } : {}), query }).then(value => { if (active) setItems(value) }).catch(cause => { if (active) setError(String(cause)) })
    return () => { active = false }
  }, [face, scope, owner, status, query, refresh])
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('')
    try { await action(); setRefresh(value => value + 1); setPreview(undefined) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  const reset = () => { setEditing(undefined); setKind('preference'); setSubject('response'); setTopic(''); setBody(''); setEvidence(''); setEffectiveAt(''); setExpiresAt(''); setShare(false) }
  const changeScope = (next: MemoryScope) => {
    setScope(next); setShare(false)
    setOwner(next === 'global' ? '*' : next === 'bot' ? state.bots.find(bot => !bot.archived)?.id ?? ''
      : next === 'group' ? (room?.kind === 'group' ? room.id : state.rooms.find(room => room.kind === 'group' && !room.deleted)?.id ?? '') : 'local:operator')
  }
  const edit = (item: Memory) => {
    setEditing(item); setKind(item.kind); setSubject(item.subject); setTopic(item.topic); setBody(item.body); setEvidence(item.reviewEvidence ?? item.source.evidence); setShare(false)
    setEffectiveAt(item.effectiveAt === undefined ? '' : new Date(item.effectiveAt).toISOString().slice(0, 16))
    setExpiresAt(item.expiresAt === undefined ? '' : new Date(item.expiresAt).toISOString().slice(0, 16))
  }
  const save = () => act(async () => {
    const request: SaveMemoryRequest = { scope, ownerId: owner, kind, subject, topic, body, evidence, share,
      ...(editing ? { id: editing.id, revision: editing.revision } : {}),
      ...(effectiveAt ? { effectiveAt: Date.parse(effectiveAt + 'Z') } : {}), ...(expiresAt ? { expiresAt: Date.parse(expiresAt + 'Z') } : {}) }
    await face.saveMemory(request); reset()
  })
  return <section aria-label={l('长期记忆', 'Long-term memory')}>
    <p>{l('全局提供共同默认值；Bot、群聊、每位用户分别保存自己的记忆。群聊约定优先于个人和 Bot 的默认偏好，事实冲突保留证据待核实。', 'Global memory supplies defaults. Bots, groups and individual users own separate memories. Group conventions override personal and Bot defaults; conflicting facts require verification.')}</p>
    <p>{l('聊天中可让 Bot 提取记忆候选，确认后生效。用户记忆默认仅用于本人私聊，跨群使用或提升为全局需要显式共享。', 'Ask a Bot to propose lasting memories, then review them here. Personal memories default to private chats; sharing or promotion to global must be explicit.')}</p>
    <KnowledgeControls face={face} english={english} catalog={catalog} refresh={() => setRefresh(value => value + 1)}/>
    {error && <p role="alert" className={css.controlError}>{error}</p>}
    <label>{l('记忆范围', 'Memory scope')}<select disabled={busy} value={scope} onChange={event => changeScope(event.target.value as MemoryScope)}>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    <label>{l('所属对象', 'Memory owner')}<select disabled={busy} value={owner} onChange={event => { setOwner(event.target.value); setShare(false) }}>{owners.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <MemoryGovernance state={state} face={face} scope={scope} ownerId={owner} english={english} revision={refresh} refresh={() => setRefresh(value => value + 1)}/>
    <label>{l('记忆状态', 'Memory status')}<select value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="">{l('全部', 'All')}</option>{(['pending', 'active', 'superseded'] as const).map(key => <option key={key} value={key}>{statuses[key]}</option>)}</select></label>
    <label>{l('搜索记忆', 'Search memories')}<Input value={query} onChange={event => setQuery(event.target.value)}/></label>
    <Button size="sm" disabled={busy} onClick={() => setRefresh(value => value + 1)}>{l('刷新', 'Refresh')}</Button>
    {!items.length && <p>{l('此范围暂无记忆。', 'No memories in this scope.')}</p>}
    {items.map(item => <article key={item.id} className={css.memoryCard}>
      <strong>{item.subject} · {item.topic}</strong><span>{statuses[item.status]} · {item.kind === 'fact' ? l('事实', 'Fact') : l('偏好/约定', 'Preference/convention')}</span>
      <p>{item.body}</p>
      <small>{item.access === 'private' ? l('仅本人私聊', 'Private chats only') : item.access === 'source-room' ? l('仅来源聊天', 'Source chat only') : l('在所属范围内共享', 'Shared within scope')} · {new Date(item.updatedAt).toLocaleString()}</small>
      {item.effectiveAt !== undefined && <small>{l('生效', 'Effective')}: {new Date(item.effectiveAt).toLocaleString()}</small>}
      {item.expiresAt !== undefined && <small>{l('到期', 'Expires')}: {new Date(item.expiresAt).toLocaleString()}</small>}
      <details><summary>{l('来源与证据', 'Source & evidence')}</summary><p>{item.source.evidence || l('管理端录入', 'Entered by operator')}</p>
        {item.reviewEvidence && <p>{l('修订依据', 'Revision evidence')}: {item.reviewEvidence}</p>}
        {item.source.roomId && <small>{state.rooms.find(room => room.id === item.source.roomId)?.title ?? item.source.roomId} · {item.source.messageId}</small>}
        <small>{l('记录', 'Record')}: {item.id}{item.supersedes ? ` ← ${item.supersedes}` : ''}</small>
      </details>
      {(item.status === 'active' || item.status === 'pending') && <div className={css.controlActions}>
        {item.status === 'pending' && <Button size="sm" disabled={busy} onClick={() => { void act(() => face.memoryAction({ id: item.id, revision: item.revision, action: 'approve' })) }}>{l('确认生效', 'Approve')}</Button>}
        <Button size="sm" disabled={busy} onClick={() => edit(item)}>{l('编辑 / 共享', 'Edit / share')}</Button>
        <Button size="sm" disabled={busy} className={css.dangerButton} onClick={() => { if (window.confirm(l('遗忘这条记忆及其旧版本？受影响的 Bot 执行将停止，下次请求会建立新上下文。历史聊天和执行记录会保留。', 'Forget this memory and its older versions? Affected Bot executions will stop and future requests get fresh context. Existing chat and execution logs are retained.'))) void act(() => face.memoryAction({ id: item.id, revision: item.revision, action: 'forget' })) }}>{l('遗忘', 'Forget')}</Button>
      </div>}
    </article>)}
    <h4>{editing ? l('编辑记忆（切换范围可共享副本）', 'Edit memory (change scope to share a copy)') : l('添加记忆', 'Add memory')}</h4>
    <label>{l('类型', 'Memory type')}<select value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="preference">{l('偏好 / 约定', 'Preference / convention')}</option><option value="fact">{l('事实', 'Fact')}</option></select></label>
    <label>{l('主体 / 环境', 'Subject / environment')}<Input maxLength={160} value={subject} onChange={event => setSubject(event.target.value)}/></label>
    <label>{l('主题键（同一属性使用同一名称）', 'Topic key (reuse for the same attribute)')}<Input maxLength={120} placeholder="language / release-date" value={topic} onChange={event => setTopic(event.target.value)}/></label>
    <label>{l('内容', 'Memory content')}<textarea maxLength={1500} value={body} onChange={event => setBody(event.target.value)}/></label>
    <label>{l('证据 / 来源（事实必填）', 'Evidence / source (required for facts)')}<textarea maxLength={1500} value={evidence} onChange={event => setEvidence(event.target.value)}/></label>
    <label>{l('生效时间（UTC，可留空）', 'Effective time (UTC, optional)')}<Input type="datetime-local" value={effectiveAt} onChange={event => setEffectiveAt(event.target.value)}/></label>
    <label>{l('到期时间（UTC，可留空）', 'Expiry (UTC, optional)')}<Input type="datetime-local" value={expiresAt} onChange={event => setExpiresAt(event.target.value)}/></label>
    {(scope === 'user' || editing) && <label className={css.checkOption}><input type="checkbox" checked={share} onChange={event => setShare(event.target.checked)}/>{l('允许在所选范围内共享，包含该范围内的群聊', 'Allow sharing throughout the selected scope, including its group chats')}</label>}
    <div className={css.controlActions}><Button variant="primary" disabled={busy || !owner || !subject.trim() || !topic.trim() || !body.trim() || kind === 'fact' && !evidence.trim()} onClick={() => { void save() }}>{l('保存并生效', 'Save & activate')}</Button>{editing && <Button disabled={busy} onClick={reset}>{l('取消编辑', 'Cancel edit')}</Button>}</div>
    {room && <details><summary>{l('预览当前聊天会加载的记忆', 'Preview recall for this chat')}</summary>
      <label>{l('回复 Bot', 'Responding Bot')}<select value={previewBot} onChange={event => setPreviewBot(event.target.value)}>{room.members.map(member => <option key={member.botId} value={member.botId}>{state.bots.find(bot => bot.id === member.botId)?.name ?? member.botId}</option>)}</select></label>
      <label>{l('当前说话用户', 'Current speaker')}<select value={previewUser} onChange={event => setPreviewUser(event.target.value)}><option value="">{l('无个人身份（定时任务）', 'No personal identity (scheduled task)')}</option>{catalog.users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
      <label>{l('检索问题', 'Recall query')}<Input value={previewQuery} onChange={event => setPreviewQuery(event.target.value)}/></label>
      <Button disabled={busy} onClick={() => { setBusy(true); setError(''); void face.previewMemories({ roomId: room.id, botId: previewBot, ...(previewUser ? { userId: previewUser } : {}), query: previewQuery }).then(setPreview).catch(cause => setError(String(cause))).finally(() => setBusy(false)) }}>{l('预览', 'Preview')}</Button>
      {preview && <div aria-live="polite"><p>{preview.records.length} {l('条记忆', 'memories')} · {preview.conflicts.length} {l('组冲突，需核实', 'conflicts requiring verification')} · {preview.omitted} {l('条超出预算未加载', 'omitted by context budget')}</p>{preview.records.map(item => <p key={item.id}>{labels[item.scope]} · {item.topic}: {item.body}{preview.conflicts.some(ids => ids.includes(item.id)) ? ` · ${l('待核实', 'Verify')}` : ''}</p>)}</div>}
    </details>}
  </section>
}
