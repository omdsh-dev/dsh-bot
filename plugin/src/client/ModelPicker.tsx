import { useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CapabilityCatalog } from '../types.ts'
import css from './Panel.module.css'

export function ModelPicker({ providers, provider, model, loading, english, select }: {
  providers: CapabilityCatalog['providers']; provider: string; model: string; loading: boolean; english: boolean; select(provider: string, model: string): void
}) {
  const l = (zh: string, en: string) => english ? en : zh
  const [query, setQuery] = useState(''), [limit, setLimit] = useState(20)
  const all = providers.flatMap(p => p.models.map(m => ({ ...m, provider: p.id })))
  const matches = all.filter(item => `${item.provider} ${item.name} ${item.id}`.toLowerCase().includes(query.toLowerCase().trim()))
  const current = all.find(item => item.provider === provider && item.id === model)
  return <div className={css.settingsFields}>
    <p>{l('当前选择：', 'Selected: ')}<strong>{provider || model ? `${current?.name || model || l('默认模型', 'Default model')} · ${provider || l('默认服务商', 'Default provider')}` : l('使用 DSH 默认模型', 'Use the DSH default model')}</strong></p>
    <Button aria-pressed={!provider && !model} onClick={() => select('', '')}>{l('使用 DSH 默认模型', 'Use the DSH default model')}</Button>
    <label>{l('筛选模型（可选）', 'Filter models (optional)')}<Input value={query} placeholder={l('按名称或服务商筛选', 'Filter by name or provider')} onChange={event => { setQuery(event.target.value); setLimit(20) }}/></label>
    {loading ? <p role="status">{l('正在读取可用模型…', 'Loading available models…')}</p> : <>
      <p>{l(`可选模型 ${matches.length} 个`, `${matches.length} available models`)}</p>
      <div className={css.choiceList} aria-label={l('可选模型', 'Available models')}>
        {matches.slice(0, limit).map(item => <button type="button" key={JSON.stringify([item.provider, item.id])} className={css.choiceCard} aria-pressed={item.provider === provider && item.id === model} onClick={() => select(item.provider, item.id)}>
          <strong>{item.name || item.id}</strong><small>{item.provider} · {item.id}</small>
          {item.provider === provider && item.id === model && <small>{l('已选择', 'Selected')}</small>}
        </button>)}
      </div>
      {matches.length > limit && <Button onClick={() => setLimit(value => value + 20)}>{l('显示更多模型', 'Show more models')}</Button>}
      {!matches.length && <p>{query ? l('没有匹配的模型。', 'No matching models.') : l('暂未发现模型。可以使用 DSH 默认模型，或在下方手动填写。', 'No models discovered. Use the DSH default or enter a model below.')}</p>}
      {!!query && <Button onClick={() => { setQuery(''); setLimit(20) }}>{l('清除模型筛选', 'Clear model filter')}</Button>}
      {providers.filter(p => p.error).map(p => <p key={p.id}>{p.id} · {l('暂时无法读取模型列表，可手动填写模型。', 'Model discovery is unavailable. You can enter a model manually.')}</p>)}
    </>}
    <details><summary>{l('列表里没有？手动填写模型', 'Model missing? Enter it manually')}</summary><div className={css.settingsFields}>
      <label>{l('模型服务商（留空使用默认设置）', 'Provider (blank uses the default)')}<Input value={provider} onChange={event => select(event.target.value, model)}/></label>
      <label>{l('模型名称', 'Model')}<Input value={model} onChange={event => select(provider, event.target.value)}/></label>
    </div></details>
  </div>
}

export function ToolPicker({ available, value, change, editable, loading, english }: {
  available: CapabilityCatalog['tools']; value: string; change(value: string): void; editable: boolean; loading: boolean; english: boolean
}) {
  const l = (zh: string, en: string) => english ? en : zh
  const [query, setQuery] = useState(''), [limit, setLimit] = useState(20)
  const selected = [...new Set(value.split(/[\n,]/).map(name => name.trim()).filter(Boolean))]
  const matches = available.filter(tool => `${tool.name} ${tool.description}`.toLowerCase().includes(query.trim().toLowerCase()))
  const unknown = selected.filter(name => !available.some(tool => tool.name === name))
  const toggle = (name: string, checked: boolean) => change((checked ? [...selected, name] : selected.filter(item => item !== name)).join('\n'))
  return <div className={css.settingsFields}>
    <h4>{l('可用工具', 'Available tools')}</h4>
    {!editable && <p>{l('下方可查看工具及用途。将工具权限设为“仅允许列出的工具”后可以勾选。', 'Browse tools and their descriptions below. Choose “Allow listed tools only” to select individual tools.')}</p>}
    <label>{l('筛选工具（可选）', 'Filter tools (optional)')}<Input value={query} onChange={event => { setQuery(event.target.value); setLimit(20) }}/></label>
    {loading ? <p role="status">{l('正在读取工具列表…', 'Loading tools…')}</p> : <>
      <p>{l(`找到 ${matches.length} 个工具`, `${matches.length} tools found`)}{editable && l(` · 已选择 ${selected.length} 个`, ` · ${selected.length} selected`)}</p>
      <div className={css.choiceList}>{matches.slice(0, limit).map(tool => {
        const full = tool.description || l('暂无说明', 'No description provided')
        const firstLine = full.split('\n')[0] || full
        const brief = firstLine.length > 180 ? firstLine.slice(0, 180) + '…' : firstLine
        return <div key={tool.name} className={css.toolChoice}><span>
          <label className={css.checkOption}>{editable && <input type="checkbox" aria-label={tool.name} checked={selected.includes(tool.name)} onChange={event => toggle(tool.name, event.target.checked)}/>}<strong>{tool.name}</strong></label>
          <small>{brief}</small>
          {brief !== full && <details><summary>{l('完整说明', 'Full description')}</summary><p>{full}</p></details>}
        </span></div>
      })}</div>
      {!matches.length && <p>{query ? l('没有匹配的工具。', 'No matching tools.') : l('暂未发现工具。', 'No tools discovered.')}</p>}
      {matches.length > limit && <Button onClick={() => setLimit(value => value + 20)}>{l('显示更多工具', 'Show more tools')}</Button>}
      {!!query && <Button onClick={() => { setQuery(''); setLimit(20) }}>{l('清除工具筛选', 'Clear tool filter')}</Button>}
      {editable && !!unknown.length && <div className={css.settingsFields}><p>{l('已选择但当前未发现的工具（保留原设置）：', 'Selected tools currently unavailable (preserved):')}</p>{unknown.map(name => <label key={name} className={css.checkOption}><input type="checkbox" checked onChange={() => toggle(name, false)}/>{name}</label>)}</div>}
    </>}
    {editable && <details><summary>{l('手动填写工具名', 'Enter tool names manually')}</summary><label>{l('完整工具名，每行一个', 'Exact tool names, one per line')}<textarea value={value} onChange={event => change(event.target.value)}/></label></details>}
  </div>
}
