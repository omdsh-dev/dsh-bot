import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { BotId, ChatMessageId, Room } from '../types.ts'
import type { InvitationView, InviteBotRequest } from '../collaboration-types.ts'
import { Avatar } from './Avatar.tsx'
import css from './Panel.module.css'

export interface CollaborationFace {
  view(roomId: Room['id']): Promise<InvitationView>
  invite(request: InviteBotRequest): Promise<Room>
}

/** A frozen submitted request remains resumable even after a lost network response. */
export function InviteBotDialog({ room, face, initialBot, initialBackground, proposalId, resume, english, close, done, bindings }: {
  room: Room; face: CollaborationFace; initialBot?: BotId | undefined; initialBackground?: string | undefined
  proposalId?: string | undefined; resume?: InviteBotRequest | undefined; english: boolean; close(): void; done(room: Room): void; bindings(): void
}) {
  const copy = (zh: string, en: string) => english ? en : zh
  const [view, setView] = useState<InvitationView>()
  const [botId, setBot] = useState<BotId | undefined>(resume?.botId ?? initialBot)
  const [background, setBackground] = useState(resume?.background ?? initialBackground ?? '')
  const [ids, setIds] = useState<ChatMessageId[]>(resume?.messageIds ?? [])
  const [owner, setOwner] = useState(resume?.owner ?? '')
  const [submitted, setSubmitted] = useState<InviteBotRequest | undefined>(resume)
  const [requestId] = useState(() => proposalId ?? crypto.randomUUID())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = () => face.view(room.id).then(value => { setView(value); return value })
  useEffect(() => { let active = true; void face.view(room.id).then(value => { if (active) setView(value) }).catch(() => { if (active) setError(copy('无法加载邀请列表，请重试', 'Could not load invitations. Retry.')) }); return () => { active = false } }, [face, room.id])
  const locked = busy || !!submitted
  const candidate = view?.candidates.find(item => item.id === botId)
  const ownerRequired = !!room.external && room.kind === 'dm'
  const canSubmit = !!submitted || candidate?.status === 'available' && !!background.trim() && (!ownerRequired || !!owner.trim())
  const coordinator = view?.candidates.find(item => item.id === room.defaultBot)?.name ?? room.defaultBot
  return <Modal open onClose={() => { if (!busy) close() }} closeLabel={copy('关闭', 'Close')} title={copy('邀请 Bot 一起讨论', 'Invite a Bot to discuss')}
    className={clsx(css.dialog)} contentClassName={clsx(css.dialogContent)}
    footer={<><Button disabled={busy} onClick={close}>{copy('关闭', 'Close')}</Button><Button variant="primary" disabled={busy || !canSubmit} onClick={() => { void (async () => {
      if (!botId) return
      const request = submitted ?? { requestId, roomId: room.id, botId, background, messageIds: ids, ...(ownerRequired ? { owner: owner.trim() } : {}) }
      setBusy(true); setError(''); setSubmitted(request)
      try { const result = await face.invite(request); done(result) }
      catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); try { const value = await load(); if (!value.pending.some(item => item.request.requestId === request.requestId)) setSubmitted(undefined) } catch { /* Keep the original request for recovery. */ } }
      finally { setBusy(false) }
    })() }}>{busy ? copy('正在邀请…', 'Inviting…') : submitted ? copy('继续本次邀请', 'Resume invitation') : copy('邀请并继续', 'Invite and continue')}</Button></>}>
    <div className={css.form}>
      <p>{room.kind === 'dm' ? copy('会创建关联群聊，原私聊保留。', 'A linked group will be created. Your direct chat stays here.') : copy('会加入当前群聊。', 'The Bot will join this group.')} {copy(`${coordinator} 继续统筹；@ 或回复可指定其他 Bot。`, `${coordinator} stays coordinator; mention or reply to address another Bot.`)}</p>
      {error && <div role="alert" className={css.error}>{error}</div>}
      {!view && <Button disabled={busy} onClick={() => { void load().catch(() => {}) }}>{copy('重新加载列表', 'Reload list')}</Button>}
      <div className={css.inviteList} role="radiogroup" aria-label={copy('选择 Bot', 'Choose Bot')}>
        {view?.candidates.map(bot => <label key={bot.id} className={css.inviteCandidate}>
          <input type="radio" name="invite-bot" disabled={locked || bot.status !== 'available'} checked={bot.id === botId} onChange={() => setBot(bot.id)}/>
          <Avatar id={bot.id}/><span><strong>{bot.name}</strong><small>@{bot.id}</small><span>{bot.capabilities || copy('尚未填写能力介绍', 'No capability description yet')}</span></span>
          <small>{bot.status === 'member' ? copy('已在聊天中', 'In this chat') : bot.status === 'available' ? copy('可邀请', 'Available') : bot.status === 'binding-required' ? copy('需绑定 IM', 'Bind IM first') : copy('连接未就绪', 'Not connected')}</small>
        </label>)}
      </div>
      {room.external && <Button size="sm" disabled={busy} onClick={bindings}>{copy('管理 IM 绑定与权限', 'Manage IM connections')}</Button>}
      <label>{copy('共享背景（可编辑）', 'Shared background (editable)')}<textarea rows={6} maxLength={8000} disabled={locked} value={background} onChange={event => setBackground(event.target.value)} placeholder={copy('当前目标、已经确认的结论、需要对方帮助的问题…', 'Goal, agreed conclusions, and what you need help with…')}/></label>
      <p>{room.kind === 'group' && copy('加入后可访问本群公共历史。', 'Joining grants access to this group’s public history. ')}{copy('本次交接只分享这里的背景和你勾选的消息及附件。私聊历史和个人记忆不会整段复制。', 'Only this background and the messages and attachments you select are shared. Private chat history and personal memories are not copied wholesale.')}</p>
      <details><summary>{copy(`选择相关消息和附件（${ids.length}）`, `Select messages and attachments (${ids.length})`)}</summary>
        <div className={css.inviteHistory}>{room.messages.filter(message => message.status === 'complete' && (message.text || message.attachments?.length)).slice(-40).map(message => <label key={message.id}>
          <input type="checkbox" checked={ids.includes(message.id)} disabled={locked || !ids.includes(message.id) && ids.length >= 20} onChange={event => setIds(current => event.target.checked ? [...current, message.id] : current.filter(id => id !== message.id))}/>
          <span><strong>{view?.candidates.find(bot => bot.id === message.botId)?.name ?? copy('你', 'You')}</strong><span>{message.text}</span>{message.attachments?.map(item => <small key={item.attachment.attachmentId}>📎 {item.attachment.name}</small>)}</span>
        </label>)}</div>
      </details>
      {ownerRequired && <label>{copy('本次群主（唯一邀请的真人）', 'Group owner (the only human invited)')}{room.external?.provider === 'infoflow'
        ? <select disabled={locked} value={owner} onChange={event => setOwner(event.target.value)}><option value="">{copy('从邀请白名单选择', 'Choose from invitation allowlist')}</option>{view?.ownerChoices.map(user => <option key={user} value={user}>{user}</option>)}</select>
        : <input disabled={locked} value={owner} onChange={event => setOwner(event.target.value)} placeholder="ou_…"/>}</label>}
      {ownerRequired && room.external?.provider === 'feishu' && <p>{copy('填写原 Bot 应用对应的本人 Open ID；其他应用的 ID 不能混用。', 'Use your Open ID for the original Bot’s app. IDs from other apps cannot be substituted.')}</p>}
      {submitted && <p role="status">{copy('已保留本次邀请。若中途断开，继续同一次请求即可；不会另建群。', 'This invitation is saved. Resume the same request after a disconnect to avoid creating another group.')}</p>}
    </div>
  </Modal>
}
