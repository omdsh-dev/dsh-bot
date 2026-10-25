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
  const [viewScope, setViewScope] = useState<MemoryScope | 'all'>('all'), [viewOwner, setViewOwner] = useState('')
  const [loading, setLoading] = useState(true), [listError, setListError] = useState(''), [limit, setLimit] = useState(20)
  const [catalog, setCatalog] = useState<MemoryCatalog>({ users: [] }), [items, setItems] = useState<Memory[]>([])
  const [status, setStatus] = useState<MemoryStatus | ''>(''), [query, setQuery] = useState('')
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [refresh, setRefresh] = useState(0)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Memory>(), [kind, setKind] = useState<'preference' | 'fact'>('preference')
  const [subject, setSubject] = useState('response'), [topic, setTopic] = useState(''), [body, setBody] = useState(''), [evidence, setEvidence] = useState('')
  const [effectiveAt, setEffectiveAt] = useState(''), [expiresAt, setExpiresAt] = useState(''), [share, setShare] = useState(false)
  const [previewBot, setPreviewBot] = useState(room?.defaultBot ?? ''), [previewUser, setPreviewUser] = useState('local:operator')
  const [previewQuery, setPreviewQuery] = useState(''), [preview, setPreview] = useState<MemorySelection>()
  const labels = { global: l('所有 Bot 通用', 'All Bots'), bot: l('某个 Bot', 'One Bot'), group: l('某个群聊', 'One group'), user: l('某位用户', 'One person') }
  const scopeHelp = { global: l('这里的记忆是所有 Bot 的共同默认约定。', 'These are shared defaults for every Bot.'), bot: l('只给选中的 Bot 使用，不会分享给其他 Bot。', 'Only the selected Bot can use these memories.'), group: l('只在选中的群聊中使用，适合团队约定。', 'Used only in the selected group, for shared conventions.'), user: l('保存这个人的偏好，默认只用于本人私聊。', 'This person’s preferences, private to their direct chats by default.') }
  const statuses = { pending: l('待确认', 'Pending'), active: l('生效中', 'Active'), superseded: l('已替代', 'Superseded'), forgotten: l('已遗忘', 'Forgotten') }
  const ownersFor = (selected: MemoryScope) => selected === 'global' ? [{ id: '*', name: l('当前部署的所有 Bot 与聊天', 'All Bots and chats in this deployment') }]
    : selected === 'bot' ? state.bots.map(bot => ({ id: bot.id, name: bot.name + (bot.archived ? l('（已归档）', ' (archived)') : '') }))
    : selected === 'group' ? state.rooms.filter(room => room.kind === 'group' && !room.deleted).map(room => ({ id: room.id, name: room.title })) : catalog.users
  const owners = ownersFor(scope)
  const filtered = viewScope !== 'all' || !!status || !!query
  useEffect(() => {
    let active = true
    void face.memoryCatalog().then(value => { if (active) setCatalog(value) }).catch(cause => { if (active) setError(String(cause)) })
    return () => { active = false }
  }, [face, refresh])
  useEffect(() => {
    let active = true
    setItems([]); setLoading(true); setListError(''); setLimit(20)
    void face.listMemories({ ...(viewScope !== 'all' ? { scope: viewScope } : {}), ...(viewOwner ? { ownerId: viewOwner } : {}), ...(status ? { status } : {}), query }).then(value => { if (active) setItems(value) }).catch(cause => { if (active) setListError(String(cause)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [face, viewScope, viewOwner, status, query, refresh])
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('')
    try { await action(); setRefresh(value => value + 1); setPreview(undefined) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  const reset = () => { setFormOpen(false); setEditing(undefined); setKind('preference'); setSubject('response'); setTopic(''); setBody(''); setEvidence(''); setEffectiveAt(''); setExpiresAt(''); setShare(false) }
  const changeScope = (next: MemoryScope) => {
    setScope(next); setShare(false)
    setOwner(next === 'global' ? '*' : next === 'bot' ? state.bots.find(bot => !bot.archived)?.id ?? ''
      : next === 'group' ? (room?.kind === 'group' ? room.id : state.rooms.find(room => room.kind === 'group' && !room.deleted)?.id ?? '') : 'local:operator')
  }
  const edit = (item: Memory) => {
    setScope(item.scope); setOwner(item.ownerId)
    setFormOpen(true); setEditing(item); setKind(item.kind); setSubject(item.subject); setTopic(item.topic); setBody(item.body); setEvidence(item.reviewEvidence ?? item.source.evidence); setShare(false)
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
    {!formOpen && <p>{l('可以直接在聊天中说“记住：我喜欢简短的回答”。Bot 提出的记忆会在这里等你确认。', 'Say “Remember: I prefer short answers” in a chat. Review the Bot’s proposed memories here before they take effect.')}</p>}
    {error && <p role="alert" className={css.controlError}>{error}</p>}
    {formOpen && <><label>{l('这些记忆给谁用？', 'Who are these memories for?')}<select disabled={busy} value={scope} onChange={event => changeScope(event.target.value as MemoryScope)}>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    {scope !== 'global' && <label>{l('选择对象', 'Choose an owner')}<select disabled={busy} value={owner} onChange={event => { setOwner(event.target.value); setShare(false) }}>{!owners.some(item => item.id === owner) && <option value={owner}>{owner}</option>}{owners.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    <p>{scopeHelp[scope]}</p></>}

    {!formOpen && <><div className={css.settingsGrid}>
    <label>{l('记忆范围', 'Memory scope')}<select value={viewScope} onChange={event => { setViewScope(event.target.value as typeof viewScope); setViewOwner('') }}><option value="all">{l('全部范围', 'All scopes')}</option>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
    {viewScope !== 'all' && viewScope !== 'global' && <label>{l('筛选对象', 'Filter by owner')}<select value={viewOwner} onChange={event => setViewOwner(event.target.value)}><option value="">{l('全部对象', 'All owners')}</option>{ownersFor(viewScope).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
    <label>{l('显示哪些记忆', 'Show memories')}<select value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="">{l('全部状态', 'All statuses')}</option>{(['pending', 'active', 'superseded'] as const).map(key => <option key={key} value={key}>{statuses[key]}</option>)}</select></label>
    </div><label>{l('搜索记忆', 'Search memories')}<Input placeholder={l('可选，输入关键词缩小范围', 'Optional: filter by keyword')} value={query} onChange={event => setQuery(event.target.value)}/></label>
    <div className={css.controlActions}><Button variant="primary" disabled={busy} onClick={() => { reset(); changeScope(viewScope === 'all' ? 'global' : viewScope); if (viewOwner) setOwner(viewOwner); setFormOpen(true) }}>{l('添加记忆', 'Add memory')}</Button><Button size="sm" disabled={busy || loading} onClick={() => setRefresh(value => value + 1)}>{l('刷新', 'Refresh')}</Button>{filtered && <Button onClick={() => { setViewScope('all'); setViewOwner(''); setStatus(''); setQuery('') }}>{l('显示全部记忆', 'Show all memories')}</Button>}</div></>}
    {formOpen && <div className={css.settingsEditor}><h4>{editing ? l('编辑记忆', 'Edit memory') : l('新记忆', 'New memory')}</h4>
    <p>{l('保存到：', 'Save to: ')}{labels[scope]} · {owners.find(item => item.id === owner)?.name ?? owner}</p>
    <div className={css.settingsGrid}><label>{l('类型', 'Memory type')}<select value={kind} onChange={event => setKind(event.target.value as typeof kind)}><option value="preference">{l('偏好 / 约定', 'Preference / convention')}</option><option value="fact">{l('事实', 'Fact')}</option></select></label>
    <label>{l('主题', 'Topic')}<Input maxLength={120} placeholder={l('例如：回复语言、项目上线日期', 'For example: reply language or release date')} value={topic} onChange={event => setTopic(event.target.value)}/></label></div>
    <label>{l('内容', 'Memory content')}<textarea maxLength={1500} value={body} onChange={event => setBody(event.target.value)}/></label>
    {kind === 'fact' && <>
    <label>{l('证据 / 来源（事实必填）', 'Evidence / source (required for facts)')}<textarea maxLength={1500} value={evidence} onChange={event => setEvidence(event.target.value)}/></label>
    </>}
    <details><summary>{l('更多选项：来源与有效期', 'More options: sources and dates')}</summary><div className={css.settingsFields}>
    {kind === 'preference' && <label>{l('来源说明（可选）', 'Source note (optional)')}<textarea maxLength={1500} value={evidence} onChange={event => setEvidence(event.target.value)}/></label>}
    <label>{l('主体 / 环境', 'Subject / environment')}<Input maxLength={160} value={subject} onChange={event => setSubject(event.target.value)}/></label>
    <label>{l('生效时间（UTC，可留空）', 'Effective time (UTC, optional)')}<Input type="datetime-local" value={effectiveAt} onChange={event => setEffectiveAt(event.target.value)}/></label>
    <label>{l('到期时间（UTC，可留空）', 'Expiry (UTC, optional)')}<Input type="datetime-local" value={expiresAt} onChange={event => setExpiresAt(event.target.value)}/></label>
    </div></details>
    {(scope === 'user' || editing) && <label className={css.checkOption}><input type="checkbox" checked={share} onChange={event => setShare(event.target.checked)}/>{l('允许在所选范围内共享，包含该范围内的群聊', 'Allow sharing throughout the selected scope, including its group chats')}</label>}
    <div className={css.controlActions}><Button variant="primary" disabled={busy || !owner || !subject.trim() || !topic.trim() || !body.trim() || kind === 'fact' && !evidence.trim()} onClick={() => { void save() }}>{l('保存并生效', 'Save & activate')}</Button><Button disabled={busy} onClick={reset}>{l('取消编辑', 'Cancel edit')}</Button></div></div>}
    {!formOpen && <>
    {loading && <p role="status">{l('正在加载记忆…', 'Loading memories…')}</p>}
    {listError && <p role="alert">{listError} <Button onClick={() => setRefresh(value => value + 1)}>{l('重试', 'Retry')}</Button></p>}
    {!loading && !listError && <p>{items.length ? l(`共 ${items.length} 条记忆，最近更新的在前`, `${items.length} memories, most recently updated first`) : filtered ? l('没有符合筛选条件的记忆，可以显示全部记忆。', 'No matching memories. Clear the filters to see all memories.') : l('还没有记忆。可以添加一条，或在聊天中让 Bot 记住。', 'No memories yet. Add one here, or ask a Bot to remember something.')}</p>}
    {items.slice(0, limit).map(item => <article key={item.id} className={css.memoryCard}>
      <strong>{item.topic}</strong><span>{statuses[item.status]} · {item.kind === 'fact' ? l('事实', 'Fact') : l('偏好/约定', 'Preference/convention')}</span>
      <small>{labels[item.scope]}{item.scope !== 'global' && ` · ${ownersFor(item.scope).find(owner => owner.id === item.ownerId)?.name ?? item.ownerId}`}</small>
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
    {items.length > limit && <Button onClick={() => setLimit(value => value + 20)}>{l('显示更多记忆', 'Show more memories')}</Button>}
    <MemoryGovernance state={state} face={face} scope={viewScope} ownerId={viewScope === 'global' ? '*' : viewOwner} english={english} revision={refresh} refresh={() => setRefresh(value => value + 1)}/>
    <KnowledgeControls face={face} english={english} catalog={catalog} refresh={() => setRefresh(value => value + 1)}/>
    {room && <details><summary>{l('预览当前聊天会加载的记忆', 'Preview recall for this chat')}</summary>
      <label>{l('回复 Bot', 'Responding Bot')}<select value={previewBot} onChange={event => setPreviewBot(event.target.value)}>{room.members.map(member => <option key={member.botId} value={member.botId}>{state.bots.find(bot => bot.id === member.botId)?.name ?? member.botId}</option>)}</select></label>
      <label>{l('当前说话用户', 'Current speaker')}<select value={previewUser} onChange={event => setPreviewUser(event.target.value)}><option value="">{l('无个人身份（定时任务）', 'No personal identity (scheduled task)')}</option>{catalog.users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
      <label>{l('检索问题', 'Recall query')}<Input value={previewQuery} onChange={event => setPreviewQuery(event.target.value)}/></label>
      <Button disabled={busy} onClick={() => { setBusy(true); setError(''); void face.previewMemories({ roomId: room.id, botId: previewBot, ...(previewUser ? { userId: previewUser } : {}), query: previewQuery }).then(setPreview).catch(cause => setError(String(cause))).finally(() => setBusy(false)) }}>{l('预览', 'Preview')}</Button>
      {preview && <div aria-live="polite"><p>{preview.records.length} {l('条记忆', 'memories')} · {preview.conflicts.length} {l('组冲突，需核实', 'conflicts requiring verification')} · {preview.omitted} {l('条超出预算未加载', 'omitted by context budget')}</p>{preview.records.map(item => <p key={item.id}>{labels[item.scope]} · {item.topic}: {item.body}{preview.conflicts.some(ids => ids.includes(item.id)) ? ` · ${l('待核实', 'Verify')}` : ''}</p>)}</div>}
    </details>}
    </>}
  </section>
}
