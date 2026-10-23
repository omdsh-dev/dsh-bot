import { useEffect, useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { UsageReport, UsageTotals } from '../usage.ts'
import type { CapabilityFace } from './capability-face.ts'
import type { UsageFilter } from '../usage-types.ts'
import { UsageLedger } from './UsageLedger.tsx'
import css from './Panel.module.css'

/** Budget counters and retained-record totals have different lifetimes; never add them together. */
export function UsagePage({ face, english, connectionError, back, openBudget }: {
  face: CapabilityFace; english: boolean; connectionError: string | null; back(): void; openBudget(): void
}) {
  const l = (zh: string, en: string) => english ? en : zh
  const [report, setReport] = useState<UsageReport>(), [error, setError] = useState(''), [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0), [botId, setBotId] = useState('*')
  const [filter, setFilter] = useState<UsageFilter>({})
  useEffect(() => {
    let live = true, pending = false
    const load = async () => {
      if (pending) return
      pending = true; setLoading(true)
      try { const next = await face.usageReport({ ...filter, botId: botId === '*' ? undefined : botId }); if (live) { setReport(next); setError('') } }
      catch (cause) { if (live) setError(cause instanceof Error ? cause.message : String(cause)) }
      finally { pending = false; if (live) setLoading(false) }
    }
    void load()
    const timer = setInterval(() => { void load() }, 15000)
    return () => { live = false; clearInterval(timer) }
  }, [face, refresh, filter, botId])
  const number = (value: number) => value.toLocaleString(english ? 'en-US' : 'zh-CN')
  const cost = (value: number, currency: string) => `${currency} ${value.toLocaleString(english ? 'en-US' : 'zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`
  const tokens = (total: UsageTotals) => total.input + total.output
  const global = report?.budgets.find(item => item.scope === '*')
  const selected = report?.bots.some(bot => bot.botId === botId) ? botId : '*'
  const rows = (report?.bots ?? []).filter(bot => selected === '*' || selected === bot.botId)
    .sort((a, b) => tokens(b.conversation) + tokens(b.memory) + tokens(b.handoff) - tokens(a.conversation) - tokens(a.memory) - tokens(a.handoff))
  const purposes = [
    { key: 'conversation' as const, name: l('聊天回复', 'Chat responses'), unit: l('条已报告用量的回复', 'responses reporting usage') },
    { key: 'memory' as const, name: l('记忆整理', 'Memory review'), unit: l('次辅助调用', 'auxiliary calls') },
    { key: 'handoff' as const, name: l('上下文交接', 'Context handoff'), unit: l('次辅助调用', 'auxiliary calls') },
  ]
  const period = (value: 'never' | 'day' | 'month' | undefined) => value === 'day' ? l('按日重置（UTC）', 'Resets daily (UTC)') : value === 'month' ? l('按月重置（UTC）', 'Resets monthly (UTC)') : l('手动重置', 'Manual reset')
  return <main className={`${css.integrationPage} ${css.usagePage}`}>
    <header className={css.integrationHeader}>
      <div><span className={css.workspaceLabel}>{l('当前部署', 'Current deployment')}</span><h2>{l('用量', 'Usage')}</h2><p>{l('查看 Token 消耗、估算费用和预算余量。', 'Track token consumption, estimated spending and remaining budgets.')}</p></div>
      <Button onClick={back}>{l('返回聊天', 'Back to chat')}</Button>
    </header>
    <div className={css.usageToolbar}>
      <span role="status">{report ? `${l('更新于', 'Updated')} ${new Date(report.generatedAt).toLocaleTimeString()} · ${l('每 15 秒刷新', 'refreshes every 15 seconds')}` : loading ? l('正在读取用量…', 'Loading usage…') : l('尚未读取到用量', 'Usage unavailable')}</span>
      <div className={css.controlActions}><Button size="sm" disabled={loading} onClick={() => setRefresh(value => value + 1)}>{loading ? l('读取中…', 'Loading…') : l('刷新用量', 'Refresh usage')}</Button><Button size="sm" onClick={openBudget}>{l('管理预算', 'Manage budgets')}</Button></div>
    </div>
    {(error || connectionError) && <p role="alert" className={css.controlError}>{l('更新失败，已显示的数据可能过时。', 'Update failed. Displayed data may be stale.')} {error || connectionError}</p>}
    {report && <>
      <section aria-label={l('总预算用量', 'Overall budget usage')} className={css.usageSection}>
        <h3>{l('总预算用量', 'Overall budget usage')}</h3>
        <p className={css.integrationHint}>{global ? `${period(global.budget.period)} · ${l('本期起点', 'Period start')} ${new Date(global.budget.since).toLocaleString()}` : l('尚无总预算记账记录，首次报告用量后开始累计。', 'No overall budget usage yet. Tracking starts when usage is reported.')}</p>
        <div className={css.usageMetrics}>
          {[
            { label: l('已记账 Token', 'Accounted tokens'), value: number((global?.budget.used.input ?? 0) + (global?.budget.used.output ?? 0)) },
            { label: l('输入 Token', 'Input tokens'), value: number(global?.budget.used.input ?? 0) },
            { label: l('输出 Token', 'Output tokens'), value: number(global?.budget.used.output ?? 0) },
            { label: l('估算费用', 'Estimated cost'), value: global ? cost(global.budget.used.cost, global.budget.currency) : '—' },
          ].map(item => <article key={item.label}><span>{item.label}</span><strong>{item.value}</strong></article>)}
        </div>
        <p className={css.integrationHint}>{l('包含聊天、记忆整理和上下文交接；未报告用量的失败调用可能按预留额度记账。费用按当时配置的单价估算，未配置单价的部分未计入费用，0 不代表免费。', 'Includes chats, memory reviews and handoffs. Failed calls without usage reports may be charged their reservation. Costs use prices configured at the time; unpriced usage is excluded, so zero does not mean free.')}</p>
      </section>
      <section className={css.usageSection} aria-label={l('累计已记录用量', 'Retained usage records')}>
        <div className={css.usageSectionHeading}><h3>{l('累计已记录用量', 'Retained usage records')}</h3><label>{l('筛选 Bot', 'Filter Bot')}<select value={selected} onChange={event => setBotId(event.target.value)}><option value="*">{l('全部 Bot', 'All Bots')}</option>{report.bots.map(bot => <option key={bot.botId} value={bot.botId}>{bot.name} · @{bot.botId}</option>)}</select></label></div>
        <p className={css.integrationHint}>{report.ledger ? l('当前筛选范围内的独立账本统计；删除聊天或重置预算不会删除用量记录。', 'Independent ledger totals for the current filters. Deleting chats or resetting budgets preserves usage records.') : l('统计全部保留的聊天用量和累计辅助调用，包含归档聊天。', 'Includes all retained chat usage, archived chats and cumulative auxiliary calls.')}</p>
        <div className={css.usageSources}>{purposes.map(purpose => {
          const total = rows.reduce((sum, row) => ({ input: sum.input + row[purpose.key].input, output: sum.output + row[purpose.key].output, records: sum.records + row[purpose.key].records }), { input: 0, output: 0, records: 0 })
          return <article key={purpose.key}><span>{purpose.name}</span><strong>{number(tokens(total))} <small>tokens</small></strong><p>{number(total.records)} {purpose.unit}</p></article>
        })}</div>
        {rows.length ? <div className={css.usageTableWrap}><table className={css.usageTable} aria-label={l('各 Bot 用量', 'Usage by Bot')}><thead><tr>
          {[l('Bot', 'Bot'), l('输入', 'Input'), l('输出', 'Output'), l('合计 Token', 'Total tokens'), l('其中辅助 Token', 'Auxiliary tokens'), l('回复 / 辅助调用', 'Responses / auxiliary calls')].map(label => <th key={label} scope="col">{label}</th>)}
        </tr></thead><tbody>{rows.map(bot => <tr key={bot.botId}>
          <th scope="row"><strong>{bot.name}</strong><small>@{bot.botId}{bot.deleted ? l(' · 已删除', ' · deleted') : bot.archived ? l(' · 已归档', ' · archived') : ''}</small>{!bot.pricesConfigured && !bot.deleted && <small>{l('当前未配齐单价', 'Token prices incomplete')}</small>}</th>
          <td>{number(bot.conversation.input + bot.memory.input + bot.handoff.input)}</td><td>{number(bot.conversation.output + bot.memory.output + bot.handoff.output)}</td>
          <td>{number(tokens(bot.conversation) + tokens(bot.memory) + tokens(bot.handoff))}</td><td>{number(tokens(bot.memory) + tokens(bot.handoff))}</td>
          <td>{number(bot.conversation.records)} / {number(bot.memory.records + bot.handoff.records)}{bot.unreported > 0 && <small>{number(bot.unreported)} {l('条回复尚无用量报告', 'responses without usage reports')}</small>}</td>
        </tr>)}</tbody></table></div> : <p className={css.usageEmpty}>{l('暂无 Bot 用量记录。开始一次对话后，可在这里查看。', 'No Bot usage records yet. Start a conversation to see usage here.')}</p>}
        <p className={css.integrationHint}>{l('辅助 Token 已包含在合计中。新记录按模型调用计数，旧记录按回复计数；Token 仅累计已报告值。', 'Auxiliary tokens are included in totals. New records count model calls; legacy records count responses. Tokens include reported values only.')}</p>
      </section>
      {report.ledger && <UsageLedger detail={report.ledger} filter={filter} change={setFilter} english={english}/>}
      <section className={css.usageSection} aria-label={l('预算进度', 'Budget progress')}><h3>{l('预算进度', 'Budget progress')}</h3><p className={css.integrationHint}>{l('执行中的预留额度单独显示。总预算与 Bot 预算分别限制同一笔消耗，不应相加。', 'Active reservations are shown separately. Overall and Bot budgets apply to the same spending and must not be added together.')}</p>
        {report.budgets.length ? <div className={css.usageBudgets}>{report.budgets.filter(item => selected === '*' || item.scope === '*' || item.scope === selected).map(item => <article key={item.scope}>
          <h4>{item.scope === '*' ? l('总预算', 'Overall budget') : `${item.name} · @${item.scope}`}</h4><p>{period(item.budget.period)} · {new Date(item.budget.since).toLocaleDateString()}</p>
          {[
            { label: 'Token', used: item.budget.used.input + item.budget.used.output, reserved: item.reserved.tokens, limit: item.budget.tokenLimit, format: number },
            { label: l('费用', 'Cost'), used: item.budget.used.cost, reserved: item.reserved.cost, limit: item.budget.costLimit, format: (value: number) => cost(value, item.budget.currency) },
          ].map(metric => <div key={metric.label} className={css.usageQuota}>
            <div><span>{metric.label}</span><strong>{metric.format(metric.used)} / {metric.limit ? metric.format(metric.limit) : l('不限额', 'Unlimited')}</strong></div>
            {metric.limit > 0 && <progress aria-label={`${item.scope === '*' ? l('总预算', 'Overall budget') : item.name} ${metric.label}`} max={metric.limit} value={Math.min(metric.limit, metric.used + metric.reserved)}/>}
            <small>{l('执行中预留', 'Reserved')} {metric.format(metric.reserved)}{metric.limit > 0 && ` · ${metric.used + metric.reserved > metric.limit ? l('超出额度', 'Over limit') : l('可用', 'Available')} ${metric.format(Math.abs(metric.limit - metric.used - metric.reserved))}`}</small>
          </div>)}
        </article>)}</div> : <p className={css.usageEmpty}>{l('尚无预算记录，可点击「管理预算」设置额度。', 'No budgets yet. Choose “Manage budgets” to set limits.')}</p>}
      </section>
    </>}
  </main>
}
