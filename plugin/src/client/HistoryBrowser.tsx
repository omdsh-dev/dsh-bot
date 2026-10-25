import { useEffect, useRef, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { BotState, HistoryPage, Room } from '../types.ts'
import type { CapabilityFace } from './capability-face.ts'
import css from './Panel.module.css'

export function HistoryBrowser({ room, bots, face, english, exporting, exportChat }: {
  room: Room; bots: BotState['bots']; face: CapabilityFace; english: boolean; exporting: boolean; exportChat(format: 'markdown' | 'json'): void
}) {
  const l = (zh: string, en: string) => english ? en : zh
  const [draft, setDraft] = useState(''), [filter, setFilter] = useState({ query: '' })
  const [page, setPage] = useState<HistoryPage>(), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const generation = useRef(0), pending = useRef(false)
  useEffect(() => {
    const request = ++generation.current
    setPage(undefined); setLoading(true); setError(''); pending.current = true
    void face.history({ roomId: room.id, query: filter.query, limit: 50 }).then(value => {
      if (request === generation.current) setPage(value)
    }).catch(cause => { if (request === generation.current) setError(String(cause)) }).finally(() => {
      if (request === generation.current) { setLoading(false); pending.current = false }
    })
    return () => { generation.current++ }
  }, [face, room.id, filter])
  const earlier = async () => {
    if (!page?.before || pending.current) return
    const request = generation.current
    pending.current = true; setLoading(true); setError('')
    try {
      const next = await face.history({ roomId: room.id, query: filter.query, before: page.before, limit: 50 })
      if (request === generation.current) setPage({ ...next, messages: [...next.messages, ...page.messages] })
    } catch (cause) { if (request === generation.current) setError(String(cause)) }
    finally { if (request === generation.current) { setLoading(false); pending.current = false } }
  }
  return <section aria-label={l('聊天记录列表', 'Message history list')}>
    <p>{l('打开就能看到最近的聊天，最新消息在前。需要查找时再筛选。', 'Recent messages appear below, newest first. Search only when you want to narrow the list.')}</p>
    <form onSubmit={event => { event.preventDefault(); setFilter({ query: draft.trim() }) }} className={css.settingsFields}>
      <label>{l('搜索聊天原文', 'Search message text')}<Input placeholder={l('可选，输入关键词缩小范围', 'Optional: filter by keyword')} value={draft} onChange={event => setDraft(event.target.value)}/></label>
      <div className={css.controlActions}><Button type="submit">{l('搜索', 'Search')}</Button>
        {(filter.query || draft) && <Button type="button" onClick={() => { setDraft(''); setFilter({ query: '' }) }}>{l('显示全部', 'Show all')}</Button>}
        {(['markdown', 'json'] as const).map(format => <Button type="button" key={format} disabled={exporting} onClick={() => exportChat(format)}>{l('导出', 'Export')} {format}</Button>)}
      </div>
    </form>
    {error && <p role="alert" className={css.controlError}>{error} <Button onClick={() => page ? void earlier() : setFilter({ ...filter })}>{l('重试', 'Retry')}</Button></p>}
    {page && <p>{filter.query ? l(`“${filter.query}”的匹配结果`, `Matches for “${filter.query}”`) : l('全部聊天记录', 'All messages')} · {l(`已显示 ${page.messages.length} / ${page.total} 条`, `Showing ${page.messages.length} of ${page.total}`)}</p>}
    {page?.messages.slice().reverse().map(message => <article key={message.id}>
      <strong>{message.botId ? bots.find(bot => bot.id === message.botId)?.name ?? message.botId : l('用户', 'User')} · {new Date(message.time).toLocaleString()}</strong><pre>{message.text}</pre>
    </article>)}
    {loading && <p role="status">{l('正在加载聊天记录…', 'Loading messages…')}</p>}
    {!loading && !error && page && !page.messages.length && <p>{filter.query ? l('没有匹配的消息，可以清除筛选查看全部。', 'No matches. Clear the filter to see all messages.') : l('这个聊天还没有消息。', 'No messages in this chat yet.')}</p>}
    {page?.before && <Button disabled={loading} onClick={() => { void earlier() }}>{l('加载更早的消息', 'Load earlier messages')}</Button>}
  </section>
}
