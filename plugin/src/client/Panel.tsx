/** Native main-panel occupant; business state arrives only through framework hooks. */
import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Button, Input, MarkdownText, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { StopRequest, AttemptRequest, Bot, BotId, ChatMessage, ChatAttachment, ChatMessageId, CreateBotRequest, CreateGroupRequest, MembersRequest, Room, SendRequest, UpdateBotRequest } from '../types.ts'
import { Controls } from './Controls.tsx'
import { VoiceInput } from './VoiceInput.tsx'
import { AttachmentView } from './Attachments.tsx'
import { Questions } from './Questions.tsx'
import type { CapabilityFace } from './capability-face.ts'
import type { ModelSnapshot } from './model.ts'
import type { createBotViewStore } from './view-store.ts'
import { Avatar } from './Avatar.tsx'
import { Composer } from './Composer.tsx'
import { SidebarIcon, PlusIcon, SearchIcon, AttachmentIcon, CloseIcon, ConnectionsIcon, ControlsIcon } from './Icons.tsx'
import css from './Panel.module.css'
import { IMPanel } from './IMPanel.tsx'
import type { FeishuFace } from './feishu-face.ts'
import type { InfoFlowFace } from './infoflow-face.ts'
import type { FeishuState } from '../feishu/types.ts'

export interface PanelFace {
  capabilities?: CapabilityFace
  infoflow?: InfoFlowFace
  feishu?: FeishuFace
  hooks: { bots: ObservableSnapshot<ModelSnapshot> }
  createBot: (request: CreateBotRequest) => Promise<Bot>
  updateBot: (request: UpdateBotRequest) => Promise<Bot>
  createGroup: (request: CreateGroupRequest) => Promise<Room>
  setMembers: (request: MembersRequest) => Promise<Room>
  send: (request: SendRequest) => Promise<unknown>
  stop: (request: StopRequest) => Promise<unknown>
  retry: (request: AttemptRequest) => Promise<unknown>
  openSession: (id: SessionId) => void
  toggleSidebar: () => void
  setInfoflowVisible: (visible: boolean) => Promise<boolean>
}
type Props = PropsRuntime<'main'> & InjectFace<PanelFace> & PropsLocale<'botMode'> & PropsStore<ReturnType<typeof createBotViewStore>>

function RoomPortrait({ room, large = false }: { room: Room; large?: boolean }) {
  return <span className={clsx(css.portraits, room.kind === 'group' && css.groupPortrait, large && css.portraitsLarge)}>
    {room.members.slice(0, room.kind === 'group' ? 2 : 1).map(member => <Avatar key={member.botId} id={member.botId} large={large} />)}
  </span>
}

