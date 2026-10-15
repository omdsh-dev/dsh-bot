import type { InfoFlowState } from '../src/types.ts'
// @vitest-environment jsdom
/** User interactions through the real slot renderer and observable Bot feed. */
import type {} from '../src/client/index.ts'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { Bot, BotId, Room, RoomId, ChatMessageId } from '../src/types.ts'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { PanelFace } from '../src/client/Panel.tsx'
import { BotModel } from '../src/client/model.ts'
import { createBotViewStore } from '../src/client/view-store.ts'
import { registerPanel } from '../src/client/registration.ts'
import { en, zh } from '../src/client/locales.ts'
import type { FeishuState } from '../src/feishu/types.ts'

const runtimes = new Set<SlotTestRuntime>()
afterEach(async () => { for (const runtime of runtimes) await runtime.dispose(); runtimes.clear(); cleanup(); vi.restoreAllMocks() })

async function bench(overrides: Partial<PanelFace> = {}) {
  const runtime = await SlotTestRuntime.create()
  runtimes.add(runtime)
  const bots: Bot[] = [{ id: 'sage' as BotId, name: 'Sage', instructions: 'Think through product ideas.', preset: 'standard' },
    { id: 'nova' as BotId, name: 'Nova', instructions: 'Review assumptions.', preset: 'standard' }]
  const members = bots.map(bot => ({ botId: bot.id, sessionId: `${bot.id}-group` as SessionId, cursor: 0 }))
  const room: Room = { id: 'studio' as RoomId, title: 'Design studio', kind: 'group', members, defaultBot: bots[0]!.id,
    messages: [{ id: 'question' as ChatMessageId, botId: null, text: 'A shared idea', replyTo: null, status: 'complete', error: null, time: 1000 },
      { id: 'answer' as ChatMessageId, botId: bots[0]!.id, text: 'Start with **one clear question**.', replyTo: 'question' as ChatMessageId, status: 'complete', error: null, time: 2000 }] }
  const rooms: Room[] = [room, ...bots.map(bot => ({ id: `dm-${bot.id}` as RoomId, title: bot.name, kind: 'dm' as const, members: [members.find(member => member.botId === bot.id)!], defaultBot: bot.id, messages: [] }))]
  const model = new BotModel(); model.replace({ bots, rooms })
  const unused = async (): Promise<never> => { throw new Error('unexpected command') }
  const face: PanelFace = { hooks: { bots: model }, createBot: unused, createGroup: unused, setMembers: vi.fn(async () => room),
    send: vi.fn(async () => {}), stop: unused, retry: unused, openSession: vi.fn(), toggleSidebar: vi.fn(), ...overrides }
  const locale = new LocaleRuntime(runtime.ctx); locale.setLocale('en')
  await runtime.mount({ inject: ['slots'], apply(ctx) {
    ctx.provide('locale', locale)
    ctx.effect(() => locale.register('botMode', { zh, en }), 'Bot panel test locale')
    ctx.slots.installLocale(locale)
    registerPanel(ctx, face, createBotViewStore())
  } })
  function Frame({ renderSlot }: PropsRuntime<'root'> & PropsRenderSlots<'main' | 'sidebar.panellist'>) {
    return <>{renderSlot('main', {}, { entryKey: 'bots' })}</>
  }
  await runtime.root.declare({ main: { kind: 'keyed', scope: 'root' }, 'sidebar.panellist': { kind: 'list', scope: 'root' } }, Frame)
  Element.prototype.scrollIntoView = vi.fn()
  runtime.renderRoot()
  return { face, model, room, rooms, bots }
}

