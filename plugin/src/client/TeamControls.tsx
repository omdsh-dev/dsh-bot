import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { BotState } from '../types.ts'
import type { TeamOperation, TeamSettings, TeamView } from '../team-types.ts'
import type { CapabilityFace } from './capability-face.ts'
import css from './Panel.module.css'

export function TeamControls({ state, face, english }: { state: BotState; face: CapabilityFace; english: boolean }) {
  const l = (zh: string, en: string) => english ? en : zh
  const [view, setView] = useState<TeamView>(), [settings, setSettings] = useState<TeamSettings>(), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const operations: [TeamOperation, string][] = [['create-bot', l('创建 Bot', 'Create Bots')], ['edit-bot', l('编辑 Bot 名称和说明', 'Edit Bot names and instructions')], ['create-group', l('创建本地群聊', 'Create local groups')], ['edit-group', l('编辑本地群聊和成员', 'Edit local groups and members')], ['archive', l('归档和恢复', 'Archive and restore')]]
  useEffect(() => { let active = true; void face.teamView().then(value => { if (active) { setView(value); setSettings(value.settings) } }).catch(cause => { if (active) setError(String(cause)) }); return () => { active = false } }, [face])
  return <section aria-label={l('Main Bot 团队管理', 'Main Bot team management')}>
    <p>{l('选定 Main Bot，并逐项授权。只在 DSH 中与它私聊时生效；群聊、外部 IM 和定时任务不能使用团队管理权限。', 'Choose a Main Bot and grant each operation explicitly. Authority applies only to your direct local DSH chat; groups, external IM and scheduled tasks cannot use it.')}</p>
    {error && <p role="alert">{error}</p>}
    {settings && <form onSubmit={event => { event.preventDefault(); setBusy(true); setError(''); void face.configureTeam(settings).then(async () => { const value = await face.teamView(); setView(value); setSettings(value.settings) }).catch(cause => setError(String(cause))).finally(() => setBusy(false)) }}>
      <fieldset disabled={busy}><label>Main Bot<select value={settings.botId ?? ''} onChange={event => setSettings({ ...settings, botId: event.target.value || null, operations: [] })}><option value="">{l('未启用', 'Disabled')}</option>{state.bots.filter(bot => !bot.archived).map(bot => <option key={bot.id} value={bot.id}>{bot.name}</option>)}</select></label>
        {operations.map(([operation, title]) => <label key={operation} className={css.checkOption}><input type="checkbox" disabled={!settings.botId} checked={settings.operations.includes(operation)} onChange={event => setSettings({ ...settings, operations: event.target.checked ? [...settings.operations, operation] : settings.operations.filter(item => item !== operation) })}/>{title}</label>)}
        <Button type="submit" variant="primary">{l('保存团队管理授权', 'Save team grants')}</Button>
      </fieldset>
    </form>}
    <p>{l('Main Bot 无权更改自己的身份、模型和工具权限、凭据、预算或外部连接，也不能删除数据。修改授权会停止受影响 Bot 的当前工作。', 'The Main Bot cannot edit itself, policies, credentials, budgets or external connections, or delete data. Changing grants stops affected Bot work.')}</p>
    <h4>{l('最近的团队变更', 'Recent team changes')}</h4>
    {view?.audit.length ? <ol>{view.audit.slice(-50).reverse().map(item => <li key={item.id}><time>{new Date(item.time).toLocaleString()}</time> · {item.botId} · {operations.find(([operation]) => operation === item.operation)?.[1]} · {item.targetId}</li>)}</ol> : <p>{l('还没有团队变更', 'No team changes yet')}</p>}
  </section>
}
