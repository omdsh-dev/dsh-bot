/** Local configuration surface: credentials are write-only and each robot has an independent connection. */
import { useEffect, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Bot, BotId, InfoFlowBindingView, InfoFlowState, Room } from '../types.ts'
import type { BotKey } from './locales.ts'
import type { InfoFlowFace } from './infoflow-face.ts'
import { parseInfoFlowCredentials } from './infoflow-credentials.ts'
import { Avatar } from './Avatar.tsx'
import css from './Panel.module.css'

type Translate = (key: BotKey) => string
export function InfoFlowPage({ bots, api, t, openRoom }: { bots: Bot[]; api: InfoFlowFace | undefined; t: Translate; openRoom(room: Room): void }) {
  const [snapshot, setSnapshot] = useState<InfoFlowState | null>(null)
  const [selected, setSelected] = useState<BotId | undefined>(bots[0]?.id)
  const [error, setError] = useState<string | null>(null)
  const refresh = async () => { if (api) setSnapshot(await api.snapshot()) }
  useEffect(() => {
    let live = true
    const update = async () => { try { const state = await api?.snapshot(); if (live && state) { setSnapshot(state); setError(null) } } catch { if (live) setError(t('ifRefreshFailed')) } }
    void update(); const timer = setInterval(() => { void update() }, 3000)
    return () => { live = false; clearInterval(timer) }
  }, [api, t])
  const bot = bots.find(item => item.id === selected) ?? bots[0]
  return <section className={css.infoflowProvider}>
    <header className={css.integrationProviderHeader}><div><h3>{t('ifTitle')}</h3><p>{t('ifSubtitle')}</p></div></header>
    {error && <div role="alert" className={css.error}>{error}</div>}
    {!api || snapshot?.available === false ? <p className={css.integrationNotice}>{t('ifUnavailable')}</p> : !snapshot ? <p>{t('loading')}</p> : <>
      <section className={css.infoflowGuide} aria-label={t('ifSetupTitle')}>
        <h3>{t('ifSetupTitle')}</h3>
        <ol><li><a href="https://open-ruliu.baidu-int.com/web" target="_blank" rel="noreferrer">{t('ifPlatform')}</a>{t('ifSetupCreate')}</li>
          <li>{t('ifSetupCredentials')}</li><li>{t('ifSetupVisibility')}</li></ol>
        <p>{t('ifVisibilityHint')}</p>
      </section>
      <div className={css.integrationBody}>
        <nav className={css.integrationBots} aria-label={t('ifChooseBot')}>{bots.map(item => {
          const binding = snapshot.bindings.find(value => value.botId === item.id)
          return <button type="button" key={item.id} aria-current={bot?.id === item.id ? 'page' : undefined} onClick={() => { setSelected(item.id) }}><Avatar id={item.id}/><span><strong>{item.name}</strong><small>{binding?.robotName || t('ifUnbound')}</small></span><span className={css.connection} data-ready={binding?.status === 'connected'}/></button>
        })}</nav>
        {bot ? <BindingEditor key={bot.id} bot={bot} binding={snapshot.bindings.find(item => item.botId === bot.id)} api={api} t={t} changed={refresh}/> : <p>{t('empty')}</p>}
      </div>
      {!!snapshot.groups.length && <section className={css.integrationGroups}><h3>{t('ifLinkedGroups')}</h3>{snapshot.groups.map(group => <article key={group.requestId}>
        <div><strong>{group.title}</strong><p>{group.groupId ? `${t('ifGroupId')}: ${group.groupId}` : t('ifGroupUncertain')}</p>{group.warning && <p role="status">{group.warning}</p>}</div>
        {group.groupId && <Button onClick={() => { void api.resumeGroup(group.requestId).then(room => { openRoom(room) }).catch(cause => { setError(String(cause instanceof Error ? cause.message : cause)) }) }}>{t(group.roomId ? 'ifOpenChat' : 'ifResumeGroup')}</Button>}
      </article>)}</section>}
    </>}
  </section>
}