it('renders named speakers and Markdown without repeating the human prompt as a Bot quote', async () => {
  await bench()
  const main = screen.getByRole('main')
  expect(within(main).getAllByText('A shared idea')).toHaveLength(1)
  expect(within(main).getByText('one clear question').tagName).toBe('STRONG')
  expect(Array.from(main.querySelectorAll('article')).map(article => ({ speaker: article.getAttribute('aria-label'), text: article.querySelector('time')?.dateTime,
    actions: Array.from(article.querySelectorAll('button')).map(button => button.textContent) }))).toMatchInlineSnapshot(`
    [
      {
        "actions": [
          "Reply",
        ],
        "speaker": "You",
        "text": "1970-01-01T00:00:01.000Z",
      },
      {
        "actions": [
          "Reply",
          "Open execution session",
        ],
        "speaker": "Sage",
        "text": "1970-01-01T00:00:02.000Z",
      },
    ]
  `)
})

it('filters the roster, switches to a private chat, and keeps the native execution action', async () => {
  const { face } = await bench()
  fireEvent.click(screen.getByRole('button', { name: 'Open execution session' }))
  expect(face.openSession).toHaveBeenCalledWith('sage-group')
  fireEvent.change(screen.getByRole('textbox', { name: en.search }), { target: { value: 'nova' } })
  const roster = screen.getByRole('complementary', { name: en.chats })
  expect(within(roster).queryByRole('button', { name: /Sage\s*@sage/ })).toBeNull()
  fireEvent.click(within(roster).getByRole('button', { name: /Nova\s*@nova/ }))
  expect(screen.getByRole('heading', { level: 2, name: 'Nova' })).toBeTruthy()
  expect(screen.getByText('Review assumptions.')).toBeTruthy()
})

it('selects a mention with the keyboard, then sends the addressed message', async () => {
  const { face } = await bench()
  const input = screen.getByRole('textbox', { name: en.message })
  fireEvent.change(input, { target: { value: '@no', selectionStart: 3 } })
  expect(screen.getByRole('option', { name: /Nova/ })).toBeTruthy()
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(face.send).not.toHaveBeenCalled()
  expect((input as HTMLTextAreaElement).value).toBe('@nova ')
  fireEvent.change(input, { target: { value: '@nova Review this', selectionStart: 17 } })
  fireEvent.keyDown(input, { key: 'Enter' })
  await waitFor(() => { expect(face.send).toHaveBeenCalledWith({ roomId: 'studio', text: '@nova Review this' }) })
})

it('preserves composition and multiline Enter, and respects disabled sends', async () => {
  const { face } = await bench()
  const input = screen.getByRole('textbox', { name: en.message })
  fireEvent.change(input, { target: { value: '你好', selectionStart: 2 } })
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
  fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
  fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })
  expect(face.send).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: en.settings }))
  fireEvent.keyDown(input, { key: 'Enter' })
  expect(face.send).not.toHaveBeenCalled()
  expect(screen.getByRole('dialog')).toBeTruthy()
  expect(screen.getByRole('article', { name: 'Sage' })).toBeTruthy()
})

it('saves member selection and the new default responder from a modal', async () => {
  const { face, bots } = await bench()
  fireEvent.click(screen.getByRole('button', { name: en.settings }))
  const dialog = screen.getByRole('dialog')
  fireEvent.click(within(dialog).getByRole('checkbox', { name: /Sage/ }))
  expect(within(dialog).getByRole<HTMLSelectElement>('combobox').value).toBe('nova')
  fireEvent.click(within(dialog).getByRole('button', { name: en.save }))
  await waitFor(() => { expect(face.setMembers).toHaveBeenCalledWith({ roomId: 'studio', botIds: [bots[1]!.id], defaultBot: bots[1]!.id }) })
  await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
})

it('routes a reply to the selected public message and clears the composer after success', async () => {
  const { face } = await bench()
  fireEvent.click(within(screen.getByRole('article', { name: 'Sage' })).getByRole('button', { name: en.reply }))
  expect(screen.getByRole('button', { name: en.removeReply })).toBeTruthy()
  const input = screen.getByRole('textbox', { name: en.message })
  fireEvent.change(input, { target: { value: 'Go deeper' } })
  fireEvent.click(screen.getByRole('button', { name: en.send }))
  await waitFor(() => { expect(face.send).toHaveBeenCalledWith({ roomId: 'studio', text: 'Go deeper', replyTo: 'answer' }) })
  await waitFor(() => { expect((input as HTMLTextAreaElement).value).toBe('') })
})

