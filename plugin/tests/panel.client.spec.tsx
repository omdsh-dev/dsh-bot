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

const runtimes = new Set<SlotTestRuntime>()
afterEach(async () => { for (const runtime of runtimes) await runtime.dispose(); runtimes.clear(); cleanup(); vi.restoreAllMocks() })

async function bench() {
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
    send: vi.fn(async () => {}), stop: unused, retry: unused, openSession: vi.fn(), toggleSidebar: vi.fn() }
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
