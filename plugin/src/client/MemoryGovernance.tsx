import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { BotState } from '../types.ts'
import type { MemoryGovernanceView, MemoryScope } from '../memory-types.ts'
import type { CapabilityFace } from './capability-face.ts'
import css from './Panel.module.css'

export function MemoryGovernance({ state, face, scope, ownerId, english, refresh, revision }: {
  state: BotState; face: CapabilityFace; scope: MemoryScope | 'all'; ownerId: string; english: boolean; refresh(): void; revision: number
}) {
  const l = (zh: string, en: string) => english ? en : zh
  const [view, setView] = useState<MemoryGovernanceView>(), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [botId, setBotId] = useState(state.bots.find(bot => !bot.archived)?.id ?? ''), [drafts, setDrafts] = useState<Record<string, string>>({})
  useEffect(() => { let active = true; if (face.memoryGovernance) void face.memoryGovernance().then(result => { if (active) setView(result) }).catch(cause => { if (active) setError(String(cause)) }); return () => { active = false } }, [face, revision])
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('')
    try { await action(); setView(await face.memoryGovernance()); refresh() }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
    finally { setBusy(false) }
  }
  return <details><summary>{l('重复与冲突审核', 'Duplicate and conflict review')} · {view?.suggestions.length ?? 0}</summary>
    <p>{l('这里集中展示所有范围内待审核的记忆关系。语义检查分析当前所选范围，使用指定 Bot 的模型并计入预算。建议不会自动生效。', 'Review pending memory relationships across all scopes. Semantic review analyzes the selected scope using the chosen Bot’s model and budget. Suggestions require your approval.')}</p>
    {(scope === 'all' || !ownerId) && <p>{l('需要语义检查时，先在上方选择具体范围和对象。现有冲突仍列在下方。', 'To run a semantic review, choose a scope and owner above. Existing conflicts remain listed below.')}</p>}
    {error && <p role="alert" className={css.controlError}>{error}</p>}
    <label>{l('语义检查使用的 Bot', 'Bot for semantic review')}<select value={botId} disabled={busy} onChange={event => setBotId(event.target.value)}>{state.bots.filter(bot => !bot.archived).map(bot => <option key={bot.id} value={bot.id}>{bot.name}</option>)}</select></label>
    <div className={css.controlActions}><Button size="sm" disabled={busy || !botId || !ownerId || scope === 'all'} onClick={() => { if (scope !== 'all') void act(() => face.analyzeMemories({ botId, scope, ownerId })) }}>{busy ? l('正在检查…', 'Reviewing…') : l('检查当前范围的语义重复', 'Review selected scope semantically')}</Button><Button size="sm" disabled={busy} onClick={() => { void act(async () => {}) }}>{l('刷新冲突列表', 'Refresh conflicts')}</Button></div>
    {!view?.suggestions.length && <p>{l('暂无待审核的重复或冲突。', 'No pending duplicates or conflicts.')}</p>}
    {view?.suggestions.map(suggestion => {
      const left = view.records.find(memory => memory.id === suggestion.left.id), right = view.records.find(memory => memory.id === suggestion.right.id)
      if (!left || !right) return null
      const body = drafts[suggestion.id] ?? suggestion.proposedBody
      return <article key={suggestion.id} className={css.memoryCard}>
        <strong>{suggestion.relation === 'duplicate' ? l('可能重复', 'Possible duplicate') : l('可能冲突', 'Possible conflict')} · {left.scope}/{left.ownerId}</strong>
        <small>{suggestion.source === 'semantic' ? l('模型建议，需核实', 'Model suggestion; verify first') : l('同主题检查', 'Topic comparison')}</small><p>{suggestion.reason}</p>
        {[left, right].map((memory, i) => <blockquote key={memory.id}><strong>{i === 0 ? 'A' : 'B'} · {memory.subject} / {memory.topic}</strong><p>{memory.body}</p><small>{l('证据', 'Evidence')}: {memory.reviewEvidence ?? memory.source.evidence}</small></blockquote>)}
        <label>{l('审核后的合并内容', 'Reviewed merged text')}<textarea value={body} maxLength={1500} onChange={event => setDrafts(previous => ({ ...previous, [suggestion.id]: event.target.value }))}/></label>
        <div className={css.controlActions}>
          <Button size="sm" disabled={busy || !body.trim()} onClick={() => { void act(() => face.resolveMemorySuggestion({ id: suggestion.id, action: 'merge', body })) }}>{l('确认合并并生效', 'Confirm merge & activate')}</Button>
          <Button size="sm" disabled={busy} onClick={() => { void act(() => face.resolveMemorySuggestion({ id: suggestion.id, action: 'keep-left' })) }}>{l('采用 A', 'Use A')}</Button>
          <Button size="sm" disabled={busy} onClick={() => { void act(() => face.resolveMemorySuggestion({ id: suggestion.id, action: 'keep-right' })) }}>{l('采用 B', 'Use B')}</Button>
          <Button size="sm" disabled={busy} onClick={() => { void act(() => face.resolveMemorySuggestion({ id: suggestion.id, action: 'dismiss' })) }}>{l('保留两条，忽略建议', 'Keep both; dismiss')}</Button>
        </div>
      </article>
    })}
  </details>
}