it('combines chat kind and text filters without changing the open conversation', async () => {
  await bench()
  const roster = screen.getByRole('complementary', { name: en.chats })
  const filters = within(roster).getByRole('group', { name: en.filterChats })
  fireEvent.click(within(filters).getByRole('button', { name: en.bots }))
  expect(within(roster).queryByRole('button', { name: /Design studio/ })).toBeNull()
  expect(screen.getByRole('heading', { level: 2, name: 'Design studio' })).toBeTruthy()
  fireEvent.change(screen.getByRole('textbox', { name: en.search }), { target: { value: 'nova' } })
  expect(within(roster).getByRole('button', { name: /Nova\s*@nova/ })).toBeTruthy()
  expect(within(roster).queryByRole('button', { name: /Sage\s*@sage/ })).toBeNull()
  fireEvent.click(within(filters).getByRole('button', { name: en.groups }))
  expect(within(roster).getByRole('button', { name: /Design studio/ })).toBeTruthy()
  expect(within(roster).queryByRole('button', { name: /Nova\s*@nova/ })).toBeNull()
})

it('adds a member from the quick picker without sending or discarding the draft', async () => {
  const { face } = await bench()
  const input = screen.getByRole<HTMLTextAreaElement>('textbox', { name: en.message })
  fireEvent.change(input, { target: { value: 'Review this' } })
  const recipients = screen.getByRole('group', { name: en.quickMention })
  fireEvent.click(within(recipients).getByRole('button', { name: 'Nova' }))
  expect(input.value).toBe('Review this @nova ')
  expect(face.send).not.toHaveBeenCalled()
  await waitFor(() => { expect(document.activeElement).toBe(input) })
  fireEvent.click(screen.getByRole('button', { name: en.send }))
  await waitFor(() => { expect(face.send).toHaveBeenCalledWith({ roomId: 'studio', text: 'Review this @nova ' }) })
})

it('opens member responsibilities and the original Session from chat info', async () => {
  const { face } = await bench()
  fireEvent.click(screen.getByRole('button', { name: en.chatInfo }))
  const dialog = screen.getByRole('dialog', { name: en.chatInfo })
  expect(within(dialog).getByText('Review assumptions.')).toBeTruthy()
  expect(within(dialog).getByText(en.defaultResponder)).toBeTruthy()
  const nova = within(dialog).getByText('Review assumptions.').closest('section')!
  fireEvent.click(within(nova).getByRole('button', { name: en.execution }))
  expect(face.openSession).toHaveBeenCalledWith('nova-group')
  await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
})

it('labels external speakers and keeps InfoFlow rooms read-only while retaining execution access', async () => {
  const { model, room, bots, face } = await bench()
  model.replace({ bots, rooms: [{ ...room, external: { provider: 'infoflow', accountId: 'app', kind: 'group', id: '123' },
    messages: room.messages.map(message => message.botId ? message : { ...message, external: { id: 'wire-1', sender: { id: 'alice', name: 'Alice' } } }) }] })
  await waitFor(() => { expect(screen.getByRole('article', { name: 'Alice (alice)' })).toBeTruthy() })
  expect(screen.getByText(en.externalReadOnly)).toBeTruthy()
  expect(screen.queryByRole('textbox', { name: en.message })).toBeNull()
  expect(screen.queryByRole('button', { name: en.settings })).toBeNull()
  expect(screen.queryByRole('button', { name: en.reply })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: en.execution }))
  expect(face.openSession).toHaveBeenCalledWith('sage-group')
})


