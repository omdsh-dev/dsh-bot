/** Shared IM configuration navigation; provider forms retain drafts while switching tabs. */
import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Bot, BotId, Room, RoomId } from '../types.ts'
import type { BotKey } from './locales.ts'
import type { FeishuFace } from './feishu-face.ts'
import type { InfoFlowFace } from './infoflow-face.ts'
import type { FeishuGroupView } from '../feishu/types.ts'
import { FeishuPage } from './FeishuPage.tsx'
import { InfoFlowPage } from './InfoFlowPage.tsx'
import css from './Panel.module.css'

interface Props {
  bots: Bot[]; feishu: FeishuFace | undefined; infoflow: InfoFlowFace | undefined
  infoflowVisible: boolean
  settingsDisabled: boolean
  setInfoflowVisible(visible: boolean): Promise<boolean>
  t(key: BotKey): string
  back(): void
  openRoom(room: Room): void
  selectRoom(id: RoomId): void
  createFeishuGroup(id: BotId, failed?: FeishuGroupView): void
}
/** One configuration panel for installed and not-yet-installed IM providers. */
export function IMPanel({ bots, feishu, infoflow, infoflowVisible, settingsDisabled, setInfoflowVisible, t, back, openRoom, selectRoom, createFeishuGroup }: Props) {
  const providers = infoflowVisible ? ['feishu', 'infoflow'] as const : ['feishu'] as const
  const [provider, setProvider] = useState<'feishu' | 'infoflow'>('feishu')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selected = infoflowVisible ? provider : 'feishu'
  useEffect(() => { if (!infoflowVisible) setProvider('feishu') }, [infoflowVisible])
  const toggleInfoflow = async (visible: boolean) => {
    setSaving(true); setError(null)
    try { await setInfoflowVisible(visible) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setSaving(false) }
  }
  const id = useId()
  const tabs = useRef<Array<HTMLButtonElement | null>>([])
  return <main className={css.integrationPage}>
    <header className={css.integrationHeader}>
      <div><span className={css.workspaceLabel}>{t('imConfiguration')}</span><h2>{t('imTitle')}</h2><p>{t('imSubtitle')}</p></div>
      <Button onClick={back}>{t('ifBack')}</Button>
    </header>
    <details className={css.integrationPreferences}>
      <summary>{t('imAdvanced')}</summary>
      <label><input type="checkbox" checked={infoflowVisible} disabled={saving || settingsDisabled}
        onChange={event => { void toggleInfoflow(event.target.checked) }}/>{t('imShowInfoflow')}</label>
      <p className={css.integrationHint}>{t('imInfoflowVisibilityHint')}</p>
    </details>
    {error && <div role="alert" className={css.error}>{error}</div>}
    <div className={css.integrationTabs} role="tablist" aria-label={t('imPlatforms')}>
      {providers.map((item, index) => <button type="button" role="tab" key={item} ref={node => { tabs.current[index] = node }}
        id={`${id}-${item}-tab`} aria-controls={`${id}-${item}-panel`} aria-selected={selected === item} tabIndex={selected === item ? 0 : -1}
        onClick={() => { setProvider(item) }} onKeyDown={event => {
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? providers.length - 1
            : event.key === 'ArrowRight' ? (index + 1) % providers.length : event.key === 'ArrowLeft' ? (index + providers.length - 1) % providers.length : undefined
          if (next === undefined) return
          event.preventDefault(); setProvider(providers[next]!); tabs.current[next]?.focus()
        }}>{t(item)}</button>)}
    </div>
    <div role="tabpanel" id={`${id}-feishu-panel`} aria-labelledby={`${id}-feishu-tab`} hidden={selected !== 'feishu'}>
      <FeishuPage bots={bots} api={feishu} t={t} createGroup={createFeishuGroup} openRoom={openRoom} selectRoom={selectRoom}/>
    </div>
    {infoflowVisible && <div role="tabpanel" id={`${id}-infoflow-panel`} aria-labelledby={`${id}-infoflow-tab`} hidden={selected !== 'infoflow'}>
      <InfoFlowPage bots={bots} api={infoflow} t={t} openRoom={openRoom}/>
    </div>}
  </main>
}
