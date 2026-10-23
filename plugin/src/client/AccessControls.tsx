import { useEffect, useState } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { BotState } from '../types.ts'
import type { AccessView, BotCapability, SaveCapability, SaveBotCredential } from '../access-types.ts'
import type { CapabilityFace } from './capability-face.ts'
import css from './Panel.module.css'

const blankCapability = (): SaveCapability => ({ name: '', description: '', botIds: [], kind: 'skill', content: '' })
const blankCredential = (): SaveBotCredential => ({ name: '', description: '', botIds: [], shellBotIds: [], value: '' })
const pairs = (text: string) => Object.fromEntries(text.split('\n').filter(line => line.trim()).map(line => {
  const at = line.indexOf('='); if (at < 1) throw new Error('Use NAME=value on each line'); return [line.slice(0, at).trim(), line.slice(at + 1)]
}))
const lines = (fields: Record<string, string> = {}) => Object.entries(fields).map(([key, value]) => key + '=' + value).join('\n')
export function AccessControls({ state, face, english }: { state: BotState; face: CapabilityFace; english: boolean }) {
  const l = (zh: string, en: string) => english ? en : zh
  const [view, setView] = useState<AccessView>({ capabilities: [], credentials: [] }), [tab, setTab] = useState<'capabilities' | 'credentials'>('capabilities')
  const [capability, setCapability] = useState<SaveCapability>(), [credential, setCredential] = useState<SaveBotCredential>()
  const [argumentsText, setArguments] = useState(''), [fieldsText, setFields] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const refresh = async () => { setView(await face.accessCatalog()) }
  useEffect(() => { let active = true; void face.accessCatalog().then(value => { if (active) setView(value) }).catch(cause => { if (active) setError(String(cause)) }); return () => { active = false } }, [face])
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn(); await refresh() } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) } finally { setBusy(false) } }
  const names = (ids: string[]) => ids.map(id => state.bots.find(bot => bot.id === id)?.name ?? id).join(', ') || l('尚未授权', 'No grants')
  const chooseBots = (selected: string[], update: (ids: string[]) => void, allowed?: string[]) => <fieldset disabled={busy}><legend>{l('授权 Bot', 'Authorized Bots')}</legend>{state.bots.filter(bot => !bot.archived && (!allowed || allowed.includes(bot.id))).map(bot => <label className={css.checkOption} key={bot.id}><input type="checkbox" checked={selected.includes(bot.id)} onChange={event => update(event.target.checked ? [...selected, bot.id] : selected.filter(id => id !== bot.id))}/>{bot.name}</label>)}</fieldset>
  const editCapability = (item: SaveCapability | BotCapability) => { setCapability(item); setArguments(item.args?.join('\n') ?? ''); setFields(lines(item.env ?? item.headers)); setError('') }
  return <section aria-label={l('能力与凭据授权', 'Capability and credential grants')}>
    <nav><Button aria-pressed={tab === 'capabilities'} onClick={() => setTab('capabilities')}>{l('MCP 与技能', 'MCP & skills')}</Button><Button aria-pressed={tab === 'credentials'} onClick={() => setTab('credentials')}>{l('凭据', 'Credentials')}</Button></nav>
    {error && <p role="alert" className={css.controlError}>{error}</p>}
    <p>{l('修改授权会停止受影响 Bot 的当前工作，并在下次对话重新加载。此处添加的能力只挂载到获准的 Bot。', 'Grant changes stop affected Bot work and reload its next conversation. Capabilities added here mount only on their assigned Bots.')}</p>
    {tab === 'capabilities' ? <>
      {view.capabilities.map(item => <article key={item.name}><strong>{item.name}</strong> · {item.kind === 'skill' ? l('技能', 'Skill') : item.kind === 'browser' ? l('隔离浏览器', 'Isolated browser') : 'MCP'}<p>{item.description}</p><p>{names(item.botIds)}</p><div className={css.controlActions}><Button size="sm" disabled={busy} onClick={() => editCapability(item)}>{l('编辑与授权', 'Edit & grant')}</Button><Button size="sm" disabled={busy} onClick={() => { void act(() => face.removeAccess({ kind: 'capability', name: item.name, revision: item.revision })) }}>{l('删除', 'Delete')}</Button></div></article>)}
      <Button disabled={busy} onClick={() => editCapability(blankCapability())}>{l('添加 MCP 或技能', 'Add MCP or skill')}</Button>
      <Button disabled={busy} onClick={() => editCapability({ ...blankCapability(), name: 'browser', kind: 'browser' })}>{l('添加隔离浏览器', 'Add isolated browser')}</Button>
      {capability && <form onSubmit={event => { event.preventDefault(); void act(async () => {
        const fields = pairs(fieldsText)
        await face.saveCapability({ ...capability, ...(capability.kind === 'mcp' ? capability.transport === 'stdio' ? { args: argumentsText.split('\n').filter(Boolean), env: fields } : { headers: fields } : {}) })
        setCapability(undefined)
      }) }}>
        <label>{l('名称', 'Name')}<Input required disabled={busy || capability.revision !== undefined} value={capability.name} onChange={event => setCapability({ ...capability, name: event.target.value })} placeholder="github-tools"/></label>
        <label>{l('用途说明', 'Description')}<Input value={capability.description} onChange={event => setCapability({ ...capability, description: event.target.value })}/></label>
        <label>{l('类型', 'Type')}<select value={capability.kind === 'mcp' ? capability.transport : capability.kind} onChange={event => { setCapability({ ...capability, kind: event.target.value === 'skill' ? 'skill' : event.target.value === 'browser' ? 'browser' : 'mcp', transport: ['stdio', 'streamable-http'].includes(event.target.value) ? event.target.value as 'stdio' | 'streamable-http' : undefined }); setFields('') }}><option value="skill">{l('技能说明', 'Skill instructions')}</option><option value="browser">{l('隔离浏览器', 'Isolated browser')}</option><option value="streamable-http">MCP · HTTPS</option><option value="stdio">MCP · {l('本地进程', 'Local process')}</option></select></label>
        {capability.kind === 'browser' ? <><p>{l('每次工作使用独立的临时浏览器，不读取你的登录状态。工作结束后关闭浏览器；Bot 之间不共享 Cookie。', 'Each delivery uses a fresh temporary browser, without your login state. It closes when work ends; Bots do not share cookies.')}</p><label>{l('浏览器可执行文件（可选；留空使用已安装的 Playwright Chromium）', 'Browser executable (optional; blank uses installed Playwright Chromium)')}<Input value={capability.executablePath ?? ''} onChange={event => setCapability({ ...capability, executablePath: event.target.value })}/></label></> : capability.kind === 'skill' ? <label>{l('技能内容', 'Skill content')}<textarea required rows={10} value={capability.content ?? ''} onChange={event => setCapability({ ...capability, content: event.target.value })}/></label> : <>
          {capability.transport === 'stdio' ? <><label>{l('可执行程序', 'Executable')}<Input required value={capability.command ?? ''} onChange={event => setCapability({ ...capability, command: event.target.value })}/></label><label>{l('参数（每行一个，直接传递，不经过 shell）', 'Arguments (one per line, no shell interpolation)')}<textarea value={argumentsText} onChange={event => setArguments(event.target.value)}/></label></> : <label>{l('HTTPS 地址', 'HTTPS endpoint')}<Input required type="url" value={capability.url ?? ''} onChange={event => setCapability({ ...capability, url: event.target.value })}/></label>}
          <label>{capability.transport === 'stdio' ? l('环境变量（NAME=value）', 'Environment (NAME=value)') : l('请求头（NAME=value）', 'Headers (NAME=value)')}<textarea value={fieldsText} onChange={event => setFields(event.target.value)} placeholder={capability.transport === 'stdio' ? 'API_TOKEN=$DSH_SECRET_API_TOKEN' : 'Authorization=Bearer $DSH_SECRET_API_TOKEN'}/></label>
          <p>{l('密钥通过 $DSH_SECRET_名称 引用；先在凭据页授权给相同 Bot。保存并分配后，下次对话会连接该服务器或启动该程序。', 'Reference saved credentials with $DSH_SECRET_NAME and grant them to the same Bots first. The next conversation connects to this server or starts this executable.')}</p>
        </>}
        {chooseBots(capability.botIds, botIds => setCapability({ ...capability, botIds }))}
        <div className={css.controlActions}><Button type="submit" variant="primary" disabled={busy}>{l('保存授权', 'Save grants')}</Button><Button type="button" disabled={busy} onClick={() => setCapability(undefined)}>{l('取消', 'Cancel')}</Button></div>
      </form>}
    </> : <>
      {view.credentials.map(item => <article key={item.name}><strong>{item.name}</strong> · {item.configured ? l('已配置', 'Configured') : l('值不可用', 'Value unavailable')}<p>{item.description}</p><p>{names(item.botIds)}</p><p>Shell: {names(item.shellBotIds)}</p><div className={css.controlActions}><Button size="sm" disabled={busy} onClick={() => setCredential({ ...item, value: '' })}>{l('编辑与授权', 'Edit & grant')}</Button><Button size="sm" disabled={busy} onClick={() => { void act(() => face.removeAccess({ kind: 'credential', name: item.name, revision: item.revision })) }}>{l('撤销并删除', 'Revoke & delete')}</Button></div></article>)}
      <Button disabled={busy} onClick={() => setCredential(blankCredential())}>{l('添加凭据', 'Add credential')}</Button>
      {credential && <form onSubmit={event => { event.preventDefault(); void act(async () => { await face.saveBotCredential(credential); setCredential(undefined) }) }}>
        <label>{l('名称', 'Name')}<Input required disabled={busy || credential.revision !== undefined} value={credential.name} onChange={event => setCredential({ ...credential, name: event.target.value })} placeholder="API_TOKEN"/></label>
        <label>{l('用途说明', 'Description')}<Input value={credential.description} onChange={event => setCredential({ ...credential, description: event.target.value })}/></label>
        <label>{credential.revision ? l('新值（留空保留原值）', 'New value (blank keeps saved value)') : l('密钥值', 'Secret value')}<Input type="password" autoComplete="new-password" required={!credential.revision} value={credential.value ?? ''} onChange={event => setCredential({ ...credential, value: event.target.value })}/></label>
        {chooseBots(credential.botIds, botIds => setCredential({ ...credential, botIds, shellBotIds: credential.shellBotIds.filter(id => botIds.includes(id)) }))}
        <details><summary>{l('额外允许 shell 使用', 'Additional shell access')}</summary><p>{l('获准的 Bot 可在命令中引用变量使用密钥。只有命令明确引用的变量会注入进程。', 'Authorized Bots can use the secret through its environment variable. Only variables explicitly referenced by the command are injected.')}</p>{chooseBots(credential.shellBotIds, shellBotIds => setCredential({ ...credential, shellBotIds }), credential.botIds)}</details>
        <p>{l('值保存到本机 DSH 凭据存储，页面不会再次显示原值。', 'Values are saved in native DSH credential storage and are never returned to this page.')}</p>
        <div className={css.controlActions}><Button type="submit" variant="primary" disabled={busy}>{l('保存授权', 'Save grants')}</Button><Button type="button" disabled={busy} onClick={() => setCredential(undefined)}>{l('取消', 'Cancel')}</Button></div>
      </form>}
    </>}
  </section>
}
