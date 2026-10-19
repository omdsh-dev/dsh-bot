/** First-party device registration and write-only manual binding, scoped to the selected Bot. */
import { useEffect, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Bot, BotId, Room, RoomId } from '../types.ts'
import type { Brand, FeishuBindingView, FeishuGroupView, FeishuRegistration, FeishuState } from '../feishu/types.ts'
import type { BotKey } from './locales.ts'
import type { FeishuFace } from './feishu-face.ts'
import { Avatar } from './Avatar.tsx'
import css from './Panel.module.css'
type Translate = (key: BotKey) => string
export function FeishuPage({ bots, api, t, createGroup, openRoom, selectRoom }: { bots: Bot[]; api: FeishuFace | undefined; t: Translate; createGroup(id: BotId, failed?: FeishuGroupView): void; openRoom(room: Room): void; selectRoom(id: RoomId): void }) {
  const [snapshot, setSnapshot] = useState<FeishuState | null>(null)
  const [selected, setSelected] = useState<BotId | undefined>(bots[0]?.id)
  const [error, setError] = useState<string | null>(null)
  const [resuming, setResuming] = useState(false)
  const [groupError, setGroupError] = useState<string | null>(null)
  const refresh = async () => { if (api) setSnapshot(await api.snapshot()) }
  useEffect(() => {
    let live = true
    const update = async () => { try { const state = await api?.snapshot(); if (live && state) { setSnapshot(state); setError(null) } } catch { if (live) setError(t('fsRefreshFailed')) } }
    void update(); const timer = setInterval(() => { void update() }, 2000)
    return () => { live = false; clearInterval(timer) }
  }, [api, t])
  const bot = bots.find(item => item.id === selected) ?? bots[0]
  return <section>
    <header className={css.integrationProviderHeader}><div><h3>{t('fsTitle')}</h3><p>{t('fsSubtitle')}</p></div><Button variant="primary" disabled={!bot || !snapshot?.bindings.some(binding => binding.botId === bot.id && binding.enabled)} onClick={() => { if (bot) createGroup(bot.id) }}>{t('fsNewGroup')}</Button></header>
    {error && <p role="alert" className={css.error}>{error}</p>}
    {!api || snapshot?.available === false ? <p className={css.integrationNotice}>{t('fsUnavailable')}</p> : !snapshot ? <p>{t('loading')}</p> : <div className={css.integrationBody}>
      <nav className={css.integrationBots} aria-label={t('fsChooseBot')}>{bots.map(item => {
        const binding = snapshot.bindings.find(value => value.botId === item.id)
        return <button type="button" key={item.id} aria-current={bot?.id === item.id ? 'page' : undefined} onClick={() => { setSelected(item.id) }}><Avatar id={item.id}/><span><strong>{item.name}</strong><small>{binding?.robotName || t('ifUnbound')}</small></span><span className={css.connection} data-ready={binding?.status === 'connected'}/></button>
      })}</nav>
      {bot ? <Editor key={bot.id} bot={bot} binding={snapshot.bindings.find(item => item.botId === bot.id)} registration={snapshot.registrations.find(item => item.botId === bot.id)} api={api} t={t} changed={refresh}/> : <p>{t('empty')}</p>}
    </div>}
    {!!snapshot?.groups.length && <section className={css.integrationEditor}><h3>{t('fsManagedGroups')}</h3>
      {groupError && <p role="alert" className={css.error}>{groupError}</p>}
      {snapshot.groups.map(group => <div className={css.integrationNotice} key={group.requestId}><strong>{group.title}</strong>
        <p>{t(group.status === 'ready' ? 'fsGroupReady' : group.status === 'linking' ? 'fsGroupLinking' : group.status === 'failed' ? 'fsGroupFailed' : 'fsGroupPending')}</p>
        {group.chatId && <p>Chat ID: {group.chatId}</p>}{group.error && <p>{group.error}</p>}
        {group.status === 'ready' && group.roomId ? <Button onClick={() => { selectRoom(group.roomId!) }}>{t('fsGroupHistory')}</Button> : <Button disabled={resuming} onClick={() => {
          setResuming(true); setGroupError(null)
          void api!.resumeGroup(group.requestId).then(openRoom).catch(cause => { setGroupError(cause instanceof Error ? cause.message : String(cause)) }).finally(() => { setResuming(false); void refresh().catch(() => { setGroupError(t('fsRefreshFailed')) }) })
        }}>{t('fsGroupResume')}</Button>}
        {group.status === 'failed' && !group.chatId && <Button disabled={resuming} onClick={() => { createGroup(group.creatorBot, group) }}>{t('fsGroupEdit')}</Button>}
      </div>)}
    </section>}
  </section>
}
function Editor({ bot, binding, registration, api, t, changed }: { bot: Bot; binding: FeishuBindingView | undefined; registration: FeishuRegistration | undefined; api: FeishuFace; t: Translate; changed(): Promise<void> }) {
  const [appId, setAppId] = useState(binding?.appId ?? ''), [secret, setSecret] = useState('')
  const [brand, setBrand] = useState<Brand>(binding?.brand ?? 'feishu')
  const [users, setUsers] = useState(binding?.allowUsers.join(', ') ?? ''), [groups, setGroups] = useState(binding?.allowGroups.join(', ') ?? ''), [admins, setAdmins] = useState(binding?.admins.join(', ') ?? '')
  const [allGroups, setAllGroups] = useState(binding?.allowAllGroups === true)
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [manual, setManual] = useState(false)
  const [error, setError] = useState<string | null>(null), [message, setMessage] = useState<string | null>(null)
  useEffect(() => {
    if (!dirty) { setAppId(binding?.appId ?? ''); setBrand(binding?.brand ?? 'feishu'); setUsers(binding?.allowUsers.join(', ') ?? ''); setGroups(binding?.allowGroups.join(', ') ?? ''); setAdmins(binding?.admins.join(', ') ?? ''); setAllGroups(binding?.allowAllGroups === true) }
  }, [binding, dirty])
  const run = async (action: () => Promise<unknown>, success?: BotKey) => {
    setBusy(true); setError(null); setMessage(null)
    try { await action(); await changed(); if (success) setMessage(t(success)) } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  const active = !!registration && ['starting', 'waiting', 'saving'].includes(registration.status)
  const status = binding?.status ?? 'disabled'
  const list = (value: string) => value.split(/[,，\s]+/).filter(Boolean)
  return <section className={css.integrationEditor}>
    <div className={css.integrationIdentity}><Avatar id={bot.id} large/><div><h3>{bot.name}</h3><p>@{bot.id}</p></div><span className={css.integrationStatus} data-status={status}>{t(status === 'connected' ? 'fsConnected' : status === 'connecting' ? 'ifConnecting' : status === 'error' ? 'ifConnectionError' : 'ifDisabled')}</span></div>
    {!binding && <div className={css.integrationNotice}><strong>{t('fsCreateTitle')}</strong><p>{t('fsCreateHint')}</p>
      <div className={css.integrationActions}><Button variant="primary" disabled={busy || active} onClick={() => { void run(() => api.register(bot.id)) }}>{t('fsCreate')}</Button><Button disabled={active} onClick={() => { setManual(!manual) }}>{t('fsManual')}</Button></div>
    </div>}
    {registration && <div className={css.registration} role="status">
      <strong>{t(registration.status === 'starting' ? 'fsStarting' : registration.status === 'waiting' ? 'fsWaiting' : registration.status === 'saving' ? 'fsSaving' : registration.status === 'complete' ? 'fsComplete' : registration.status === 'expired' ? 'fsExpired' : registration.status === 'canceled' ? 'fsCanceled' : 'fsRegistrationError')}</strong>
      {registration.qrDataUrl && <img className={css.registrationQr} src={registration.qrDataUrl} width={240} height={240} alt={t('fsQrAlt')}/>}
      {registration.url && <a href={registration.url} target="_blank" rel="noreferrer noopener">{t('fsOpenLink')}</a>}
      {registration.expiresAt && active && <p>{t('fsExpires')} {new Date(registration.expiresAt).toLocaleTimeString()}</p>}
      {registration.message && <p>{registration.message}</p>}
      {active && <Button disabled={busy || registration.status === 'saving'} onClick={() => { void run(() => api.cancel(registration.attemptId)) }}>{t('fsCancel')}</Button>}
    </div>}
    {binding && <p className={css.integrationHint}>{t('fsGroupPermission')} <a href={`https://${binding.brand === 'lark' ? 'open.larksuite.com' : 'open.feishu.cn'}/app/${encodeURIComponent(binding.appId)}/auth?q=im%3Achat%3Acreate`} target="_blank" rel="noreferrer noopener">{t('fsGroupAuthorize')}</a></p>}
    {binding && <div className={css.integrationNotice}><strong>{binding.robotName}</strong><p>App ID: {binding.appId}</p><p>Bot Open ID: {binding.botOpenId || '—'}</p>{binding.error && <p role="alert">{binding.error}</p>}</div>}
    {(binding || manual) && <form className={css.form} onSubmit={event => { event.preventDefault(); void run(async () => {
      await api.save({ botId: bot.id, appId, brand, ...(secret ? { appSecret: secret } : {}), allowUsers: list(users), allowGroups: list(groups), allowAllGroups: allGroups, admins: list(admins) })
      setSecret(''); setDirty(false)
    }, 'ifSaved') }}>
      <label>{t('fsPlatform')}<select disabled={!!binding || active} value={brand} onChange={event => { setBrand(event.target.value === 'lark' ? 'lark' : 'feishu'); setDirty(true) }}><option value="feishu">{t('feishu')}</option><option value="lark">Lark</option></select></label>
      <label>App ID<Input required value={appId} disabled={!!binding || active} placeholder="cli_…" onChange={event => { setAppId(event.target.value); setDirty(true) }}/></label>
      <label>App Secret<Input type="password" autoComplete="new-password" value={secret} disabled={active} placeholder={binding ? t('ifKeepSaved') : t('ifRequired')} onChange={event => { setSecret(event.target.value); setDirty(true) }}/></label>
      <p className={css.integrationHint}>{t('ifCredentialHint')}</p>
      <label>{t('fsAllowUsers')}<Input aria-label={t('fsAllowUsers')} value={users} disabled={active} placeholder="ou_…" onChange={event => { setUsers(event.target.value); setDirty(true) }}/><small>{t('fsAllowUsersHint')}</small></label>
      <label className={css.infoflowCheck}><input type="checkbox" checked={allGroups} disabled={busy || active} onChange={event => { setAllGroups(event.target.checked); setDirty(true) }}/>{t('ifAllGroups')}</label>
      <p className={css.integrationHint}>{t('ifAllGroupsHint')}</p>
      {!allGroups && <label>{t('fsAllowGroups')}<Input aria-label={t('fsAllowGroups')} value={groups} disabled={active} placeholder="oc_…" onChange={event => { setGroups(event.target.value); setDirty(true) }}/><small>{t('fsAllowGroupsHint')}</small></label>}
      <label>{t('fsAdmins')}<Input aria-label={t('fsAdmins')} value={admins} disabled={active} placeholder="ou_…" onChange={event => { setAdmins(event.target.value); setDirty(true) }}/></label>
      <div className={css.integrationActions}><Button type="submit" variant="primary" disabled={busy || active}>{t('ifSaveVerify')}</Button>
        <Button disabled={busy || active || !binding || dirty} onClick={() => { void run(() => api.verify(bot.id), 'ifVerified') }}>{t('ifVerify')}</Button>
        <Button disabled={busy || active || !binding || dirty} onClick={() => { void run(() => api.toggle({ botId: bot.id, enabled: !binding?.enabled }), binding?.enabled ? 'ifStopped' : 'ifStarted') }}>{t(binding?.enabled ? 'ifDisable' : 'ifEnable')}</Button></div>
    </form>}
    {error && <p role="alert" className={css.error}>{error}</p>}{message && <p role="status" className={css.integrationHint}>{message}</p>}
    <p className={css.integrationHint}>{t('fsPermissionHint')}</p>
  </section>
}