function BindingEditor({ bot, binding, api, t, changed }: { bot: Bot; binding: InfoFlowBindingView | undefined; api: InfoFlowFace; t: Translate; changed(): Promise<void> }) {
  const [key, setKey] = useState(''), [secret, setSecret] = useState('')
  const [agentId, setAgentId] = useState(binding?.agentId ?? '')
  const [allowUsers, setUsers] = useState(binding?.allowUsers.join(', ') ?? '')
  const [allowGroups, setGroups] = useState(binding?.allowGroups.join(', ') ?? '')
  const [allGroups, setAllGroups] = useState(binding?.allowAllGroups === true)
  const [admins, setAdmins] = useState(binding?.admins.join(', ') ?? '')
  const [recipient, setRecipient] = useState('')
  const [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null), [message, setMessage] = useState<string | null>(null)
  const list = (value: string) => value.split(/[,，\s]+/).map(item => item.trim()).filter(Boolean)
  useEffect(() => {
    if (dirty) return
    setAgentId(binding?.agentId ?? ''); setUsers(binding?.allowUsers.join(', ') ?? '')
    setGroups(binding?.allowGroups.join(', ') ?? ''); setAdmins(binding?.admins.join(', ') ?? '')
    setAllGroups(binding?.allowAllGroups === true)
  }, [binding, dirty])
  const reset = () => {
    setKey(''); setSecret(''); setAgentId(binding?.agentId ?? '')
    setUsers(binding?.allowUsers.join(', ') ?? ''); setGroups(binding?.allowGroups.join(', ') ?? '')
    setAdmins(binding?.admins.join(', ') ?? ''); setAllGroups(binding?.allowAllGroups === true)
    setDirty(false); setError(null); setMessage(null)
  }
  const run = async (action: () => Promise<unknown>, success: BotKey) => {
    setBusy(true); setError(null); setMessage(null)
    try { await action(); setMessage(t(success)) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally {
      try { await changed() } catch { setError(current => current ?? t('ifRefreshFailed')) }
      setBusy(false)
    }
  }
  const save = (connect: boolean) => run(async () => {
    const saved = await api.save({ botId: bot.id, ...(key ? { appKey: key } : {}), ...(secret ? { appSecret: secret } : {}),
      ...(agentId.trim() ? { agentId: agentId.trim() } : {}), ...(connect ? { connect: true } : {}),
      allowUsers: list(allowUsers), allowGroups: list(allowGroups), allowAllGroups: allGroups, admins: list(admins) })
    setKey(''); setSecret(''); setDirty(false)
    if (saved.status === 'error') throw new Error(saved.error || t('ifConnectionError'))
  }, connect ? 'ifSavedConnecting' : 'ifSaved')
  const status = binding?.status ?? 'disabled'
  const testUser = binding?.allowUsers.includes(recipient) ? recipient : binding?.allowUsers[0] ?? ''
  return <section className={css.integrationEditor}>
    <div className={css.integrationIdentity}><Avatar id={bot.id} large/><div><h3>{bot.name}</h3><p>@{bot.id}</p></div><span className={css.integrationStatus} data-status={status}>{t(status === 'connected' ? 'ifConnected' : status === 'connecting' ? 'ifConnecting' : status === 'error' ? 'ifConnectionError' : 'ifDisabled')}</span></div>
    {binding && <div className={css.integrationNotice}><strong>{binding.robotName}</strong><p>Agent ID: {binding.agentId} · IMID: {binding.robotId}</p>{binding.error && <p role="alert">{binding.error}</p>}</div>}
    <form className={css.form} onSubmit={event => { event.preventDefault(); void save(true) }}>
      <fieldset className={css.infoflowFields} disabled={busy}>
        <label>{t('ifPasteCredentials')}<Input type="password" autoComplete="off" aria-label={t('ifPasteCredentials')} value="" placeholder={t('ifPasteHint')} onChange={() => {}} onPaste={event => {
          event.preventDefault()
          const parsed = parseInfoFlowCredentials(event.clipboardData.getData('text'))
          if (!parsed) { setError(t('ifPasteFailed')); setMessage(null); return }
          setKey(parsed.appKey); setSecret(parsed.appSecret); setAgentId(parsed.agentId ?? '')
          setDirty(true); setError(null); setMessage(t('ifPasted'))
        }}/></label>
        <label>{t('ifAppId')}<Input aria-label={t('ifAppId')} value={agentId} placeholder={t('ifAppIdHint')} onChange={event => { setAgentId(event.target.value); setDirty(true) }}/></label>
        <div className={css.formGrid}><label>AppKey<Input type="password" autoComplete="new-password" value={key} placeholder={binding?.credentialsConfigured ? t('ifKeepSaved') : t('ifRequired')} onChange={event => { setKey(event.target.value); setDirty(true) }}/></label>
          <label>AppSecret<Input type="password" autoComplete="new-password" value={secret} placeholder={binding?.credentialsConfigured ? t('ifKeepSaved') : t('ifRequired')} onChange={event => { setSecret(event.target.value); setDirty(true) }}/></label></div>
        <p className={css.integrationHint}>{t('ifCredentialHint')}</p>
        <label>{t('ifAllowUsers')}<Input aria-label={t('ifAllowUsers')} value={allowUsers} onChange={event => { setUsers(event.target.value); setDirty(true) }}/><small>{t('ifAllowUsersHint')}</small></label>
        <label className={css.infoflowCheck}><input type="checkbox" checked={allGroups} onChange={event => { setAllGroups(event.target.checked); setDirty(true) }}/>{t('ifAllGroups')}</label>
        <p className={css.integrationHint}>{t('ifAllGroupsHint')}</p>
        {!allGroups && <label>{t('ifAllowGroups')}<Input aria-label={t('ifAllowGroups')} value={allowGroups} onChange={event => { setGroups(event.target.value); setDirty(true) }}/><small>{t('ifAllowGroupsHint')}</small></label>}
        <details><summary>{t('ifAdvanced')}</summary><label>{t('ifAdmins')}<Input aria-label={t('ifAdmins')} value={admins} onChange={event => { setAdmins(event.target.value); setDirty(true) }}/><small>{t('ifAdminsHint')}</small></label></details>
        <div className={css.integrationActions}><Button type="submit" variant="primary">{t('ifSaveConnect')}</Button>
          <Button type="button" onClick={() => { void save(false) }}>{t('ifSaveVerify')}</Button>
          <Button type="button" onClick={reset}>{t('ifResetDraft')}</Button></div>
      </fieldset>
      {error && <div role="alert" className={css.error}>{error}</div>}{message && <p role="status" className={css.integrationHint}>{message}</p>}
      {binding && <div className={css.integrationActions}><Button disabled={busy || dirty} onClick={() => { void run(() => api.verify(bot.id), 'ifVerified') }}>{t('ifVerify')}</Button>
        <Button disabled={busy || dirty} onClick={() => { void run(async () => {
          const next = await api.toggle({ botId: bot.id, enabled: !binding.enabled })
          if (next.status === 'error') throw new Error(next.error || t('ifConnectionError'))
        }, binding.enabled ? 'ifStopped' : 'ifStarted') }}>{t(binding.enabled ? 'ifDisable' : 'ifEnable')}</Button></div>}
      <p className={css.integrationHint}>{t('ifEnableHint')}</p>
    </form>
    <section className={css.infoflowTest}><h4>{t('ifTestTitle')}</h4><p className={css.integrationHint}>{t('ifTestHint')}</p>
      <label>{t('ifTestRecipient')}<select aria-label={t('ifTestRecipient')} value={testUser} disabled={busy || dirty || !testUser} onChange={event => { setRecipient(event.target.value) }}>
        {!testUser && <option value="">{t('ifTestNeedsUser')}</option>}{binding?.allowUsers.map(user => <option key={user} value={user}>{user}</option>)}
      </select></label>
      <Button disabled={busy || dirty || !testUser} onClick={() => { void run(() => api.testMessage({ botId: bot.id, user: testUser }), 'ifTestSent') }}>{t('ifTestSend')}</Button>
    </section>
  </section>
}