it('configures each Bot through the InfoFlow page and never displays stored secrets', async () => {
  const saved = { botId: 'sage' as BotId, agentId: '11', robotId: '111', robotName: 'Sage robot', enabled: false,
    status: 'disabled' as const, error: null, credentialsConfigured: true, allowUsers: ['alice'], allowGroups: [], admins: ['alice'] }
  const infoflow = { snapshot: vi.fn(async () => ({ available: true, bindings: [saved], groups: [] })),
    save: vi.fn(async () => saved), verify: vi.fn(async () => saved), toggle: vi.fn(async () => saved), testMessage: vi.fn(),
    createGroup: vi.fn(), resumeGroup: vi.fn() }
  await bench({ infoflow })
  fireEvent.click(screen.getByRole('button', { name: en.imTitle }))
  fireEvent.click(screen.getByRole('tab', { name: en.infoflow }))
  await screen.findByRole('button', { name: 'Verify and save' })
  expect((screen.getByLabelText('AppSecret') as HTMLInputElement).value).toBe('')
  expect((screen.getByLabelText('Allowed private-chat accounts') as HTMLInputElement).value).toBe('alice')
  fireEvent.change(screen.getByLabelText('AppSecret'), { target: { value: 'new-secret' } })
  fireEvent.click(screen.getByRole('button', { name: 'Verify and save' }))
  await waitFor(() => expect(infoflow.save).toHaveBeenCalledWith({ botId: 'sage', agentId: '11', appSecret: 'new-secret', allowUsers: ['alice'], allowGroups: [], allowAllGroups: false, admins: ['alice'] }))
  await waitFor(() => expect((screen.getByLabelText('AppSecret') as HTMLInputElement).value).toBe(''))
  fireEvent.click(screen.getByRole('button', { name: 'Enable connection' }))
  await waitFor(() => expect(infoflow.toggle).toHaveBeenCalledWith({ botId: 'sage', enabled: true }))
})

it('makes platform group creation optional and sends the owner and selected Bots only when selected', async () => {
  const infoflow = { snapshot: vi.fn(), save: vi.fn(), verify: vi.fn(), toggle: vi.fn(), testMessage: vi.fn(), createGroup: vi.fn(), resumeGroup: vi.fn() }
  const f = await bench({ infoflow }); infoflow.createGroup.mockResolvedValue(f.room)
  fireEvent.click(screen.getByRole('button', { name: 'New group' }))
  const option = screen.getByLabelText('Also create an InfoFlow group')
  expect((option as HTMLInputElement).checked).toBe(false)
  fireEvent.click(option)
  fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'Launch' } })
  fireEvent.change(screen.getByLabelText('Group owner (account prefix)'), { target: { value: 'alice' } })
  fireEvent.change(screen.getByLabelText('Invite members (comma-separated account prefixes, optional)'), { target: { value: 'bob, carol' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create', exact: true }))
  await waitFor(() => expect(infoflow.createGroup).toHaveBeenCalledWith(expect.objectContaining({ title: 'Launch', owner: 'alice', members: ['bob', 'carol'], botIds: ['sage', 'nova'], defaultBot: 'sage', requestId: expect.any(String) })))
})

it('opens one IM panel with both platforms and creates a Feishu robot only for the selected Bot', async () => {
  let registrations: import('../src/feishu/types.ts').FeishuRegistration[] = []
  const feishu = { createGroup: vi.fn(), resumeGroup: vi.fn(), snapshot: vi.fn(async () => ({ available: true, bindings: [], registrations, groups: [] })), save: vi.fn(), verify: vi.fn(), toggle: vi.fn(), cancel: vi.fn(),
    register: vi.fn(async (botId: BotId) => { const item = { botId, attemptId: 'attempt', status: 'waiting' as const, url: 'https://accounts.feishu.cn/fixture', qrDataUrl: 'data:image/png;base64,fixture', expiresAt: Date.now() + 600000, message: null }; registrations = [item]; return item }) }
  await bench({ feishu })
  expect(screen.queryByRole('button', { name: en.ifTitle })).toBeNull()
  expect(screen.queryByRole('button', { name: en.fsTitle })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: en.imTitle }))
  await screen.findByRole('button', { name: en.fsCreate })
  expect(screen.getByRole('heading', { name: en.imTitle })).toBeTruthy()
  expect(screen.getAllByRole('tab')).toHaveLength(2)
  expect(screen.getAllByRole('tabpanel')).toHaveLength(1)
  expect(feishu.register).not.toHaveBeenCalled()
  fireEvent.click(within(screen.getByRole('navigation', { name: en.fsChooseBot })).getByRole('button', { name: /Nova/ }))
  fireEvent.click(screen.getByRole('button', { name: en.fsCreate }))
  await screen.findByRole('img', { name: en.fsQrAlt })
  expect(feishu.register).toHaveBeenCalledWith('nova')
  expect((screen.getByRole('button', { name: en.fsCreate }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: en.fsCancel }))
  await waitFor(() => expect(feishu.cancel).toHaveBeenCalledWith('attempt'))
})

