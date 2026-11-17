import type { UsageReport } from '../usage.ts'
import type { UsageFilter } from '../usage-types.ts'
import css from './UsageOverview.module.css'

/** Read-only visualization of the same filtered ledger used by the detailed tables. */
export function UsageOverview({ report, filter, change, botId, selectBot, english }: {
  report: UsageReport; filter: UsageFilter; change(value: UsageFilter): void
  botId: string; selectBot(value: string): void; english: boolean
}) {
  const l = (zh: string, en: string) => english ? en : zh
  const compact = (n: number) => new Intl.NumberFormat(english ? 'en-US' : 'zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
  const ledger = report.ledger, total = ledger?.totals
  const tokens = total ? total.input + total.output : 0
  const costs = total?.costs.map(item => `${item.currency} ${item.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`).join(' · ') || '—'
  const ranked = report.bots.filter(bot => botId === '*' || bot.botId === botId).map(bot => ({ ...bot,
    tokens: bot.conversation.input + bot.conversation.output + bot.memory.input + bot.memory.output + bot.handoff.input + bot.handoff.output,
    records: bot.conversation.records + bot.memory.records + bot.handoff.records,
  })).filter(bot => bot.records > 0).sort((a, b) => b.tokens - a.tokens)
  const today = Math.floor(report.generatedAt / 86400000) * 86400000
  const ranges = [1, 7, 30, 0]
  const range = ranges.find(days => days ? filter.from === today - (days - 1) * 86400000 && filter.to === today + 86400000 : filter.from === undefined && filter.to === undefined)
  const dated = (ledger?.days ?? []).filter(day => day.key !== 'unknown').sort((a, b) => a.key.localeCompare(b.key))
  // Keep long histories readable; the totals still cover the entire selected range.
  const end = filter.to !== undefined ? filter.to - 86400000 : dated.length ? Date.parse(`${dated.at(-1)!.key}T00:00:00Z`) : today
  const start = Math.max(filter.from ?? (dated.length ? Date.parse(`${dated[0]!.key}T00:00:00Z`) : end - 6 * 86400000), end - 29 * 86400000)
  const days = Array.from({ length: Math.max(0, Math.min(30, Math.floor((end - start) / 86400000) + 1)) }, (_, i) => {
    const key = new Date(start + i * 86400000).toISOString().slice(0, 10)
    const day = dated.find(day => day.key === key)
    return { key, tokens: day ? day.input + day.output : 0 }
  })
  const max = Math.max(1, ...days.map(day => day.tokens))
  const purposes = [['conversation', l('聊天回复', 'Chat responses')], ['memory', l('记忆整理', 'Memory review')], ['handoff', l('上下文交接', 'Context handoff')]] as const
  const parts = purposes.map(([key, label], i) => { const bucket = ledger?.purposes.find(row => row.key === key); return { label, color: ['#4c7dff', '#8b5cf6', '#12b8a6'][i]!, tokens: bucket ? bucket.input + bucket.output : 0 } })
  let offset = 0
  const gradient = parts.map(part => { const from = offset; offset += tokens ? part.tokens / tokens * 100 : 0; return `${part.color} ${from}% ${offset}%` }).join(', ')
  return <section className={css.overview} aria-label={l('使用总览', 'Usage overview')}>
    <div className={css.heading}><div><h3>{l('使用总览', 'Usage overview')}</h3><p>{l('已报告用量 · 与下方账本共用筛选', 'Reported usage · shared ledger filters')}</p></div>
      <div className={css.controls}><label>{l('Bot', 'Bot')} <select aria-label={l('总览 Bot', 'Overview Bot')} value={botId} onChange={event => selectBot(event.target.value)}><option value="*">{l('全部 Bot', 'All Bots')}</option>{report.bots.map(bot => <option key={bot.botId} value={bot.botId}>{bot.name}</option>)}</select></label>
      <div className={css.ranges} role="group" aria-label={l('日期范围', 'Date range')}>{ranges.map(days => <button key={days} type="button" aria-pressed={range === days} onClick={() => change({ ...filter, from: days ? today - (days - 1) * 86400000 : undefined, to: days ? today + 86400000 : undefined })}>{days === 1 ? l('今天', 'Today') : days ? l(`近 ${days} 天`, `Last ${days} days`) : l('全部', 'All time')}</button>)}</div></div>
    </div>
    {(filter.model || filter.purpose || filter.roomId) && <p className={css.note}>{l('其他筛选', 'Other filters')}: {[filter.model, filter.purpose, filter.roomId].filter(Boolean).join(' · ')} <button type="button" onClick={() => { change({}); selectBot('*') }}>{l('清除全部筛选', 'Clear all filters')}</button></p>}
    {!ledger ? <p className={css.empty}>{l('当前服务尚未提供调用账本，升级后可查看总览；下方保留已有统计。', 'The call ledger is unavailable. Existing statistics remain below.')}</p> : <>
      <div className={css.metrics}>{[
        [l('Token 总消耗', 'Total tokens'), compact(tokens), l('已报告输入 + 输出', 'Reported input + output')],
        [l('估算费用', 'Estimated cost'), costs, total!.unpricedRecords ? l(`${total!.unpricedRecords} 条未计价记录`, `${total!.unpricedRecords} unpriced records`) : l('按记录中的单价估算', 'Prices recorded at call time')],
        [l('调用 / 记录数', 'Calls / records'), compact(total!.records), total!.legacyRecords ? l(`含 ${total!.legacyRecords} 条旧记录`, `Includes ${total!.legacyRecords} legacy records`) : l('含未报告用量的调用', 'Includes calls without reported usage')],
        [l('缓存读取占比', 'Cache read share'), total!.input ? `${(Math.min(1, total!.cacheRead / total!.input) * 100).toFixed(1)}%` : '—', l('已记录缓存读取 / 输入', 'Recorded cache reads / input')],

      ].map(([label, value, hint]) => <article key={label}><span>{label}</span><strong>{value}</strong><small>{hint}</small></article>)}</div>
      <div className={css.charts}><article className={css.card}><div className={css.title}><h4>{l('每日 Token 趋势', 'Daily token usage')}</h4><small>{l('UTC · 最多展示末 30 天', 'UTC · latest 30 days at most')}</small></div>
        {dated.length ? <div className={css.plot}><div className={css.axis}><span>{compact(max)}</span><span>{compact(max / 2)}</span><span>0</span></div><div className={css.bars}>{days.map((day, i) => <div key={day.key} className={css.column}><div className={css.barTrack}><div className={css.bar} style={{ height: `${day.tokens / max * 100}%` }} role="img" aria-label={`${day.key}: ${day.tokens.toLocaleString()} tokens`} title={`${day.key}: ${day.tokens.toLocaleString()} tokens`}/></div><small>{i === 0 || i === days.length - 1 || i % Math.max(1, Math.ceil(days.length / 6)) === 0 ? day.key.slice(5) : '\u00a0'}</small></div>)}</div></div> : <p className={css.empty}>{l('暂无有日期的用量记录', 'No dated usage records')}</p>}
      </article><article className={css.card}><div className={css.title}><h4>{l('Token 用途分布', 'Token usage by purpose')}</h4></div><div className={css.distribution}><div className={css.donut} style={{ background: tokens ? `conic-gradient(${gradient})` : 'var(--bot-line)' }} role="img" aria-label={parts.map(part => `${part.label}: ${part.tokens}`).join(', ')}><div><strong>{compact(tokens)}</strong><small>Tokens</small></div></div><div className={css.legend}>{parts.map(part => <div key={part.label}><span style={{ background: part.color }}/><label>{part.label}<small>{compact(part.tokens)} tokens</small></label><strong>{tokens ? `${(part.tokens / tokens * 100).toFixed(1)}%` : '—'}</strong></div>)}</div></div></article></div>
      <div className={css.charts}><article className={css.card}><div className={css.title}><h4>{l('Bot 使用排行', 'Bot usage ranking')}</h4><small>{l('按 Token 消耗排序 · 前 8 名', 'By tokens · top 8')}</small></div>{ranked.length ? <div className={css.ranking}>{ranked.slice(0, 8).map((bot, index) => <div key={bot.botId}><span className={css.rank}>{String(index + 1).padStart(2, '0')}</span><div className={css.bot}><strong>{bot.name}</strong><small>@{bot.botId}{bot.deleted ? l(' · 已删除', ' · deleted') : bot.archived ? l(' · 已归档', ' · archived') : ''}</small></div><div className={css.rankTrack}><div style={{ width: `${ranked[0]!.tokens ? bot.tokens / ranked[0]!.tokens * 100 : 0}%` }}/></div><strong>{compact(bot.tokens)} <small>tokens</small></strong></div>)}</div> : <p className={css.empty}>{l('此范围内还没有 Bot 使用记录', 'No Bot records in this range')}</p>}</article>
      <article className={css.card}><div className={css.title}><h4>{l('模型消耗排行', 'Model usage ranking')}</h4><small>{l('按 Token · 前 6 名', 'By tokens · top 6')}</small></div><div className={css.ranking}>{[...ledger.models].sort((a, b) => b.input + b.output - a.input - a.output).slice(0, 6).map((model, index, models) => {
        const [provider, name] = JSON.parse(model.key) as (string | null)[]
        const maximum = Math.max(1, ...models.map(row => row.input + row.output))
        return <div key={model.key}><span className={css.rank}>{String(index + 1).padStart(2, '0')}</span><div className={css.bot}><strong>{name ?? l('未知模型', 'Unknown model')}</strong><small>{provider ?? l('旧记录', 'Legacy')}</small></div><div className={css.rankTrack}><div style={{ width: `${(model.input + model.output) / maximum * 100}%` }}/></div><strong>{compact(model.input + model.output)}</strong></div>
      })}</div>{!ledger.models.length && <p className={css.empty}>{l('暂无模型记录', 'No model records')}</p>}</article></div>
      <p className={css.note}>{l('总览与下方账本共用筛选。费用按币种分别统计，未计价记录不代表免费；缓存缺失按未记录处理，此比例不等同于完整缓存命中率。', 'Overview shares the ledger filters below. Currencies stay separate; unpriced records are not free. Missing cache usage is unrecorded, so this share is not a complete cache hit rate.')}</p>
    </>}
  </section>
}