export function BotPanel(props: Props) {
  const { t } = props
  const snapshot = props.useBots(value => value)
  const { bots, rooms } = snapshot.value
  const infoflowVisible = snapshot.value.infoflowVisible === true
  const selected = props.useStore(value => value.roomId)
  const select = props.actions.select
  const [form, setForm] = useState<'bot' | 'edit' | 'group' | 'members' | null>(null)
  const [integration, setIntegration] = useState(false)
  const [syncGroup, setSyncGroup] = useState<'none' | 'infoflow' | 'feishu'>('none')
  const [groupOwner, setGroupOwner] = useState('')
  const [humanMembers, setHumanMembers] = useState('')
  const [groupRequestId, setGroupRequestId] = useState('')
  const [groupSubmitted, setGroupSubmitted] = useState(false)
  const [feishuGroups, setFeishuGroups] = useState<FeishuState | null>(null)
  const [draft, setDraft] = useState('')
  const [reply, setReply] = useState<ChatMessageId | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | Room['kind']>('all')
  const [details, setDetails] = useState(false)
  const [controls, setControls] = useState(false)
  const [older, setOlder] = useState<ChatMessage[]>([])
  const fileInput = useRef<HTMLInputElement>(null)
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [delegation, setDelegation] = useState(false)
  const [syncMessage, setSyncMessage] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [showChats, setShowChats] = useState(false)
  const [pendingBot, setPendingBot] = useState<BotId | null>(null)
  const [name, setName] = useState('')
  const [handle, setHandle] = useState('')
  const [instructions, setInstructions] = useState('')
  const [preset, setPreset] = useState('standard')
  const [members, setMembers] = useState<BotId[]>([])
  const [defaultBot, setDefault] = useState<BotId | undefined>()
  const room = rooms.find(item => (item.id === selected || !!selected && item.aliases?.includes(selected)) && !item.deleted) ?? rooms.find(item => !item.archived && !item.deleted)
  const selection = useRef({ id: room?.id, revision: 0 })
  if (selection.current.id !== room?.id) selection.current = { id: room?.id, revision: selection.current.revision + 1 }
  const revision = selection.current.revision
  const messages = [...older.filter(message => !room?.messages.some(item => item.id === message.id)), ...(room?.messages ?? [])]
  const roomBots = bots.filter(bot => room?.members.some(member => member.botId === bot.id))
  const running = room?.messages.some(item => item.status === 'running') ?? false
  // External private chats stay platform-only. Group sends remain local unless explicitly synchronized.
  const writable = !!room && !room.archived && (!room.external || room.kind === 'group')
  const localHint = room?.external ? t(room.external.provider === 'feishu' ? 'fsLocalHint' : 'ifLocalHint') : ''
  const end = useRef<HTMLDivElement>(null)
  const timeline = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  useEffect(() => { setOlder([]); setAttachments([]); setDraft(''); setReply(null); setDelegation(false); setSyncMessage(false) }, [room?.id])
  const labels = useMemo(() => ({ code: { copyLabel: t('copy'), copiedLabel: t('copied') }, footnotes: t('footnotes') }), [t])
  useEffect(() => { if (follow.current) end.current?.scrollIntoView({ block: 'end' }) }, [room?.id, room?.messages])
  useEffect(() => {
    if (form !== 'group' || syncGroup !== 'feishu' || !props.feishu) return
    let live = true
    void props.feishu.snapshot().then(state => { if (live) setFeishuGroups(state) }).catch(() => { if (live) setFeishuGroups(null) })
    return () => { live = false }
  }, [form, syncGroup, props.feishu])
  useEffect(() => {
    if (!pendingBot) return
    const created = rooms.find(item => item.kind === 'dm' && !item.external && item.defaultBot === pendingBot)
    if (created) { select(created.id); setPendingBot(null); setDraft(''); setReply(null); follow.current = true }
  }, [rooms, pendingBot, select])
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(null)
    try { await action() } catch (cause) { if (selection.current.revision === revision) setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  const uploadFile = async (file: File) => {
    if (attachments.length >= 8 || file.size + attachments.reduce((total, item) => total + item.attachment.bytes, 0) > 20 * 1024 * 1024) throw new Error(t('attachmentLimit'))
    const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onerror = () => reject(new Error('File read failed')); reader.onload = () => resolve(String(reader.result).split(',')[1]!); reader.readAsDataURL(file) })
    return props.capabilities!.upload({ name: file.name, mediaType: file.type, base64, transcribe: file.type.startsWith('audio/') || file.name.toLowerCase().endsWith('.wav') })
  }
  const openForm = (next: 'bot' | 'edit' | 'group' | 'members', bot?: Bot) => {
    setSyncGroup('none'); setGroupOwner(''); setHumanMembers(''); setGroupRequestId(crypto.randomUUID()); setGroupSubmitted(false); setFeishuGroups(null)
    setForm(next); setError(null); setName(bot?.name ?? ''); setHandle(bot?.id ?? ''); setInstructions(bot?.instructions ?? ''); setPreset(bot?.preset ?? 'standard')
    const ids = next === 'members' && room ? room.members.map(item => item.botId) : bots.slice(0, 2).map(bot => bot.id)
    setMembers(ids); setDefault(next === 'members' ? room?.defaultBot : ids[0])
  }
  const choose = (next: Room) => {
    setIntegration(false); select(next.id); setReply(null); setDraft(''); setError(null); setShowChats(false); setDetails(false); follow.current = true
  }
  const botName = (id: BotId | null) => id === null ? t('you') : bots.find(bot => bot.id === id)?.name ?? id
  const groupLocked = busy || groupSubmitted
  const creatorBinding = feishuGroups?.bindings.find(binding => binding.botId === defaultBot)
  const alternativeCreator = feishuGroups?.bindings.find(binding => binding.botId !== defaultBot && binding.enabled && members.includes(binding.botId)
    && feishuGroups.groups.some(group => group.creatorBot === binding.botId && group.status === 'ready'))
  const createFeishuGroup = async () => {
    setGroupSubmitted(true)
    try {
      return await props.feishu!.createGroup({ title: name, botIds: members, creatorBot: defaultBot!, requestId: groupRequestId, ...(groupOwner.trim() ? { owner: groupOwner.trim() } : {}) })
    } catch (cause) {
      try {
        const state = await props.feishu!.snapshot()
        setFeishuGroups(state)
        const saved = state.groups.find(group => group.requestId === groupRequestId)
        if (!saved || saved.status === 'failed' && !saved.chatId) {
          setGroupSubmitted(false); setGroupRequestId(crypto.randomUUID())
        }
      } catch { /* Unknown outcome: retain the request and original error until status can be recovered. */ }
      throw cause
    }
  }
  const visible = rooms.filter(item => !item.deleted && (showArchived || !item.archived) && (filter === 'all' || item.kind === filter)
    && `${item.title} ${item.members.map(member => `${member.botId} ${botName(member.botId)}`).join(' ')}`.toLowerCase().includes(search.toLowerCase()))
    .sort((left, right) => (right.messages.at(-1)?.time ?? 0) - (left.messages.at(-1)?.time ?? 0))
  const time = (value: number) => new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(value)
  const closeForm = () => { if (!busy) { setForm(null); setError(null) } }
  return <section className={clsx(css.root, showChats && css.showChats)}>
    <aside className={css.chats} aria-label={t('chats')}>
      <header className={css.rosterHeader}><div><span className={css.workspaceLabel}>{t('workspace')}</span><h1>{t('title')}<span>{bots.length}</span></h1></div>
        <Button size="sm" aria-label={t('newBot')} title={t('newBot')} icon={<PlusIcon />} onClick={() => { openForm('bot') }} /></header>
      <Input className={clsx(css.search)} icon={<SearchIcon />} aria-label={t('search')} placeholder={t('search')} value={search} onChange={(event) => { setSearch(event.target.value) }} />
      <div className={css.filters} role="group" aria-label={t('filterChats')}>
        {(['all', 'group', 'dm'] as const).map(kind => <button type="button" key={kind} aria-pressed={filter === kind} onClick={() => { setFilter(kind) }}>{t(kind === 'all' ? 'allChats' : kind === 'group' ? 'groups' : 'bots')}</button>)}
      </div>
      {props.capabilities && <label className={css.archiveToggle}><input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)}/>{t('showArchived')}</label>}
      <div className={css.roomList}>
        {(['group', 'dm'] as const).filter(kind => filter === 'all' || kind === filter).map(kind => <section key={kind}>
          <div className={css.sectionLabel}><h2>{t(kind === 'dm' ? 'direct' : 'groups')}<span>{rooms.filter(item => item.kind === kind).length}</span></h2>
            <Button size="sm" disabled={kind === 'group' && !bots.length} aria-label={t(kind === 'dm' ? 'newBot' : 'newGroup')} title={t(kind === 'dm' ? 'newBot' : 'newGroup')}
              icon={<PlusIcon />} onClick={() => { openForm(kind === 'dm' ? 'bot' : 'group') }} /></div>
          {visible.filter(item => item.kind === kind).map((item) => {
            const last = item.messages.at(-1)
            const preview = last ? last.status === 'running' ? t('running') : last.text || t(last.status)
              : item.kind === 'dm' ? `@${item.defaultBot}` : item.members.map(member => botName(member.botId)).join('、')
            return <button type="button" className={css.chat} aria-label={`${item.title} ${item.kind === 'dm' ? `@${item.defaultBot}` : t('groups')}`} aria-current={item.id === room?.id ? 'page' : undefined} key={item.id} onClick={() => { choose(item) }}>
              <RoomPortrait room={item} /><span className={css.chatText}><span className={css.chatTitle}><strong>{item.title}</strong>
                {last && <time dateTime={new Date(last.time).toISOString()}>{time(last.time)}</time>}</span>
              <span className={clsx(css.chatPreview, last?.status === 'running' && css.activePreview)}>{last?.status === 'running' && <span className={css.connection} data-ready="true" />}{preview}</span>
              </span>
            </button>
          })}
        </section>)}
        {search && !visible.length && <p className={css.searchEmpty}>{t('noResults')}</p>}
        {!bots.length && snapshot.ready && <p className={css.searchEmpty}>{t('empty')}</p>}
      </div>
      <Button className={css.newChat} variant="outline" disabled={!snapshot.ready || !bots.length} icon={<PlusIcon />} onClick={() => { openForm('group') }}>{t('startGroup')}</Button>
      <div className={css.rosterUtilities}>
        <Button size="sm" icon={<ConnectionsIcon />} aria-pressed={integration} onClick={() => { setIntegration(true); setShowChats(false) }}>{t('imTitle')}</Button>
        {props.capabilities && <Button size="sm" icon={<ControlsIcon />} onClick={() => setControls(true)}>{t('capabilities')}</Button>}
      </div>
      <footer className={css.rosterFooter}><span className={css.connection} data-ready={snapshot.ready && !snapshot.error} /><span>{snapshot.error ? t('disconnected') : snapshot.ready ? t('connected') : t('loading')}</span>
        <Button size="sm" title={t('toggleSidebar')} aria-label={t('toggleSidebar')} icon={<SidebarIcon />} onClick={props.toggleSidebar} /></footer>
    </aside>
    {integration ? <IMPanel bots={bots} feishu={props.feishu} infoflow={props.infoflow} infoflowVisible={infoflowVisible}
      setInfoflowVisible={props.setInfoflowVisible} settingsDisabled={!snapshot.ready || !!snapshot.error}
      t={t} back={() => { setIntegration(false) }} openRoom={choose} selectRoom={id => { const target = rooms.find(item => item.id === id || item.aliases?.includes(id)); if (target) choose(target) }} createFeishuGroup={(id, failed) => {
      if (failed && (failed.status !== 'failed' || failed.chatId)) return
      openForm('group'); setSyncGroup('feishu'); setMembers(failed?.botIds ?? [id]); setDefault(id); setName(failed?.title ?? `${botName(id)} · ${t('feishu')}`)
      if (failed) { setGroupOwner(failed.owner); setError(failed.error) }
    }}/> : <main className={css.main}>
      {!form && (error || snapshot.error) && <div role="alert" className={css.error}>{error || snapshot.error}</div>}
      {room ? <>
        <header className={css.header}>
          <Button className={css.mobileChats} size="sm" aria-label={t('chats')} icon={<SidebarIcon />} onClick={() => { setShowChats(!showChats) }} />
          <RoomPortrait room={room} /><div className={css.headerText}><h2>{room.title}<span className={css.kindBadge} aria-hidden="true">{t(room.external ? room.external.provider : room.kind === 'group' ? 'groups' : 'botLabel')}</span></h2><p>{room.kind === 'group' ? roomBots.map(bot => bot.name).join(' · ') : `@${room.defaultBot} · ${t('privateChat')}`}</p></div>
          <Button size="sm" className={css.infoButton} aria-label={t('chatInfo')} title={t('chatInfo')} onClick={() => { setDetails(true) }} icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1" strokeLinecap="round"/></svg>} />
          {room.kind === 'group' && !room.external && <Button size="sm" disabled={running} onClick={() => { openForm('members') }}>{t('settings')}</Button>}
        </header>
        <div ref={timeline} className={css.timeline} onScroll={() => {
          const node = timeline.current
          if (node) follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100
        }}>
          <div className={css.transcript}>
            {props.capabilities && room.messageCount !== undefined && room.messageCount > messages.length && <Button size="sm" className={css.loadEarlier} disabled={busy} onClick={() => { void act(async () => {
              const page = await props.capabilities!.history({ roomId: room.id, ...(messages[0] ? { before: messages[0].id } : {}), limit: 50 })
              if (selection.current.revision !== revision) return
              setOlder(current => [...page.messages, ...current]); follow.current = false
            }) }}>{t('loadEarlier')}</Button>}
            {!room.messages.length ? <div className={css.welcome}>
              <RoomPortrait room={room} large /><span className={css.eyebrow}>{t(room.kind === 'group' ? 'sharedChat' : 'privateChat')}</span><h3>{t(room.kind === 'group' ? 'groupGreeting' : 'directGreeting')}</h3>
              <p>{room.kind === 'dm' ? roomBots[0]?.instructions || t('noMessages') : t('groupWelcome')}</p>
              {writable && <div className={css.suggestions}>{(['suggestPlan', 'suggestReview'] as const).map(key => <button type="button" key={key} onClick={() => { setDraft(t(key)) }}><span aria-hidden="true">{key === 'suggestPlan' ? '↗' : '◎'}</span><strong>{t(key === 'suggestPlan' ? 'planTitle' : 'reviewTitle')}</strong><span>{t(key)}</span></button>)}</div>}
            </div> : <>
              <p className={css.history}><span>{t(room.kind === 'group' ? 'sharedChat' : 'privateChat')}</span></p>
              {messages.map((message) => {
                const own = message.botId === null
                const speaker = message.external ? `${message.external.sender.name} (${message.external.sender.id})` : botName(message.botId)
                const quoted = own && message.replyTo ? room.messages.find(item => item.id === message.replyTo) : undefined
                const member = room.members.find(item => item.botId === message.botId)
                return <article className={clsx(css.message, own && css.ownMessage)} key={message.id} aria-label={speaker}>
                  {!own && message.botId && <Avatar id={message.botId} small />}
                  <div className={css.messageContent}>
                    <div className={css.messageHeader}><strong>{speaker}</strong>{!own && <span className={css.speakerBadge}>{t('botLabel')}</span>}
                      {room.external && message.localOnly && <span className={css.speakerBadge} title={localHint}>{t('localOnly')}</span>}
                      <time dateTime={new Date(message.time).toISOString()}>{time(message.time)}</time></div>
                    <div className={css.bubble}>
                      {quoted && <div className={css.quote}><strong>{botName(quoted.botId)}</strong>
                        <span>{quoted.text.slice(0, 140)}</span></div>}
                      {message.text && (own ? <div className={css.body}>{message.text}</div>
                        : <MarkdownText text={message.text} labels={labels} />)}
                      {message.attachments?.map(item => props.capabilities ? <AttachmentView key={item.attachment.attachmentId} item={item} face={props.capabilities} request={{ roomId: room.id, messageId: message.id, attachmentId: item.attachment.attachmentId }}/> : <p key={item.attachment.attachmentId}>📎 {item.attachment.name}</p>)}
                      {message.toolDetails?.map((tool, index) => <details className={css.toolDetails} key={index}><summary>{tool.name}</summary><pre>{tool.arguments}</pre>{tool.result && <pre>{tool.result}</pre>}</details>)}
                      {props.capabilities && message.questions?.map(view => <Questions key={view.id} view={view} roomId={room.id} face={props.capabilities!} english={t('you') === 'You'}/>)}
                      {message.progress?.question && props.capabilities && <Questions key={message.progress.question.id} view={message.progress.question} roomId={room.id} face={props.capabilities} english={t('you') === 'You'}/>}
                      {message.continuationOf && <p className={css.executionStatus}>{t('you') === 'You' ? 'Continuing with delegated results' : '已收到子任务结果，继续汇总'}</p>}
                      {message.awaiting?.length && !message.continuedBy && !message.collaborationCanceled ? <div className={css.executionStatus} role="status"><span>{t('you') === 'You' ? 'Waiting for delegated results' : '等待子任务结果，完成后自动继续'}</span><Button size="sm" disabled={busy} onClick={() => { void act(() => props.stop({ roomId: room.id, messageId: message.id, cascade: true })) }}>{t('stop')}</Button></div> : null}
                      {message.progress && <div className={css.executionStatus} role="status"><span>{message.progress.phase} {message.progress.tools.join(', ')}</span>
                        {message.progress.approvalId && props.capabilities && <><p>{message.progress.reason}</p><pre>{message.progress.arguments}</pre><div className={css.controlActions}>
                          <Button size="sm" variant="primary" disabled={busy} onClick={() => { void act(() => props.capabilities!.decideApproval({ roomId: room.id, id: message.progress!.approvalId!, allow: true })) }}>{t('allowOnce')}</Button>
                          <Button size="sm" variant="outline" disabled={busy} onClick={() => { void act(() => props.capabilities!.decideApproval({ roomId: room.id, id: message.progress!.approvalId!, allow: false })) }}>{t('reject')}</Button></div></>}
                      </div>}
                      {message.status === 'running' &&
                        <div className={css.working} role="status"><span className={css.thinkingDots}><i /><i /><i /></span>{t('running')}</div>}
                      {message.error && <p className={css.messageError}>{message.error}</p>}
                      {!['running', 'complete'].includes(message.status) && <span className={css.status}>{t(message.status)}</span>}
                    </div>
                    {message.status === 'running' && member && <button type="button" className={css.progress} onClick={() => { props.openSession(message.executionSessionId ?? member.sessionId) }}>{t('progress')}<span aria-hidden="true">↗</span></button>}
                    <div className={clsx(css.messageActions, message.status !== 'complete' && css.visibleActions)}>
                      {writable && <Button size="sm" onClick={() => { setReply(message.id) }}>{t('reply')}</Button>}
                      {member && <Button size="sm" onClick={() => { props.openSession(message.executionSessionId ?? member.sessionId) }}>{t('execution')}</Button>}
                      {['queued', 'running'].includes(message.status) && <Button size="sm" disabled={busy} onClick={() => { void act(() => props.stop({ roomId: room.id, messageId: message.id })) }}>{t('stop')}</Button>}
                      {(!room.external || message.localOnly) && message.botId && !['running', 'complete'].includes(message.status) && <Button size="sm" disabled={busy} onClick={() => { void act(() => props.retry({ roomId: room.id, messageId: message.id })) }}>{t('retry')}</Button>}
                    </div>
                  </div>
                </article>
              })}
            </>}<div ref={end} />
          </div>
        </div>
        {room.external && <p role="note" className={css.history}>{room.kind === 'group' ? syncMessage ? t('syncHint') : localHint : t(room.external.provider === 'feishu' ? 'fsExternalHelp' : 'externalReadOnly')}</p>}
        {writable && <Composer key={room.id} bots={roomBots} t={t} draft={draft} onDraft={setDraft}
          hasAttachments={attachments.length > 0}
          toolbar={props.capabilities && <>
            <input ref={fileInput} type="file" hidden aria-label={t('attach')} multiple disabled={busy} onChange={event => {
              const files = Array.from(event.target.files ?? []); event.target.value = ''
              void act(async () => {
                if (files.length + attachments.length > 8 || files.reduce((sum, file) => sum + file.size, 0) + attachments.reduce((sum, item) => sum + item.attachment.bytes, 0) > 20 * 1024 * 1024) throw new Error(t('attachmentLimit'))
                const uploaded: ChatAttachment[] = []
                for (const file of files) {
                  uploaded.push(await uploadFile(file))
                  if (selection.current.revision !== revision) return
                }
                setAttachments(current => [...current, ...uploaded])
              })
            }}/>
            <Button size="sm" icon={<AttachmentIcon />} aria-label={t('attach')} title={t('attach')} disabled={busy} onClick={() => fileInput.current?.click()}/>
            <VoiceInput key={room.id} disabled={busy} label={t('recordVoice')} stopLabel={t('stopRecording')} onError={setError} onAudio={file => act(async () => {
              const attachment = await uploadFile(file)
              if (selection.current.revision === revision) setAttachments(current => [...current, attachment])
            })}/>
          </>}
          attachmentPreview={attachments.length > 0 && <div className={css.pendingAttachments}>
            {attachments.map((item, index) => <div className={css.attachmentChip} key={item.attachment.attachmentId}>
              <AttachmentIcon /><span title={item.attachment.name}>{item.attachment.name}</span>
              <Button size="sm" icon={<CloseIcon />} aria-label={`${t('removeAttachment')}: ${item.attachment.name}`} title={t('removeAttachment')} onClick={() => setAttachments(current => current.filter((_, i) => i !== index))}/>
            </div>)}
          </div>}
          optionsContent={props.capabilities && (room.kind === 'group' || running) && <div className={css.inputOptions}>
            {room.kind === 'group' && <label><input type="checkbox" checked={delegation} onChange={event => setDelegation(event.target.checked)}/>{t('allowDelegation')}</label>}
            {room.external && <label><input type="checkbox" checked={syncMessage} onChange={event => setSyncMessage(event.target.checked)}/>{t('syncMessage')}</label>}
            {running && <span role="status">{t('queueHint')}</span>}
          </div>}
          disabled={busy || !snapshot.ready || !!snapshot.error || form !== null || details || controls}
          reply={room.messages.find(message => message.id === reply)}
          onCancelReply={() => { setReply(null) }}
          onSend={() => { void act(async () => {
            await props.send({ roomId: room.id, text: draft, ...(reply ? { replyTo: reply } : {}), ...(delegation ? { allowDelegation: true } : {}), ...(attachments.length ? { attachments } : {}), ...(syncMessage ? { notify: true } : {}) })
            if (selection.current.revision !== revision) return
            setAttachments([])
            setDraft(current => current === draft ? '' : current); setReply(null); follow.current = true
          }) }} />}
      </> : <div className={css.welcome}><Avatar id="dsh" large /><h2>{t('welcomeTitle')}</h2><p>{t('empty')}</p>
        <Button variant="primary" disabled={!snapshot.ready} onClick={() => { openForm('bot') }}>{t('newBot')}</Button></div>}
    </main>}
    <Modal open={controls} onClose={() => setControls(false)} closeLabel={t('cancel')} title={t('capabilities')} className={clsx(css.dialog, css.controlsDialog)} contentClassName={clsx(css.dialogContent)}>
      {props.capabilities && <Controls key={room?.id} state={snapshot.value} room={room} face={props.capabilities} updateBot={props.updateBot} english={t('you') === 'You'} openRoom={next => { choose(next); setControls(false) }}/>}
    </Modal>
    <Modal open={details && !!room} onClose={() => { setDetails(false) }} closeLabel={t('cancel')} title={t('chatInfo')} className={clsx(css.dialog)} contentClassName={clsx(css.dialogContent)}>
      {room && <div className={css.roomInfo}>
        <RoomPortrait room={room} large /><h3>{room.title}</h3><p>{room.external && room.kind === 'group' ? localHint : t(room.external ? room.external.provider === 'feishu' ? 'fsExternalHelp' : 'externalHistory' : room.kind === 'group' ? 'history' : 'privateHistory')}</p>
        <div className={css.infoMembers}>{roomBots.map(bot => <section key={bot.id}>
          <div className={css.infoIdentity}><Avatar id={bot.id} /><div><strong>{bot.name}</strong><span>@{bot.id}</span></div>{room.defaultBot === bot.id && <small>{t('defaultResponder')}</small>}</div>
          <p>{bot.instructions || t('noDescription')}</p>
          <div className={css.infoActions}>
            <Button size="sm" disabled={rooms.some(item => item.messages.some(message => message.botId === bot.id && message.status === 'running'))} onClick={() => { setDetails(false); openForm('edit', bot) }}>{t('editBot')}</Button>
            <Button size="sm" onClick={() => { const member = room.members.find(item => item.botId === bot.id); if (member) { setDetails(false); props.openSession(member.sessionId) } }}>{t('execution')}</Button>
          </div>
        </section>)}</div>
      </div>}
    </Modal>
    <Modal open={form !== null} onClose={closeForm} closeLabel={t('cancel')} title={t(form === 'bot' ? 'newBot' : form === 'edit' ? 'editBot' : form === 'group' ? 'newGroup' : 'settings')}
      description={t(form === 'bot' ? 'createHelp' : form === 'edit' ? 'editHelp' : 'groupHelp')} className={clsx(css.dialog)} contentClassName={clsx(css.dialogContent)}
      footer={<><Button disabled={busy} onClick={closeForm}>{t('cancel')}</Button><Button form="bot-settings" type="submit" variant="primary" disabled={busy || ((form === 'group' || form === 'members') && !members.length)}>{t(form === 'members' || form === 'edit' ? 'save' : syncGroup === 'feishu' && groupSubmitted ? 'fsGroupResume' : 'create')}</Button></>}>
      <form id="bot-settings" className={css.form} onSubmit={(event) => { event.preventDefault(); void act(async () => {
        if (form === 'bot') { const created = await props.createBot({ id: handle, name, instructions, preset }); setPendingBot(created.id) }
        else if (form === 'edit') await props.updateBot({ id: handle as BotId, name, instructions })
        else if (defaultBot && (form === 'group' || room)) {
          if (form === 'group' && syncGroup === 'infoflow' && !infoflowVisible) throw new Error(t('imInfoflowHidden'))
          const result = form === 'group' ? syncGroup === 'feishu' && props.feishu
            ? await createFeishuGroup()
            : syncGroup === 'infoflow' && props.infoflow
            ? await (async () => { setGroupSubmitted(true); try { return await props.infoflow!.createGroup({ title: name, botIds: members, defaultBot, requestId: groupRequestId, owner: groupOwner, members: humanMembers.split(/[,，\s]+/).filter(Boolean) }) } catch (cause) { const state = await props.infoflow!.snapshot(); if (!state.groups.some(item => item.requestId === groupRequestId)) setGroupSubmitted(false); throw cause } })()
            : await props.createGroup({ title: name, botIds: members, defaultBot })
            : room ? await props.setMembers({ roomId: room.id, botIds: members, defaultBot }) : undefined
          if (result) choose(result)
        }
        setForm(null)
      }) }}>
        {error && <div role="alert" className={css.error}>{error}</div>}
        {form === 'bot' || form === 'edit' ? <>
          <div className={css.botPreview}><Avatar id={handle || 'dsh'} large /><div><strong>{name || t('newBot')}</strong><span>{handle ? `@${handle}` : t('identityPreview')}</span></div></div>
          <div className={css.formGrid}><label>{t('name')}<Input autoFocus required maxLength={80} value={name} onChange={(event) => { setName(event.target.value) }} /></label>
            <label>{t('handle')}<Input required disabled={form === 'edit'} pattern="[a-zA-Z][a-zA-Z0-9_-]{0,31}" value={handle} onChange={(event) => { setHandle(event.target.value) }} /></label></div>
          <label>{t('instructions')}<textarea rows={4} maxLength={16000} placeholder={t('instructionsHint')} value={instructions} onChange={(event) => { setInstructions(event.target.value) }} /></label>
          <details className={css.advanced}><summary>{t('advanced')}</summary><label>{t('preset')}<Input required disabled={form === 'edit'} value={preset} onChange={(event) => { setPreset(event.target.value) }} />{form === 'edit' && <small>{t('editLocked')}</small>}</label></details>
        </> : <>
          {form === 'group' && <label>{t('groupTitle')}<Input autoFocus required disabled={groupLocked} maxLength={120} value={name} onChange={(event) => { setName(event.target.value) }} /></label>}
          <fieldset><legend>{t('members')}</legend><div className={css.memberList}>{bots.map(bot => <label className={css.member} key={bot.id}>
            <Avatar id={bot.id} /><span><strong>{bot.name}</strong><small>@{bot.id}</small></span>
            <input type="checkbox" disabled={groupLocked} checked={members.includes(bot.id)} onChange={(event) => {
              const next = event.target.checked ? [...members, bot.id] : members.filter(id => id !== bot.id)
              setMembers(next); if (!defaultBot || !next.includes(defaultBot)) { setDefault(next[0]); setGroupOwner('') }
            }} />
          </label>)}</div></fieldset>
          <label>{t(syncGroup === 'feishu' ? 'fsGroupCreator' : 'defaultBot')}<select disabled={groupLocked} value={defaultBot ?? ''} onChange={(event) => { setDefault(members.find(id => id === event.target.value)); setGroupOwner(''); setError(null) }}>
            {members.map(id => <option key={id} value={id}>{botName(id)}</option>)}
          </select><small>{t(syncGroup === 'feishu' ? 'fsGroupCreatorHint' : 'defaultHelp')}</small></label>
          {syncGroup === 'feishu' && <div className={css.groupPermission}>
            <p>{t('fsGroupPermission')}</p>
            {creatorBinding && <a href={`https://${creatorBinding.brand === 'lark' ? 'open.larksuite.com' : 'open.feishu.cn'}/app/${encodeURIComponent(creatorBinding.appId)}/auth?q=im%3Achat%3Acreate`} target="_blank" rel="noreferrer noopener">{t('fsGroupAuthorize')} · {botName(creatorBinding.botId)}</a>}
            {error && !groupLocked && alternativeCreator && <Button type="button" onClick={() => { setDefault(alternativeCreator.botId); setGroupOwner(''); setError(null) }}>{t('fsGroupUseSuccessful')} · {botName(alternativeCreator.botId)}</Button>}
          </div>}
          {form === 'group' && props.feishu && <section className={css.groupIntegration}>
            <label className={css.groupIntegrationToggle}><input type="checkbox" disabled={groupLocked} checked={syncGroup === 'feishu'} onChange={event => { setSyncGroup(event.target.checked ? 'feishu' : 'none'); setGroupOwner(''); setError(null) }}/><span>{t('fsCreateGroup')}</span></label>
            {syncGroup === 'feishu' && <><p className={css.integrationHint}>{t('fsCreateGroupHint')}</p>
              <details className={css.advanced}><summary>{t('advanced')}</summary><label>{t('fsGroupOwner')}<Input disabled={groupLocked} value={groupOwner} placeholder={t('fsGroupOwnerDefault')} onChange={event => { setGroupOwner(event.target.value) }}/><small>{t('fsGroupOwnerHint')}</small></label></details>
              {groupSubmitted && <p role="status" className={css.integrationHint}>{t('fsGroupRetryHint')}</p>}
            </>}
          </section>}
          {form === 'group' && infoflowVisible && props.infoflow && <section className={css.groupIntegration}>
            <label className={css.groupIntegrationToggle}><input type="checkbox" disabled={groupLocked} checked={syncGroup === 'infoflow'} onChange={event => { setSyncGroup(event.target.checked ? 'infoflow' : 'none'); setGroupOwner(''); setError(null) }}/><span>{t('ifCreateGroup')}</span></label>
            {syncGroup === 'infoflow' && <><p className={css.integrationHint}>{t('ifCreateGroupHint')}</p>
              <label>{t('ifGroupOwner')}<Input required disabled={groupLocked} value={groupOwner} onChange={event => { setGroupOwner(event.target.value) }}/></label>
              <label>{t('ifHumanMembers')}<Input disabled={groupLocked} value={humanMembers} onChange={event => { setHumanMembers(event.target.value) }}/></label>
              {groupSubmitted && <p role="status" className={css.integrationHint}>{t('ifGroupRetryHint')}</p>}
            </>}
          </section>}
        </>}
      </form>
    </Modal>
  </section>
}

export function BotIcon(props: PropsRuntime<'sidebar.panellist'>) {
  return <svg width={props.size} height={props.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="4" y="7" width="16" height="13" rx="4"/><path d="M12 3v4M8 12v3m8-3v3M9 17h6"/></svg>
}