it('binds an existing Feishu app with a write-only secret and explicit allowlists', async () => {
  const binding = { botId: 'sage' as BotId, appId: 'cli_sage', botOpenId: 'ou_bot', robotName: 'Sage robot', brand: 'feishu' as const, enabled: false,
    status: 'disabled' as const, error: null, credentialsConfigured: true, allowUsers: ['ou_owner'], allowGroups: [], admins: ['ou_owner'] }
  let saved = false
  const feishu = { createGroup: vi.fn(), resumeGroup: vi.fn(), snapshot: vi.fn(async () => ({ available: true, bindings: saved ? [binding] : [], registrations: [], groups: [] })),
    save: vi.fn(async () => { saved = true; return binding }), verify: vi.fn(), toggle: vi.fn(), cancel: vi.fn(), register: vi.fn() }
  await bench({ feishu }); fireEvent.click(screen.getByRole('button', { name: en.imTitle }))
  fireEvent.click(await screen.findByRole('button', { name: en.fsManual }))
  fireEvent.change(screen.getByLabelText('App ID'), { target: { value: 'cli_sage' } })
  fireEvent.change(screen.getByLabelText('App Secret'), { target: { value: 'private-secret' } })
  fireEvent.change(screen.getByLabelText(en.fsAllowUsers), { target: { value: 'ou_owner' } })
  fireEvent.keyDown(screen.getByRole('tab', { name: en.feishu }), { key: 'ArrowRight' })
  expect(screen.getByRole('tab', { name: en.infoflow }).getAttribute('aria-selected')).toBe('true')
  expect(screen.getByRole('tabpanel', { name: en.infoflow }).textContent).toContain(en.ifUnavailable)
  fireEvent.keyDown(screen.getByRole('tab', { name: en.infoflow }), { key: 'ArrowLeft' })
  expect(screen.getByRole('tab', { name: en.feishu }).getAttribute('aria-selected')).toBe('true')
  expect((screen.getByLabelText('App Secret') as HTMLInputElement).value).toBe('private-secret')
  expect((screen.getByLabelText('App ID') as HTMLInputElement).value).toBe('cli_sage')
  expect(feishu.save).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: en.ifSaveVerify }))
  await waitFor(() => expect(feishu.save).toHaveBeenCalledWith({ botId: 'sage', appId: 'cli_sage', appSecret: 'private-secret', brand: 'feishu', allowUsers: ['ou_owner'], allowGroups: [], admins: [] }))
  await waitFor(() => expect((screen.getByLabelText('App Secret') as HTMLInputElement).value).toBe(''))
  expect(feishu.register).not.toHaveBeenCalled()
})

