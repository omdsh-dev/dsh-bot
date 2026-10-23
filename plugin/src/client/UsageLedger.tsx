import { useState } from 'react'
import type { UsageDetail, UsageFilter, UsageBucket, UsagePurpose } from '../usage-types.ts'
import css from './Panel.module.css'

export function UsageLedger({ detail, filter, change, english }: {
  detail: UsageDetail; filter: UsageFilter; change(value: UsageFilter): void; english: boolean
}) {
  const l = (zh: string, en: string) => english ? en : zh
  const [dimension, setDimension] = useState<'days' | 'models' | 'rooms' | 'purposes'>('days')
  const number = (n: number) => n.toLocaleString(english ? 'en-US' : 'zh-CN')
  const purpose = (key: string) => key === 'memory' ? l('记忆整理', 'Memory review') : key === 'handoff' ? l('上下文交接', 'Handoff') : l('聊天回复', 'Chat')
  const unknown = l('未知（旧记录）', 'Unknown (legacy)')
  const label = (key: string) => key === 'unknown' ? unknown : dimension === 'models' ? (JSON.parse(key) as (string | null)[]).map(item => item ?? unknown).join(' / ') : dimension === 'purposes' ? purpose(key) : key
  const costs = (row: UsageBucket) => row.costs.length ? row.costs.map(cost => `${cost.currency} ${cost.cost.toLocaleString(undefined, { maximumFractionDigits: 6 })}`).join(' · ') : '—'
  const rows = detail[dimension], max = Math.max(1, ...rows.map(row => row.input + row.output))
  const date = (value?: number) => value === undefined ? '' : new Date(value).toISOString().slice(0, 10)
  return <section className={css.usageSection} aria-label={l('调用账本', 'Call ledger')}>
    <h3>{l('调用账本', 'Call ledger')}</h3>
    <p className={css.integrationHint}>{l('记录独立于聊天和预算，删除聊天或重置预算后仍保留。日期按 UTC 统计；旧数据未保存的模型、缓存和费用显示为未知。', 'Records survive chat deletion and budget resets. Dates use UTC; missing legacy model, cache and price metadata remains unknown.')}</p>
    <div className={css.usageFilters}>
      <label>{l('开始日期', 'From')}<input type="date" value={date(filter.from)} onChange={event => change({ ...filter, from: event.target.value ? Date.parse(`${event.target.value}T00:00:00Z`) : undefined })}/></label>
      <label>{l('结束日期', 'Through')}<input type="date" value={date(filter.to === undefined ? undefined : filter.to - 86400000)} onChange={event => change({ ...filter, to: event.target.value ? Date.parse(`${event.target.value}T00:00:00Z`) + 86400000 : undefined })}/></label>
      <label>{l('用途', 'Purpose')}<select value={filter.purpose ?? ''} onChange={event => change({ ...filter, purpose: (event.target.value || undefined) as UsagePurpose | undefined })}><option value="">{l('全部用途', 'All purposes')}</option>{['conversation', 'memory', 'handoff'].map(key => <option key={key} value={key}>{purpose(key)}</option>)}</select></label>
      <label>{l('模型', 'Model')}<select value={filter.model ? JSON.stringify([filter.provider, filter.model]) : ''} onChange={event => { const [provider, model] = event.target.value ? JSON.parse(event.target.value) as [string, string] : [undefined, undefined]; change({ ...filter, provider, model }) }}><option value="">{l('全部模型', 'All models')}</option>{detail.models.filter(row => !(JSON.parse(row.key) as unknown[]).includes(null)).map(row => <option key={row.key} value={row.key}>{(JSON.parse(row.key) as string[]).join(' / ')}</option>)}</select></label>
      <label>{l('聊天', 'Chat')}<select value={filter.roomId ?? ''} onChange={event => change({ ...filter, roomId: event.target.value || undefined })}><option value="">{l('全部聊天', 'All chats')}</option>{detail.rooms.filter(row => row.key !== 'unknown').map(row => <option key={row.key} value={row.key}>{row.key}</option>)}</select></label>
    </div>
    <div className={css.usageMetrics}>{[
      [l('已报告输入 + 输出', 'Reported input + output'), number(detail.totals.input + detail.totals.output)],
      [l('缓存读取 / 写入', 'Cache read / write'), `${number(detail.totals.cacheRead)} / ${number(detail.totals.cacheWrite)}`],
      [l('记录数 / 执行中', 'Records / active'), `${number(detail.totals.records)} / ${number(detail.activeCalls)}`],
      [l('估算费用（含预留结算）', 'Estimated cost (including settlements)'), costs(detail.totals)],
    ].map(([name, value]) => <article key={name}><span>{name}</span><strong>{value}</strong></article>)}</div>
    <p className={css.integrationHint}>{l('缓存 Token 已包含在输入中。', 'Cache tokens are included in input.')} {number(detail.totals.unreported)} {l('次未报告用量，预留结算', 'calls without usage reports; reservation settlements')} {number(detail.totals.estimatedTokens)} tokens · {number(detail.totals.legacyRecords)} {l('条旧记录', 'legacy records')} · {number(detail.totals.unpricedRecords)} {l('条未计价记录', 'unpriced records')}</p>
    <div className={css.usageSectionHeading}><h4>{l('用量分布与趋势', 'Usage breakdown and trend')}</h4><label>{l('统计维度', 'Group by')}<select value={dimension} onChange={event => setDimension(event.target.value as typeof dimension)}>{(['days', 'models', 'rooms', 'purposes'] as const).map((key, i) => <option key={key} value={key}>{[l('日期', 'Date'), l('模型', 'Model'), l('聊天', 'Chat'), l('用途', 'Purpose')][i]}</option>)}</select></label></div>
    <div className={css.usageTableWrap}><table className={css.usageTable}><thead><tr>{[l('分组', 'Group'), 'Tokens', l('缓存读取 / 写入', 'Cache read / write'), l('调用 / 记录', 'Calls / records'), l('费用', 'Cost')].map(name => <th key={name}>{name}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row.key}><th scope="row">{label(row.key)}</th><td>{number(row.input + row.output)}<meter aria-label={label(row.key)} min={0} max={max} value={row.input + row.output}/></td><td>{number(row.cacheRead)} / {number(row.cacheWrite)}</td><td>{number(row.records)}</td><td>{costs(row)}</td></tr>)}</tbody></table></div>
    <details><summary>{l('最近调用明细', 'Recent call details')} · {number(detail.matchedRecords)}</summary><p className={css.integrationHint}>{l('展示筛选范围内最近 100 条记录。旧聊天记录可能合并了多次模型调用。', 'Shows the latest 100 matching records. A legacy chat record may combine multiple model calls.')}</p>
      <div className={css.usageTableWrap}><table className={css.usageTable}><thead><tr>{[l('时间 / Bot', 'Time / Bot'), l('用途 / 模型', 'Purpose / Model'), l('输入 / 输出', 'Input / Output'), l('缓存读 / 写', 'Cache read / write'), l('状态', 'Status')].map(name => <th key={name}>{name}</th>)}</tr></thead><tbody>{detail.recent.map(row => <tr key={row.id}><td>{row.startedAt === null ? unknown : new Date(row.startedAt).toLocaleString()}<small>@{row.botId}</small></td><td>{purpose(row.purpose)}<small>{row.provider ?? unknown} / {row.model ?? unknown}</small></td><td>{number(row.input)} / {number(row.output)}</td><td>{row.cacheRead === null ? '—' : number(row.cacheRead)} / {row.cacheWrite === null ? '—' : number(row.cacheWrite)}</td><td>{({ reported: l('已报告', 'Reported'), legacy: l('旧记录', 'Legacy'), estimated: l('预留结算', 'Reservation charged'), unreported: l('未报告', 'Unreported') })[row.status]}</td></tr>)}</tbody></table></div>
    </details>
  </section>
}
