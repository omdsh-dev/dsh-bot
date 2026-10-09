/** Native main-panel occupant; business state arrives only through framework hooks. */
import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Button, Input, MarkdownText, Modal, IconPanelLeftOutline16, IconPlusOutline16, IconSearchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { AttemptRequest, Bot, BotId, ChatMessageId, CreateBotRequest, CreateGroupRequest, MembersRequest, Room, SendRequest } from '../types.ts'
import type { ModelSnapshot } from './model.ts'
import type { createBotViewStore } from './view-store.ts'
import { Avatar } from './Avatar.tsx'
import { Composer } from './Composer.tsx'
import css from './Panel.module.css'

export interface PanelFace {
  hooks: { bots: ObservableSnapshot<ModelSnapshot> }
  createBot: (request: CreateBotRequest) => Promise<Bot>
  createGroup: (request: CreateGroupRequest) => Promise<Room>
  setMembers: (request: MembersRequest) => Promise<Room>
  send: (request: SendRequest) => Promise<unknown>
  stop: (request: AttemptRequest) => Promise<unknown>
  retry: (request: AttemptRequest) => Promise<unknown>
  openSession: (id: SessionId) => void
  toggleSidebar: () => void
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
  const selected = props.useStore(value => value.roomId)
  const select = props.actions.select
  const [form, setForm] = useState<'bot' | 'group' | 'members' | null>(null)
  const [draft, setDraft] = useState('')
  const [reply, setReply] = useState<ChatMessageId | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | Room['kind']>('all')
  const [details, setDetails] = useState(false)
  const [showChats, setShowChats] = useState(false)
  const [pendingBot, setPendingBot] = useState<BotId | null>(null)
  const [name, setName] = useState('')
  const [handle, setHandle] = useState('')
  const [instructions, setInstructions] = useState('')
  const [preset, setPreset] = useState('standard')
  const [members, setMembers] = useState<BotId[]>([])
  const [defaultBot, setDefault] = useState<BotId | undefined>()
  const room = rooms.find(item => item.id === selected) ?? rooms[0]
  const roomBots = bots.filter(bot => room?.members.some(member => member.botId === bot.id))
  const running = room?.messages.some(item => item.status === 'running') ?? false
  const end = useRef<HTMLDivElement>(null)
  const timeline = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const labels = useMemo(() => ({ code: { copyLabel: t('copy'), copiedLabel: t('copied') }, footnotes: t('footnotes') }), [t])
  useEffect(() => { if (follow.current) end.current?.scrollIntoView({ block: 'end' }) }, [room?.id, room?.messages])
  useEffect(() => {
    if (!pendingBot) return
    const created = rooms.find(item => item.kind === 'dm' && item.defaultBot === pendingBot)
    if (created) { select(created.id); setPendingBot(null); setDraft(''); setReply(null); follow.current = true }
  }, [rooms, pendingBot, select])
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true); setError(null)
    try { await action() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  const openForm = (next: 'bot' | 'group' | 'members') => {
    setForm(next); setError(null); setName(''); setHandle(''); setInstructions(''); setPreset('standard')
    const ids = next === 'members' && room ? room.members.map(item => item.botId) : bots.slice(0, 2).map(bot => bot.id)
    setMembers(ids); setDefault(next === 'members' ? room?.defaultBot : ids[0])
  }
  const choose = (next: Room) => {
    select(next.id); setReply(null); setDraft(''); setError(null); setShowChats(false); setDetails(false); follow.current = true
  }
  const botName = (id: BotId | null) => id === null ? t('you') : bots.find(bot => bot.id === id)?.name ?? id
  const visible = rooms.filter(item => (filter === 'all' || item.kind === filter)
    && `${item.title} ${item.members.map(member => `${member.botId} ${botName(member.botId)}`).join(' ')}`.toLowerCase().includes(search.toLowerCase()))
    .sort((left, right) => (right.messages.at(-1)?.time ?? 0) - (left.messages.at(-1)?.time ?? 0))
  const time = (value: number) => new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(value)
  const closeForm = () => { if (!busy) { setForm(null); setError(null) } }
  return <section className={clsx(css.root, showChats && css.showChats)}>
    <aside className={css.chats} aria-label={t('chats')}>
      <header className={css.rosterHeader}><div><span className={css.workspaceLabel}>{t('workspace')}</span><h1>{t('title')}<span>{bots.length}</span></h1></div>
        <Button size="sm" aria-label={t('newBot')} title={t('newBot')} icon={<IconPlusOutline16 />} onClick={() => { openForm('bot') }} /></header>
      <Input className={clsx(css.search)} icon={<IconSearchOutline16 />} aria-label={t('search')} placeholder={t('search')} value={search} onChange={(event) => { setSearch(event.target.value) }} />
      <div className={css.filters} role="group" aria-label={t('filterChats')}>
        {(['all', 'group', 'dm'] as const).map(kind => <button type="button" key={kind} aria-pressed={filter === kind} onClick={() => { setFilter(kind) }}>{t(kind === 'all' ? 'allChats' : kind === 'group' ? 'groups' : 'bots')}</button>)}
      </div>
      <div className={css.roomList}>
        {(['group', 'dm'] as const).filter(kind => filter === 'all' || kind === filter).map(kind => <section key={kind}>
          <div className={css.sectionLabel}><h2>{t(kind === 'dm' ? 'direct' : 'groups')}<span>{rooms.filter(item => item.kind === kind).length}</span></h2>
            <Button size="sm" disabled={kind === 'group' && !bots.length} aria-label={t(kind === 'dm' ? 'newBot' : 'newGroup')} title={t(kind === 'dm' ? 'newBot' : 'newGroup')}
              icon={<IconPlusOutline16 />} onClick={() => { openForm(kind === 'dm' ? 'bot' : 'group') }} /></div>
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
      <Button className={css.newChat} variant="outline" disabled={!snapshot.ready || !bots.length} icon={<IconPlusOutline16 />} onClick={() => { openForm('group') }}>{t('startGroup')}</Button>
      <footer className={css.rosterFooter}><span className={css.connection} data-ready={snapshot.ready && !snapshot.error} /><span>{snapshot.error ? t('disconnected') : snapshot.ready ? t('connected') : t('loading')}</span>
        <Button size="sm" title={t('toggleSidebar')} aria-label={t('toggleSidebar')} icon={<IconPanelLeftOutline16 />} onClick={props.toggleSidebar} /></footer>
    </aside>
    <main className={css.main}>
      {!form && (error || snapshot.error) && <div role="alert" className={css.error}>{error || snapshot.error}</div>}
      {room ? <>
        <header className={css.header}>
          <Button className={css.mobileChats} size="sm" aria-label={t('chats')} icon={<IconPanelLeftOutline16 />} onClick={() => { setShowChats(!showChats) }} />
          <RoomPortrait room={room} /><div className={css.headerText}><h2>{room.title}<span className={css.kindBadge} aria-hidden="true">{t(room.kind === 'group' ? 'groups' : 'botLabel')}</span></h2><p>{room.kind === 'group' ? roomBots.map(bot => bot.name).join(' · ') : `@${room.defaultBot} · ${t('privateChat')}`}</p></div>
          <Button size="sm" className={css.infoButton} aria-label={t('chatInfo')} title={t('chatInfo')} onClick={() => { setDetails(true) }} icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1" strokeLinecap="round"/></svg>} />
          {room.kind === 'group' && <Button size="sm" disabled={running} onClick={() => { openForm('members') }}>{t('settings')}</Button>}
        </header>
        <div ref={timeline} className={css.timeline} onScroll={() => {
          const node = timeline.current
          if (node) follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100
        }}>
          <div className={css.transcript}>
            {!room.messages.length ? <div className={css.welcome}>
              <RoomPortrait room={room} large /><span className={css.eyebrow}>{t(room.kind === 'group' ? 'sharedChat' : 'privateChat')}</span><h3>{t(room.kind === 'group' ? 'groupGreeting' : 'directGreeting')}</h3>
              <p>{room.kind === 'dm' ? roomBots[0]?.instructions || t('noMessages') : t('groupWelcome')}</p>
              <div className={css.suggestions}>{(['suggestPlan', 'suggestReview'] as const).map(key => <button type="button" key={key} onClick={() => { setDraft(t(key)) }}><span aria-hidden="true">{key === 'suggestPlan' ? '↗' : '◎'}</span><strong>{t(key === 'suggestPlan' ? 'planTitle' : 'reviewTitle')}</strong><span>{t(key)}</span></button>)}</div>
            </div> : <>
              <p className={css.history}><span>{t(room.kind === 'group' ? 'sharedChat' : 'privateChat')}</span></p>
              {room.messages.map((message) => {
                const own = message.botId === null
                const quoted = own && message.replyTo ? room.messages.find(item => item.id === message.replyTo) : undefined
                const member = room.members.find(item => item.botId === message.botId)
                return <article className={clsx(css.message, own && css.ownMessage)} key={message.id} aria-label={botName(message.botId)}>
                  {!own && message.botId && <Avatar id={message.botId} small />}
                  <div className={css.messageContent}>
                    <div className={css.messageHeader}><strong>{botName(message.botId)}</strong>{!own && <span className={css.speakerBadge}>{t('botLabel')}</span>}
                      <time dateTime={new Date(message.time).toISOString()}>{time(message.time)}</time></div>
                    <div className={css.bubble}>
                      {quoted && <div className={css.quote}><strong>{botName(quoted.botId)}</strong>
                        <span>{quoted.text.slice(0, 140)}</span></div>}
                      {message.text && (own ? <div className={css.body}>{message.text}</div>
                        : <MarkdownText text={message.text} labels={labels} />)}
                      {message.status === 'running' &&
                        <div className={css.working} role="status"><span className={css.thinkingDots}><i /><i /><i /></span>{t('running')}</div>}
                      {message.error && <p className={css.messageError}>{message.error}</p>}
                      {!['running', 'complete'].includes(message.status) && <span className={css.status}>{t(message.status)}</span>}
                    </div>
                    {message.status === 'running' && member && <button type="button" className={css.progress} onClick={() => { props.openSession(member.sessionId) }}>{t('progress')}<span aria-hidden="true">↗</span></button>}
                    <div className={clsx(css.messageActions, message.status !== 'complete' && css.visibleActions)}>
                      <Button size="sm" onClick={() => { setReply(message.id) }}>{t('reply')}</Button>
                      {member && <Button size="sm" onClick={() => { props.openSession(member.sessionId) }}>{t('execution')}</Button>}
                      {message.status === 'running' && <Button size="sm" disabled={busy} onClick={() => { void act(() => props.stop({ roomId: room.id, messageId: message.id })) }}>{t('stop')}</Button>}
                      {message.botId && !['running', 'complete'].includes(message.status) && <Button size="sm" disabled={busy} onClick={() => { void act(() => props.retry({ roomId: room.id, messageId: message.id })) }}>{t('retry')}</Button>}
                    </div>
                  </div>
                </article>
              })}
            </>}<div ref={end} />
          </div>
        </div>
        <Composer key={room.id} bots={roomBots} t={t} draft={draft} onDraft={setDraft}
          disabled={busy || running || !snapshot.ready || !!snapshot.error || form !== null || details}
          reply={room.messages.find(message => message.id === reply)}
          onCancelReply={() => { setReply(null) }}
          onSend={() => { void act(async () => {
            await props.send({ roomId: room.id, text: draft, ...(reply ? { replyTo: reply } : {}) })
            setDraft(current => current === draft ? '' : current); setReply(null); follow.current = true
          }) }} />
      </> : <div className={css.welcome}><Avatar id="dsh" large /><h2>{t('welcomeTitle')}</h2><p>{t('empty')}</p>
        <Button variant="primary" disabled={!snapshot.ready} onClick={() => { openForm('bot') }}>{t('newBot')}</Button></div>}
    </main>
    <Modal open={details && !!room} onClose={() => { setDetails(false) }} closeLabel={t('cancel')} title={t('chatInfo')} className={clsx(css.dialog)}>
      {room && <div className={css.roomInfo}>
        <RoomPortrait room={room} large /><h3>{room.title}</h3><p>{t(room.kind === 'group' ? 'history' : 'privateHistory')}</p>
        <div className={css.infoMembers}>{roomBots.map(bot => <section key={bot.id}>
          <div className={css.infoIdentity}><Avatar id={bot.id} /><div><strong>{bot.name}</strong><span>@{bot.id}</span></div>{room.defaultBot === bot.id && <small>{t('defaultResponder')}</small>}</div>
          <p>{bot.instructions || t('noDescription')}</p>
          <Button size="sm" onClick={() => { const member = room.members.find(item => item.botId === bot.id); if (member) { setDetails(false); props.openSession(member.sessionId) } }}>{t('execution')}</Button>
        </section>)}</div>
      </div>}
    </Modal>
    <Modal open={form !== null} onClose={closeForm} closeLabel={t('cancel')} title={t(form === 'bot' ? 'newBot' : form === 'group' ? 'newGroup' : 'settings')}
      description={t(form === 'bot' ? 'createHelp' : 'groupHelp')} className={clsx(css.dialog)}
      footer={<><Button disabled={busy} onClick={closeForm}>{t('cancel')}</Button><Button form="bot-settings" type="submit" variant="primary" disabled={busy || (form !== 'bot' && !members.length)}>{t(form === 'members' ? 'save' : 'create')}</Button></>}>
      <form id="bot-settings" className={css.form} onSubmit={(event) => { event.preventDefault(); void act(async () => {
        if (form === 'bot') { const created = await props.createBot({ id: handle, name, instructions, preset }); setPendingBot(created.id) }
        else if (defaultBot && (form === 'group' || room)) {
          const result = form === 'group' ? await props.createGroup({ title: name, botIds: members, defaultBot })
            : room ? await props.setMembers({ roomId: room.id, botIds: members, defaultBot }) : undefined
          if (result) choose(result)
        }
        setForm(null)
      }) }}>
        {error && <div role="alert" className={css.error}>{error}</div>}
        {form === 'bot' ? <>
          <div className={css.botPreview}><Avatar id={handle || 'dsh'} large /><div><strong>{name || t('newBot')}</strong><span>{handle ? `@${handle}` : t('identityPreview')}</span></div></div>
          <div className={css.formGrid}><label>{t('name')}<Input autoFocus required maxLength={80} value={name} onChange={(event) => { setName(event.target.value) }} /></label>
            <label>{t('handle')}<Input required pattern="[a-zA-Z][a-zA-Z0-9_-]{0,31}" value={handle} onChange={(event) => { setHandle(event.target.value) }} /></label></div>
          <label>{t('instructions')}<textarea rows={4} maxLength={16000} placeholder={t('instructionsHint')} value={instructions} onChange={(event) => { setInstructions(event.target.value) }} /></label>
          <details className={css.advanced}><summary>{t('advanced')}</summary><label>{t('preset')}<Input required value={preset} onChange={(event) => { setPreset(event.target.value) }} /></label></details>
        </> : <>
          {form === 'group' && <label>{t('groupTitle')}<Input autoFocus required maxLength={120} value={name} onChange={(event) => { setName(event.target.value) }} /></label>}
          <fieldset><legend>{t('members')}</legend><div className={css.memberList}>{bots.map(bot => <label className={css.member} key={bot.id}>
            <Avatar id={bot.id} /><span><strong>{bot.name}</strong><small>@{bot.id}</small></span>
            <input type="checkbox" checked={members.includes(bot.id)} onChange={(event) => {
              const next = event.target.checked ? [...members, bot.id] : members.filter(id => id !== bot.id)
              setMembers(next); if (!defaultBot || !next.includes(defaultBot)) setDefault(next[0])
            }} />
          </label>)}</div></fieldset>
          <label>{t('defaultBot')}<select value={defaultBot ?? ''} onChange={(event) => { setDefault(members.find(id => id === event.target.value)) }}>
            {members.map(id => <option key={id} value={id}>{botName(id)}</option>)}
          </select><small>{t('defaultHelp')}</small></label>
        </>}
      </form>
    </Modal>
  </section>
}

export function BotIcon(props: PropsRuntime<'sidebar.panellist'>) {
  return <svg width={props.size} height={props.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="4" y="7" width="16" height="13" rx="4"/><path d="M12 3v4M8 12v3m8-3v3M9 17h6"/></svg>
}