it('creates a Feishu group from the selected bot without requiring a manually copied Chat ID', async () => {
  const binding = { botId: 'sage' as BotId, appId: 'cli_sage', botOpenId: 'ou_bot', robotName: 'Sage robot', brand: 'feishu' as const, enabled: true,
    status: 'connected' as const, error: null, credentialsConfigured: true, allowUsers: ['ou_owner'], allowGroups: [], admins: ['ou_owner'] }
  const feishu = { createGroup: vi.fn(), resumeGroup: vi.fn(), snapshot: vi.fn(async () => ({ available: true, bindings: [binding], registrations: [], groups: [] })), save: vi.fn(), verify: vi.fn(), toggle: vi.fn(), cancel: vi.fn(), register: vi.fn() }
  const f = await bench({ feishu }); feishu.createGroup.mockResolvedValue(f.room)
  fireEvent.click(screen.getByRole('button', { name: en.imTitle }))
  await waitFor(() => expect((screen.getByRole('button', { name: en.fsNewGroup }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: en.fsNewGroup }))
  const dialog = screen.getByRole('dialog')
  expect((within(dialog).getByRole('checkbox', { name: en.fsCreateGroup }) as HTMLInputElement).checked).toBe(true)
  fireEvent.change(within(dialog).getByRole('textbox', { name: en.groupTitle }), { target: { value: 'New team' } })
  fireEvent.click(within(dialog).getByRole('button', { name: en.create }))
  await waitFor(() => expect(feishu.createGroup).toHaveBeenCalledWith({ requestId: expect.any(String), title: 'New team', botIds: ['sage'], creatorBot: 'sage' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

it('lets a rejected Feishu group switch creator and retry without reusing the failed request', async () => {
  const state: FeishuState = { available: true, registrations: [], groups: [], bindings: ['sage', 'nova'].map(id => ({
    botId: id as BotId, appId: `cli_${id}`, botOpenId: `ou_${id}`, robotName: id, brand: 'feishu', enabled: true,
    status: 'connected', error: null, credentialsConfigured: true, allowUsers: ['ou_owner'], allowGroups: [], admins: ['ou_owner'],
  })) }
  const feishu = { createGroup: vi.fn(), resumeGroup: vi.fn(), snapshot: vi.fn(async () => state), save: vi.fn(), verify: vi.fn(), toggle: vi.fn(), cancel: vi.fn(), register: vi.fn() }
  const f = await bench({ feishu })
  feishu.createGroup.mockImplementationOnce(async request => {
    state.groups.push({ ...request, owner: 'ou_owner', createdAt: 1, chatId: null, roomId: null, status: 'failed', error: 'Missing im:chat:create' })
    throw new Error('Missing im:chat:create')
  }).mockResolvedValueOnce(f.room)
  fireEvent.click(screen.getByRole('button', { name: en.newGroup, exact: true }))
  const dialog = screen.getByRole('dialog')
  fireEvent.change(within(dialog).getByRole('textbox', { name: en.groupTitle }), { target: { value: 'Launch' } })
  fireEvent.click(within(dialog).getByRole('checkbox', { name: en.fsCreateGroup }))
  fireEvent.click(within(dialog).getByRole('button', { name: en.create }))
  await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toContain('im:chat:create'))
  expect((within(dialog).getByRole('button', { name: en.create }) as HTMLButtonElement).disabled).toBe(false)
  expect(within(dialog).getByRole('link', { name: `${en.fsGroupAuthorize} · Sage` }).getAttribute('href')).toBe('https://open.feishu.cn/app/cli_sage/auth?q=im%3Achat%3Acreate')
  expect((within(dialog).getByRole('combobox') as HTMLSelectElement).disabled).toBe(false)
  expect((within(dialog).getByRole('textbox', { name: en.groupTitle }) as HTMLInputElement).disabled).toBe(false)
  fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: 'nova' } })
  fireEvent.click(within(dialog).getByRole('button', { name: en.create }))
  await waitFor(() => expect(feishu.createGroup).toHaveBeenCalledTimes(2))
  expect(feishu.createGroup.mock.calls[1]![0]).toMatchObject({ title: 'Launch', creatorBot: 'nova', botIds: ['sage', 'nova'] })
  expect(feishu.createGroup.mock.calls[1]![0].requestId).not.toBe(feishu.createGroup.mock.calls[0]![0].requestId)
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

it.each(['uncertain', 'linking', 'unreadable'] as const)('retains the original request and locks edits when Feishu creation is %s', async outcome => {
  let submitted = false
  const state: FeishuState = { available: true, registrations: [], groups: [], bindings: [] }
  const feishu = { createGroup: vi.fn(), resumeGroup: vi.fn(), snapshot: vi.fn(async () => {
    if (submitted && outcome === 'unreadable') throw new Error('snapshot unavailable')
    return state
  }), save: vi.fn(), verify: vi.fn(), toggle: vi.fn(), cancel: vi.fn(), register: vi.fn() }
  const f = await bench({ feishu })
  feishu.createGroup.mockImplementationOnce(async request => {
    submitted = true
    state.groups.push({ ...request, owner: 'ou_owner', createdAt: 1, chatId: outcome === 'linking' ? 'oc_created' : null, roomId: null, status: outcome === 'linking' ? 'linking' : 'uncertain', error: 'Original creation error' })
    throw new Error('Original creation error')
  }).mockResolvedValueOnce(f.room)
  fireEvent.click(screen.getByRole('button', { name: en.newGroup, exact: true }))
  const dialog = screen.getByRole('dialog')
  fireEvent.change(within(dialog).getByRole('textbox', { name: en.groupTitle }), { target: { value: 'Launch' } })
  fireEvent.click(within(dialog).getByRole('checkbox', { name: en.fsCreateGroup }))
  fireEvent.click(within(dialog).getByRole('button', { name: en.create }))
  await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toBe('Original creation error'))
  expect((within(dialog).getByRole('combobox') as HTMLSelectElement).disabled).toBe(true)
  expect((within(dialog).getByRole('checkbox', { name: en.fsCreateGroup }) as HTMLInputElement).disabled).toBe(true)
  fireEvent.click(within(dialog).getByRole('button', { name: en.fsGroupResume }))
  await waitFor(() => expect(feishu.createGroup).toHaveBeenCalledTimes(2))
  expect(feishu.createGroup.mock.calls[1]![0]).toEqual(feishu.createGroup.mock.calls[0]![0])
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
})

it('reopens a rejected group with its draft and switches to a successful creator without carrying another app owner', async () => {
  const state: FeishuState = { available: true, registrations: [], bindings: ['sage', 'nova'].map(id => ({
    botId: id as BotId, appId: `cli_${id}`, botOpenId: `ou_${id}`, robotName: id, brand: 'feishu', enabled: true,
    status: 'connected', error: null, credentialsConfigured: true, allowUsers: ['ou_owner'], allowGroups: [], admins: ['ou_owner'],
  })), groups: [
    { requestId: 'failed-request', title: 'Keep my draft', botIds: ['sage', 'nova'] as BotId[], creatorBot: 'sage' as BotId, owner: 'ou_sage_owner', createdAt: 1, chatId: null, roomId: null, status: 'failed', error: 'Missing im:chat:create' },
    { requestId: 'ready-request', title: 'Existing group', botIds: ['nova'] as BotId[], creatorBot: 'nova' as BotId, owner: 'ou_nova_owner', createdAt: 1, chatId: 'oc_existing', roomId: 'existing' as RoomId, status: 'ready', error: null },
  ] }
  const feishu = { createGroup: vi.fn(), resumeGroup: vi.fn(), snapshot: vi.fn(async () => state), save: vi.fn(), verify: vi.fn(), toggle: vi.fn(), cancel: vi.fn(), register: vi.fn() }
  const f = await bench({ feishu }); feishu.createGroup.mockResolvedValue(f.room)
  fireEvent.click(screen.getByRole('button', { name: en.imTitle }))
  fireEvent.click(await screen.findByRole('button', { name: en.fsGroupEdit }))
  const dialog = screen.getByRole('dialog')
  expect((within(dialog).getByRole('textbox', { name: en.groupTitle }) as HTMLInputElement).value).toBe('Keep my draft')
  fireEvent.click(await within(dialog).findByRole('button', { name: `${en.fsGroupUseSuccessful} · Nova` }))
  expect((within(dialog).getByRole('combobox') as HTMLSelectElement).value).toBe('nova')
  expect(within(dialog).queryByRole('alert')).toBeNull()
  expect(feishu.createGroup).not.toHaveBeenCalled()
  fireEvent.click(within(dialog).getByRole('button', { name: en.create }))
  await waitFor(() => expect(feishu.createGroup).toHaveBeenCalledWith({ requestId: expect.any(String), title: 'Keep my draft', creatorBot: 'nova', botIds: ['sage', 'nova'] }))
  expect(feishu.createGroup.mock.calls[0]![0].requestId).not.toBe('failed-request')
})

it('pastes InfoFlow credentials locally, saves and connects, and sends a test only on request', async () => {
  let bindings: InfoFlowState['bindings'] = []
  const saved = { botId: 'sage' as BotId, agentId: '11', robotId: '111', robotName: 'Sage robot', enabled: true,
    status: 'connecting' as const, error: null, credentialsConfigured: true, allowUsers: ['alice'], allowGroups: [], allowAllGroups: true, admins: [] }
  const infoflow = { snapshot: vi.fn(async () => ({ available: true, bindings, groups: [] })),
    save: vi.fn(async () => { bindings = [saved]; return saved }), verify: vi.fn(), toggle: vi.fn(), testMessage: vi.fn(async () => {}), createGroup: vi.fn(), resumeGroup: vi.fn() }
  await bench({ infoflow }); fireEvent.click(screen.getByRole('button', { name: en.imTitle }))
  fireEvent.click(screen.getByRole('tab', { name: en.infoflow }))
  const paste = await screen.findByLabelText(en.ifPasteCredentials)
  expect(screen.getByRole('link', { name: en.ifPlatform }).getAttribute('href')).toBe('https://open-ruliu.baidu-int.com/web')
  fireEvent.paste(paste, { clipboardData: { getData: () => '应用 ID：11\nApp Key：fixture-key\nApp Secret：fixture-secret' } })
  expect((screen.getByLabelText('AppKey') as HTMLInputElement).value).toBe('fixture-key')
  expect((screen.getByLabelText('AppSecret') as HTMLInputElement).type).toBe('password')
  expect((paste as HTMLInputElement).value).toBe('')
  expect(infoflow.save).not.toHaveBeenCalled(); expect(infoflow.testMessage).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText(en.ifAllowUsers), { target: { value: 'alice' } })
  fireEvent.click(screen.getByLabelText(en.ifAllGroups))
  fireEvent.click(screen.getByRole('button', { name: en.ifSaveConnect }))
  await waitFor(() => expect(infoflow.save).toHaveBeenCalledWith({ botId: 'sage', appKey: 'fixture-key', appSecret: 'fixture-secret', agentId: '11', connect: true, allowUsers: ['alice'], allowGroups: [], allowAllGroups: true, admins: [] }))
  await waitFor(() => expect((screen.getByLabelText('AppSecret') as HTMLInputElement).value).toBe(''))
  expect(infoflow.testMessage).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: en.ifTestSend }))
  await waitFor(() => expect(infoflow.testMessage).toHaveBeenCalledWith({ botId: 'sage', user: 'alice' }))
  fireEvent.change(screen.getByLabelText('AppSecret'), { target: { value: 'draft-secret' } })
  expect((screen.getByRole('button', { name: en.ifTestSend }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: en.ifResetDraft }))
  expect((screen.getByLabelText('AppSecret') as HTMLInputElement).value).toBe('')
  expect(infoflow.save).toHaveBeenCalledTimes(1)
})
