import type { InfoFlowState } from '../src/types.ts'
// @vitest-environment jsdom
/** User interactions through the real slot renderer and observable Bot feed. */
import type {} from '../src/client/index.ts'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { Bot, BotId, Room, RoomId, ChatMessageId, HistoryPage } from '../src/types.ts'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { PanelFace } from '../src/client/Panel.tsx'
import { BotModel } from '../src/client/model.ts'
import { createBotViewStore } from '../src/client/view-store.ts'
import { registerPanel } from '../src/client/registration.ts'
import { en, zh } from '../src/client/locales.ts'
import type { FeishuState } from '../src/feishu/types.ts'
import type { CapabilityFace } from '../src/client/capability-face.ts'
import { ledgerReport, usageReport } from '../src/usage.ts'

const runtimes = new Set<SlotTestRuntime>()
afterEach(async () => { for (const runtime of runtimes) await runtime.dispose(); runtimes.clear(); cleanup(); vi.restoreAllMocks() })

async function bench(overrides: Partial<PanelFace> = {}, infoflowVisible = false) {
  const runtime = await SlotTestRuntime.create()
  runtimes.add(runtime)
  const bots: Bot[] = [{ id: 'sage' as BotId, name: 'Sage', instructions: 'Think through product ideas.', preset: 'standard' },
    { id: 'nova' as BotId, name: 'Nova', instructions: 'Review assumptions.', preset: 'standard' }]
  const members = bots.map(bot => ({ botId: bot.id, sessionId: `${bot.id}-group` as SessionId, cursor: 0 }))
  const room: Room = { id: 'studio' as RoomId, title: 'Design studio', kind: 'group', members, defaultBot: bots[0]!.id,
    messages: [{ id: 'question' as ChatMessageId, botId: null, text: 'A shared idea', replyTo: null, status: 'complete', error: null, time: 1000 },
      { id: 'answer' as ChatMessageId, botId: bots[0]!.id, text: 'Start with **one clear question**.', replyTo: 'question' as ChatMessageId, status: 'complete', error: null, time: 2000 }] }
  const rooms: Room[] = [room, ...bots.map(bot => ({ id: `dm-${bot.id}` as RoomId, title: bot.name, kind: 'dm' as const, members: [members.find(member => member.botId === bot.id)!], defaultBot: bot.id, messages: [] }))]
  const model = new BotModel(); model.replace({ bots, rooms, infoflowVisible })
  const unused = async (): Promise<never> => { throw new Error('unexpected command') }
  const face: PanelFace = { hooks: { bots: model }, createBot: unused, updateBot: unused, createGroup: unused, setMembers: vi.fn(async () => room),
    setInfoflowVisible: vi.fn(async visible => { model.replace({ ...model.getSnapshot().value, infoflowVisible: visible }); return visible }),
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

it('renders card text without HTML execution and submits form values to the original message once', async () => {
  const submitCard = vi.fn(async () => 'new-human-message')
  const b = await bench({ capabilities: { submitCard } as unknown as CapabilityFace })
  b.room.messages[1]!.cards = [
    { id: 'metric', revision: 1, content: { kind: 'metric', title: 'Result', value: '<img src=x onerror=alert(1)>' } },
    { id: 'form', revision: 2, content: { kind: 'form', title: 'Next step', submitLabel: 'Confirm details', fields: [{ name: 'detail', label: 'Your detail', type: 'text', required: true }] } },
  ]
  b.model.replace({ bots: b.bots, rooms: b.rooms })
  const form = await screen.findByRole('region', { name: 'Next step' })
  expect(screen.getByText('<img src=x onerror=alert(1)>').querySelector('img')).toBeNull()
  fireEvent.change(within(form).getByRole('textbox', { name: 'Your detail *' }), { target: { value: 'Proceed with A' } })
  fireEvent.click(within(form).getByRole('button', { name: 'Confirm details' }))
  await within(form).findByRole('button', { name: 'Submitted' })
  expect(submitCard).toHaveBeenCalledExactlyOnceWith({ roomId: 'studio', messageId: 'answer', cardId: 'form', revision: 2, values: { detail: 'Proceed with A' } })
  expect(within(form).getByRole('textbox').closest('fieldset')!.disabled).toBe(true)
})

it('keeps Main Bot management disabled until the operator selects a Bot and specific operations', async () => {
  let settings: import('../src/team-types.ts').TeamSettings = { revision: 0, botId: null, operations: [] }
  const configureTeam = vi.fn(async (next: typeof settings) => { settings = { ...next, revision: next.revision + 1 } })
  await bench({ capabilities: { catalog: async () => ({ providers: [], tools: [] }), teamView: async () => ({ settings, audit: [] }), configureTeam } as unknown as CapabilityFace })
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  fireEvent.click(screen.getByText('More settings', { exact: true }))
  fireEvent.click(screen.getByRole('button', { name: 'Team management' }))
  const region = await screen.findByRole('region', { name: 'Main Bot team management' })
  await within(region).findByRole('combobox', { name: 'Main Bot' })
  expect((within(region).getByRole('checkbox', { name: 'Create Bots' }) as HTMLInputElement).disabled).toBe(true)
  fireEvent.change(within(region).getByRole('combobox', { name: 'Main Bot' }), { target: { value: 'sage' } })
  expect((within(region).getByRole('checkbox', { name: 'Create Bots' }) as HTMLInputElement).checked).toBe(false)
  fireEvent.click(within(region).getByRole('checkbox', { name: 'Create Bots' }))
  fireEvent.click(within(region).getByRole('button', { name: 'Save team grants' }))
  await waitFor(() => expect(configureTeam).toHaveBeenCalledExactlyOnceWith({ revision: 0, botId: 'sage', operations: ['create-bot'] }))
})

it('opens usage from the sidebar, filters full Host totals and opens budget controls without losing the draft', async () => {
  const read = vi.fn(async () => report)
  const capabilities = { usageReport: read, catalog: async () => ({ providers: [], tools: [] }) } as unknown as CapabilityFace
  const b = await bench({ capabilities })
  const report = usageReport({ bots: b.bots, rooms: [], budget: { tokenLimit: 1000, costLimit: 2, currency: 'USD', since: 1000, used: { input: 600, output: 100, cost: 0.25 } },
    maintenanceUsage: [{ botId: 'sage', purpose: 'memory', input: 200, output: 20, cost: 0.01, calls: 2 }, { botId: 'nova', purpose: 'handoff', input: 300, output: 30, cost: 0.01, calls: 1 }],
    budgetReservations: { call: [{ scope: '*', tokens: 100, cost: 0.1 }] } }, 2000)
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Keep this draft' } })
  fireEvent.click(screen.getByRole('button', { name: 'Usage' }))
  await screen.findByRole('table', { name: 'Usage by Bot' })
  expect(read).toHaveBeenCalledOnce()
  const summary = screen.getByRole('region', { name: 'Overall budget usage' })
  expect(within(summary).getByText('700')).toBeTruthy()
  expect(within(summary).getByText('USD 0.25')).toBeTruthy()
  expect(screen.getByRole('progressbar', { name: 'Overall budget Token' }).getAttribute('value')).toBe('800')
  fireEvent.change(screen.getByRole('combobox', { name: 'Filter Bot' }), { target: { value: 'nova' } })
  const table = screen.getByRole('table', { name: 'Usage by Bot' })
  expect(within(table).queryByText('Sage')).toBeNull()
  expect(within(table).getAllByText('330')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: 'Manage budgets' }))
  expect(screen.getByRole('spinbutton', { name: 'Token limit (0 means unlimited)' })).toBeTruthy()
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))
  fireEvent.click(screen.getByRole('button', { name: 'Back to chat' }))
  expect((screen.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement).value).toBe('Keep this draft')
})

it('shows a retryable usage failure rather than inventing zero totals and supports an empty deployment', async () => {
  const read = vi.fn<CapabilityFace['usageReport']>().mockRejectedValueOnce(new Error('temporarily offline')).mockResolvedValue(usageReport({ bots: [], rooms: [] }))
  await bench({ capabilities: { usageReport: read } as unknown as CapabilityFace })
  fireEvent.click(screen.getByRole('button', { name: 'Usage' }))
  expect((await screen.findByRole('alert')).textContent).toContain('temporarily offline')
  expect(screen.queryByRole('region', { name: 'Overall budget usage' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Refresh usage' }))
  await screen.findByText('No Bot usage records yet. Start a conversation to see usage here.')
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByRole('progressbar')).toBeNull()
})

it('sends ledger filters to the Host and distinguishes cached tokens from unreported reservations', async () => {
  const report = await ledgerReport({ bots: [], rooms: [] }, [{ id: 'call', botId: 'sage', roomId: 'studio', messageId: 'answer', sessionId: 'session', purpose: 'conversation',
    startedAt: Date.parse('2026-10-23T10:00:00Z'), completedAt: Date.parse('2026-10-23T10:00:01Z'), provider: 'p', model: 'm', currency: 'USD', inputPrice: 1, outputPrice: 2,
    input: 100, output: 10, cacheRead: 80, cacheWrite: 0, cost: 0.00012, records: 1, status: 'reported' }])
  const read = vi.fn(async () => report)
  await bench({ capabilities: { usageReport: read } as unknown as CapabilityFace })
  fireEvent.click(screen.getByRole('button', { name: 'Usage' }))
  await screen.findByRole('region', { name: 'Call ledger' })
  expect(screen.getAllByText('80 / 0').length).toBeGreaterThan(0)
  fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-23' } })
  await waitFor(() => expect(read).toHaveBeenLastCalledWith(expect.objectContaining({ from: Date.parse('2026-10-23T00:00:00Z') })))
  fireEvent.change(screen.getByRole('combobox', { name: 'Model' }), { target: { value: '["p","m"]' } })
  await waitFor(() => expect(read).toHaveBeenLastCalledWith(expect.objectContaining({ provider: 'p', model: 'm' })))
})

it('loads per-response context only when opened and shows forgotten memories without their contents', async () => {
  const contextView = vi.fn(async () => ({ botId: 'sage', sessionId: 'sage-group', trace: { sessionId: 'sage-group', measuredAt: 1, tokens: 80, window: 1000, measurement: 'provider', memories: [{ id: 'forgotten', revision: 1 }], conflicts: [], omitted: 0, recalls: 1 }, current: null,
    memories: [{ id: 'forgotten', revision: 1, status: 'forgotten', scope: 'bot', subject: '', topic: '', body: '' }], segments: [], pendingHandoff: null, decisions: [] }))
  await bench({ capabilities: { contextView } as unknown as CapabilityFace })
  expect(contextView).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('Memory & context'))
  await screen.findByText('Content forgotten or unavailable')
  expect(contextView).toHaveBeenCalledWith({ roomId: 'studio', messageId: 'answer' })
  expect(screen.getByRole('progressbar', { name: 'Context occupancy' }).getAttribute('value')).toBe('80')
})

it('manages scoped memories and previews recall through the controls panel', async () => {
  const candidate = { id: 'memory', revision: 1, scope: 'bot', ownerId: 'sage', kind: 'preference', subject: 'response', topic: 'language', body: 'Use Chinese', status: 'pending', access: 'scope', source: { kind: 'operator', evidence: 'confirmed request' }, createdAt: 100, updatedAt: 100 }
  const memoryAction = vi.fn(async () => {}), saveMemory = vi.fn(async () => candidate)
  const listMemories = vi.fn(async () => [candidate]), previewMemories = vi.fn(async () => ({ records: [], conflicts: [], omitted: 0, text: '' }))
  const capabilities = { catalog: async () => ({ providers: [], tools: [] }), memoryCatalog: async () => ({ users: [{ id: 'local:operator', name: 'Local operator' }] }), listMemories, memoryAction, saveMemory, previewMemories } as unknown as CapabilityFace
  await bench({ capabilities })
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  fireEvent.click(screen.getByRole('button', { name: 'Memory' }))
  expect(screen.queryByRole('textbox', { name: 'Memory content' })).toBeNull()
  await waitFor(() => expect(screen.getByText('Use Chinese')).toBeTruthy())
  expect(listMemories).toHaveBeenCalledWith({ query: '' })
  expect((screen.getByRole('combobox', { name: 'Memory scope' }) as HTMLSelectElement).value).toBe('all')
  fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
  await waitFor(() => expect(memoryAction).toHaveBeenCalledWith({ id: 'memory', revision: 1, action: 'approve' }))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Edit / share' }).hasAttribute('disabled')).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: 'Edit / share' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Memory content' }), { target: { value: 'Use short Chinese paragraphs' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save & activate' }))
  await waitFor(() => expect(saveMemory).toHaveBeenCalledWith(expect.objectContaining({ id: 'memory', revision: 1, scope: 'bot', ownerId: 'sage', body: 'Use short Chinese paragraphs', share: false })))
  fireEvent.click(screen.getByText('Preview recall for this chat'))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Preview' }).hasAttribute('disabled')).toBe(false))
  fireEvent.change(screen.getByRole('textbox', { name: 'Recall query' }), { target: { value: 'language' } })
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }))
  await waitFor(() => expect(previewMemories).toHaveBeenCalledWith({ roomId: 'studio', botId: 'sage', userId: 'local:operator', query: 'language' }))
})

it('keeps the composer available during execution and sends an explicit web delegation choice', async () => {
  const unused = vi.fn(async () => undefined)
  const capabilities = { catalog: async () => ({ providers: [], tools: [] }), openDirect: unused, history: unused, exportChat: unused, lifecycle: unused, configureBudget: unused,
    upload: unused, decideApproval: unused, saveSchedule: unused, deleteSchedule: unused, failures: unused, resolveFailure: unused } as unknown as CapabilityFace
  const b = await bench({ capabilities })
  b.room.messages[1]!.status = 'running'
  b.model.replace({ bots: b.bots, rooms: b.rooms })
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'next task' } })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Allow Bot handoffs in this group' }))
  expect(screen.getByRole('button', { name: 'Send' }).hasAttribute('disabled')).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(b.face.send).toHaveBeenCalledWith({ roomId: b.room.id, text: 'next task', allowDelegation: true }))
})

it('searches older server history and saves an explicit budget from the controls panel', async () => {
  const unused = vi.fn(async () => undefined), history = vi.fn(async () => ({ messages: [], before: null, total: 0 }))
  const configureBudget = vi.fn(async () => undefined)
  const capabilities = { catalog: async () => ({ providers: [], tools: [] }), openDirect: unused, history, exportChat: unused, lifecycle: unused, configureBudget,
    upload: unused, decideApproval: unused, saveSchedule: unused, deleteSchedule: unused, failures: unused, resolveFailure: unused } as unknown as CapabilityFace
  const b = await bench({ capabilities })
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  fireEvent.click(screen.getByRole('button', { name: 'Chat history' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Search message text' }), { target: { value: 'needle' } })
  fireEvent.click(screen.getByRole('button', { name: 'Search' }))
  await waitFor(() => expect(history).toHaveBeenCalledWith({ roomId: b.room.id, query: 'needle', limit: 50 }))
  fireEvent.click(screen.getByRole('button', { name: 'Back to settings' }))
  fireEvent.click(screen.getByText('More settings', { exact: true }))
  fireEvent.click(screen.getByRole('button', { name: 'Usage limits' }))
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Token limit (0 means unlimited)' }), { target: { value: '50000' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save limits' }))
  await waitFor(() => expect(configureBudget).toHaveBeenCalledWith(expect.objectContaining({ tokenLimit: 50000, costLimit: 0, currency: 'USD' })))
})

it('preserves unsaved model settings when a fresh live snapshot arrives', async () => {
  const unused = vi.fn(async () => undefined)
  const capabilities = { catalog: async () => ({ providers: [], tools: [] }), openDirect: unused, history: unused, exportChat: unused, lifecycle: unused, configureBudget: unused,
    upload: unused, decideApproval: unused, saveSchedule: unused, deleteSchedule: unused, failures: unused, resolveFailure: unused } as unknown as CapabilityFace
  const b = await bench({ capabilities })
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  fireEvent.click(screen.getByRole('button', { name: 'Model' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Model' }), { target: { value: 'unsaved-model' } })
  b.model.replace(structuredClone({ bots: b.bots, rooms: b.rooms }))
  await waitFor(() => expect((screen.getByRole('textbox', { name: 'Model' }) as HTMLInputElement).value).toBe('unsaved-model'))
})

it('opens recent history immediately and ignores older results after clearing a filter', async () => {
  let finishEarlier!: (page: HistoryPage) => void
  const message = (id: string, text: string) => ({ id: id as ChatMessageId, botId: null, text, replyTo: null, status: 'complete' as const, error: null, time: 1000 })
  const history = vi.fn<CapabilityFace['history']>(async request => {
    if (request.before) return new Promise(resolve => { finishEarlier = resolve })
    if (request.query) return { messages: [message('match', 'Filtered message')], before: 'match' as ChatMessageId, total: 2 }
    return { messages: [message('recent', 'Recent retained message')], before: null, total: 1 }
  })
  await bench({ capabilities: { history } as unknown as CapabilityFace })
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  fireEvent.click(screen.getByRole('button', { name: 'Chat history' }))
  await screen.findByText('Recent retained message')
  expect(history).toHaveBeenCalledWith({ roomId: 'studio', query: '', limit: 50 })
  fireEvent.change(screen.getByRole('textbox', { name: 'Search message text' }), { target: { value: 'needle' } })
  fireEvent.click(screen.getByRole('button', { name: 'Search' }))
  await screen.findByText('Filtered message')
  fireEvent.change(screen.getByRole('textbox', { name: 'Search message text' }), { target: { value: 'unsent draft' } })
  fireEvent.click(screen.getByRole('button', { name: 'Load earlier messages' }))
  expect(history).toHaveBeenLastCalledWith({ roomId: 'studio', query: 'needle', before: 'match', limit: 50 })
  fireEvent.click(screen.getByRole('button', { name: 'Show all' }))
  await screen.findByText('Recent retained message')
  finishEarlier({ messages: [message('stale', 'Stale earlier result')], before: null, total: 2 })
  await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  expect(screen.queryByText('Stale earlier result')).toBeNull()
  expect(screen.queryByText('Filtered message')).toBeNull()
})

it('selects a listed model and filters tools without dropping hidden or unavailable selections', async () => {
  const updateBot = vi.fn<PanelFace['updateBot']>(async request => ({ id: request.id, name: request.name, instructions: request.instructions, preset: 'standard' }))
  const catalog = async () => ({ providers: [{ id: 'configured', models: [{ id: 'model-a', name: 'Writing model' }, { id: 'model-b', name: 'Reasoning model' }] }], tools: [{ name: 'read', description: 'Read local files' }, { name: 'search', description: 'Search documents\nDetailed search instructions.' }] })
  const b = await bench({ updateBot, capabilities: { catalog } as unknown as CapabilityFace })
  b.bots[0]!.policy = { provider: 'custom', model: 'saved', toolMode: 'allow', fileMode: 'read-only', tools: ['read', 'offline-tool'], inputPrice: 2 }
  b.model.replace({ bots: b.bots, rooms: b.rooms })
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  fireEvent.click(screen.getByRole('button', { name: 'Model' }))
  fireEvent.click(await screen.findByRole('button', { name: /^Reasoning model/ }))
  fireEvent.click(screen.getByText('Tool and file permissions'))
  expect(screen.getByText('Read local files')).toBeTruthy()
  expect(screen.getByText('Full description').closest('details')!.open).toBe(false)
  fireEvent.change(screen.getByRole('textbox', { name: 'Filter tools (optional)' }), { target: { value: 'documents' } })
  expect(screen.queryByRole('checkbox', { name: 'read' })).toBeNull()
  fireEvent.click(screen.getByRole('checkbox', { name: 'search' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save model settings' }))
  await waitFor(() => expect(updateBot).toHaveBeenCalledWith(expect.objectContaining({ policy: expect.objectContaining({ provider: 'configured', model: 'model-b', tools: ['read', 'offline-tool', 'search'], fileMode: 'read-only', inputPrice: 2 }) })))
})

it('keeps a custom model when discovery fails and supports retry without replacing the selection', async () => {
  const catalog = vi.fn<CapabilityFace['catalog']>().mockRejectedValueOnce(new Error('Discovery unavailable')).mockResolvedValue({ providers: [], tools: [] })
  const b = await bench({ capabilities: { catalog } as unknown as CapabilityFace })
  b.bots[0]!.policy = { provider: 'custom', model: 'my-model' }
  b.model.replace({ bots: b.bots, rooms: b.rooms })
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  fireEvent.click(screen.getByRole('button', { name: 'Model' }))
  await screen.findByRole('alert')
  expect(screen.getByText('my-model · custom')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await screen.findByText('No models discovered. Use the DSH default or enter a model below.')
  expect(screen.getByText('my-model · custom')).toBeTruthy()
  expect(catalog).toHaveBeenCalledTimes(2)
})

it('does not attach a late upload to a different chat after navigation', async () => {
  const unused = vi.fn(async () => undefined)
  let finish!: (value: unknown) => void
  const upload = vi.fn(() => new Promise(resolve => { finish = resolve }))
  const capabilities = { catalog: async () => ({ providers: [], tools: [] }), openDirect: unused, history: unused, exportChat: unused, lifecycle: unused, configureBudget: unused,
    upload, decideApproval: unused, saveSchedule: unused, deleteSchedule: unused, failures: unused, resolveFailure: unused } as unknown as CapabilityFace
  const b = await bench({ capabilities })
  fireEvent.change(screen.getByLabelText(en.attach, { selector: 'input' }), { target: { files: [new File(['hello'], 'private-notes.txt', { type: 'text/plain' })] } })
  await waitFor(() => expect(upload).toHaveBeenCalledOnce())
  const roster = screen.getByRole('complementary', { name: en.chats })
  fireEvent.click(within(roster).getByRole('button', { name: /Nova\s*@nova/ }))
  finish({ kind: 'file', attachment: { attachmentId: 'sha256:test', name: 'private-notes.txt', bytes: 5, mediaType: 'text/plain' } })
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Message' }).hasAttribute('disabled')).toBe(false))
  expect(screen.queryByRole('button', { name: /private-notes/ })).toBeNull()
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'another chat' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(b.face.send).toHaveBeenCalledWith({ roomId: 'dm-nova', text: 'another chat' }))
})

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

it('labels external speakers and keeps external private chats read-only while retaining execution access', async () => {
  const { model, room, bots, face } = await bench()
  model.replace({ bots, rooms: [{ ...room, kind: 'dm', members: room.members.slice(0, 1), external: { provider: 'infoflow', accountId: 'app', kind: 'private', id: 'alice' },
    messages: room.messages.map(message => message.botId ? message : { ...message, external: { id: 'wire-1', sender: { id: 'alice', name: 'Alice' } } }) }] })
  await waitFor(() => { expect(screen.getByRole('article', { name: 'Alice (alice)' })).toBeTruthy() })
  expect(screen.getByText(en.externalReadOnly)).toBeTruthy()
  expect(screen.queryByRole('textbox', { name: en.message })).toBeNull()
  expect(screen.queryByRole('button', { name: en.settings })).toBeNull()
  expect(screen.queryByRole('button', { name: en.reply })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: en.execution }))
  expect(face.openSession).toHaveBeenCalledWith('sage-group')
})

it('lets external groups chat in DSH with a not-synced notice, and marks local messages', async () => {
  const { model, room, bots, face } = await bench()
  for (const provider of ['infoflow', 'feishu'] as const) {
    model.replace({ bots, rooms: [{ ...room, title: provider, external: { provider, accountId: 'group:123', kind: 'group', id: '123' },
      messages: [{ ...room.messages[0]!, external: { id: 'wire-1', sender: { id: 'alice', name: 'Alice' } } },
        { ...room.messages[1]!, id: 'local' as ChatMessageId, text: 'Local answer', localOnly: true }] }] })
    const hint = en[provider === 'feishu' ? 'fsLocalHint' : 'ifLocalHint']
    await waitFor(() => { expect(screen.getByRole('note').textContent).toBe(hint) })
    expect(within(screen.getByRole('article', { name: 'Sage' })).getByText(en.localOnly)).toBeTruthy()
    expect(within(screen.getByRole('article', { name: 'Alice (alice)' })).queryByText(en.localOnly)).toBeNull()
    expect(screen.queryByRole('button', { name: en.settings })).toBeNull()
  }
  const input = screen.getByRole('textbox', { name: en.message })
  fireEvent.change(input, { target: { value: '@nova local only' } })
  fireEvent.click(screen.getByRole('button', { name: en.send }))
  await waitFor(() => { expect(face.send).toHaveBeenCalledWith({ roomId: 'studio', text: '@nova local only' }) })
})

it('edits a Bot identity from chat info without changing its handle or preset', async () => {
  const updateBot = vi.fn(async (request: { id: BotId; name: string; instructions: string }) => ({ ...request, preset: 'standard' }))
  await bench({ updateBot })
  fireEvent.click(screen.getByRole('button', { name: en.chatInfo }))
  const info = screen.getByRole('dialog', { name: en.chatInfo })
  const nova = within(info).getByText('Review assumptions.').closest('section')!
  fireEvent.click(within(nova).getByRole('button', { name: en.editBot }))
  const dialog = await screen.findByRole('dialog', { name: en.editBot })
  const handle = within(dialog).getByRole<HTMLInputElement>('textbox', { name: en.handle })
  expect(handle.value).toBe('nova')
  expect(handle.disabled).toBe(true)
  fireEvent.change(within(dialog).getByRole('textbox', { name: en.name }), { target: { value: 'Nova 2' } })
  fireEvent.change(within(dialog).getByRole('textbox', { name: en.instructions }), { target: { value: 'Challenge plans.' } })
  fireEvent.change(within(dialog).getByRole('textbox', { name: en.botCapabilities }), { target: { value: 'Review product plans' } })
  fireEvent.click(within(dialog).getByRole('button', { name: en.save }))
  await waitFor(() => { expect(updateBot).toHaveBeenCalledWith({ id: 'nova', name: 'Nova 2', instructions: 'Challenge plans.', capabilities: 'Review product plans' }) })
  await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
})

it('hides InfoFlow and its group option by default, and remembers explicit visibility across panel navigation', async () => {
  const infoflow = { snapshot: vi.fn(async () => ({ available: false, bindings: [], groups: [] })),
    save: vi.fn(), verify: vi.fn(), toggle: vi.fn(), testMessage: vi.fn(), createGroup: vi.fn(), resumeGroup: vi.fn(), attachGroup: vi.fn() }
  const { face } = await bench({ infoflow })
  fireEvent.click(screen.getByRole('button', { name: en.newGroup }))
  expect(screen.queryByLabelText(en.ifCreateGroup)).toBeNull()
  fireEvent.click(within(screen.getByRole('dialog')).getByText(en.cancel, { exact: true }))
  fireEvent.click(screen.getByRole('button', { name: en.imTitle }))
  expect(screen.queryByRole('tab', { name: en.infoflow })).toBeNull()
  expect(infoflow.snapshot).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText(en.imAdvanced))
  fireEvent.click(screen.getByLabelText(en.imShowInfoflow))
  await waitFor(() => expect(screen.getByRole('tab', { name: en.infoflow })).toBeTruthy())
  expect(face.setInfoflowVisible).toHaveBeenCalledWith(true)
  fireEvent.click(screen.getByRole('tab', { name: en.infoflow }))
  await screen.findByText(en.ifUnavailable)
  fireEvent.click(screen.getByRole('button', { name: en.ifBack }))
  fireEvent.click(screen.getByRole('button', { name: en.newGroup }))
  expect((screen.getByLabelText(en.ifCreateGroup) as HTMLInputElement).checked).toBe(false)
  fireEvent.click(within(screen.getByRole('dialog')).getByText(en.cancel, { exact: true }))
  fireEvent.click(screen.getByRole('button', { name: en.imTitle }))
  fireEvent.click(screen.getByRole('tab', { name: en.infoflow }))
  fireEvent.click(screen.getByText(en.imAdvanced))
  fireEvent.click(screen.getByLabelText(en.imShowInfoflow))
  await waitFor(() => expect(screen.queryByRole('tab', { name: en.infoflow })).toBeNull())
  expect(screen.getByRole('tabpanel', { name: en.feishu })).toBeTruthy()
  expect(infoflow.toggle).not.toHaveBeenCalled()
  expect(infoflow.createGroup).not.toHaveBeenCalled()
})

it('keeps InfoFlow visible when saving the visibility preference fails', async () => {
  await bench({ setInfoflowVisible: vi.fn(async () => { throw new Error('Cannot save preference') }) }, true)
  fireEvent.click(screen.getByRole('button', { name: en.imTitle }))
  fireEvent.click(screen.getByText(en.imAdvanced))
  fireEvent.click(screen.getByLabelText(en.imShowInfoflow))
  expect((await screen.findByRole('alert')).textContent).toContain('Cannot save preference')
  expect((screen.getByLabelText(en.imShowInfoflow) as HTMLInputElement).checked).toBe(true)
  expect(screen.getByRole('tab', { name: en.infoflow })).toBeTruthy()
})

it('configures each Bot through the InfoFlow page and never displays stored secrets', async () => {
  const saved = { botId: 'sage' as BotId, agentId: '11', robotId: '111', robotName: 'Sage robot', enabled: false,
    status: 'disabled' as const, error: null, credentialsConfigured: true, allowUsers: ['alice'], allowGroups: [], admins: ['alice'] }
  const infoflow = { snapshot: vi.fn(async () => ({ available: true, bindings: [saved], groups: [] })),
    save: vi.fn(async () => saved), verify: vi.fn(async () => saved), toggle: vi.fn(async () => saved), testMessage: vi.fn(),
    createGroup: vi.fn(), resumeGroup: vi.fn(), attachGroup: vi.fn() }
  await bench({ infoflow }, true)
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
  const infoflow = { snapshot: vi.fn(async () => ({ available: true, bindings: [], groups: [], groupInviteAllowlist: ['alice', 'bob', 'carol'] })), save: vi.fn(), verify: vi.fn(), toggle: vi.fn(), testMessage: vi.fn(), createGroup: vi.fn(), resumeGroup: vi.fn(), attachGroup: vi.fn() }
  const f = await bench({ infoflow }, true); infoflow.createGroup.mockResolvedValue(f.room)
  fireEvent.click(screen.getByRole('button', { name: 'New group' }))
  const option = screen.getByLabelText('Also create an InfoFlow group')
  expect((option as HTMLInputElement).checked).toBe(false)
  fireEvent.click(option)
  const owner = await screen.findByLabelText(en.ifGroupOwner)
  expect((owner as HTMLSelectElement).value).toBe('')
  expect((screen.getByRole('button', { name: en.ifCreateAndInvite }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('Group name'), { target: { value: 'Launch' } })
  fireEvent.change(owner, { target: { value: 'alice' } })
  const humans = screen.getByRole('group', { name: en.ifHumanMembers })
  expect((within(humans).getByLabelText('bob') as HTMLInputElement).checked).toBe(false)
  fireEvent.click(within(humans).getByLabelText('bob')); fireEvent.click(within(humans).getByLabelText('carol'))
  expect(screen.getByText(`${en.ifInviteSummary} alice、bob、carol`)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en.ifCreateAndInvite }))
  await waitFor(() => expect(infoflow.createGroup).toHaveBeenCalledWith(expect.objectContaining({ title: 'Launch', owner: 'alice', members: ['bob', 'carol'], botIds: ['sage', 'nova'], defaultBot: 'sage', requestId: expect.any(String) })))
})

it.each([undefined, []])('blocks InfoFlow group creation without an explicit invitation allowlist (%j)', async groupInviteAllowlist => {
  const infoflow = { snapshot: vi.fn(async () => ({ available: true, bindings: [], groups: [], ...(groupInviteAllowlist ? { groupInviteAllowlist } : {}) })), save: vi.fn(), verify: vi.fn(), toggle: vi.fn(), testMessage: vi.fn(), createGroup: vi.fn(), resumeGroup: vi.fn(), attachGroup: vi.fn() }
  await bench({ infoflow }, true)
  fireEvent.click(screen.getByRole('button', { name: en.newGroup })); fireEvent.click(screen.getByLabelText(en.ifCreateGroup))
  await screen.findByText(en.ifInvitePolicyEmpty)
  expect(screen.queryByLabelText(en.ifGroupOwner)).toBeNull()
  const create = screen.getByRole('button', { name: en.ifCreateAndInvite })
  expect((create as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(create)
  expect(infoflow.createGroup).not.toHaveBeenCalled()
})

it('saves and lists invitation policy independently without inviting people or changing a robot binding', async () => {
  let groupInviteAllowlist: string[] = []
  const infoflow = { snapshot: vi.fn(async () => ({ available: true, bindings: [], groups: [], groupInviteAllowlist })),
    saveGroupInviteAllowlist: vi.fn(async (users: string[]) => { groupInviteAllowlist = users; return users }),
    save: vi.fn(), verify: vi.fn(), toggle: vi.fn(), testMessage: vi.fn(), createGroup: vi.fn(), resumeGroup: vi.fn(), attachGroup: vi.fn() }
  await bench({ infoflow }, true)
  fireEvent.click(screen.getByRole('button', { name: en.imTitle })); fireEvent.click(screen.getByRole('tab', { name: en.infoflow }))
  fireEvent.click(await screen.findByRole('button', { name: en.ifInvitePolicyEdit }))
  const policy = within(screen.getByRole('region', { name: en.ifInvitePolicy }))
  fireEvent.change(policy.getByLabelText(en.ifInvitePolicyAccounts), { target: { value: 'alice, bob' } })
  fireEvent.click(policy.getByRole('button', { name: en.save }))
  await waitFor(() => expect(infoflow.saveGroupInviteAllowlist).toHaveBeenCalledWith(['alice', 'bob']))
  await waitFor(() => expect(policy.queryByLabelText(en.ifInvitePolicyAccounts)).toBeNull())
  expect(policy.getByText('alice')).toBeTruthy(); expect(policy.getByText('bob')).toBeTruthy()
  expect(infoflow.save).not.toHaveBeenCalled(); expect(infoflow.createGroup).not.toHaveBeenCalled(); expect(infoflow.testMessage).not.toHaveBeenCalled()
})

it('opens one IM panel with both platforms and creates a Feishu robot only for the selected Bot', async () => {
  let registrations: import('../src/feishu/types.ts').FeishuRegistration[] = []
  const feishu = { createGroup: vi.fn(), resumeGroup: vi.fn(), snapshot: vi.fn(async () => ({ available: true, bindings: [], registrations, groups: [] })), save: vi.fn(), verify: vi.fn(), toggle: vi.fn(), authorize: vi.fn(), cancel: vi.fn(),
    register: vi.fn(async (botId: BotId) => { const item = { botId, attemptId: 'attempt', status: 'waiting' as const, url: 'https://accounts.feishu.cn/fixture', qrDataUrl: 'data:image/png;base64,fixture', expiresAt: Date.now() + 600000, message: null }; registrations = [item]; return item }) }
  await bench({ feishu })
  expect(screen.queryByRole('button', { name: en.ifTitle })).toBeNull()
  expect(screen.queryByRole('button', { name: en.fsTitle })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: en.imTitle }))
  await screen.findByRole('button', { name: en.fsCreate })
  expect(screen.getByRole('heading', { name: en.imTitle })).toBeTruthy()
  expect(screen.getAllByRole('tab')).toHaveLength(1)
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
    save: vi.fn(async () => { saved = true; return binding }), verify: vi.fn(), toggle: vi.fn(), authorize: vi.fn(), cancel: vi.fn(), register: vi.fn() }
  await bench({ feishu }, true); fireEvent.click(screen.getByRole('button', { name: en.imTitle }))
  fireEvent.click(await screen.findByRole('button', { name: en.fsManual }))
  fireEvent.change(screen.getByLabelText('App ID'), { target: { value: 'cli_sage' } })
  fireEvent.change(screen.getByLabelText('App Secret'), { target: { value: 'private-secret' } })
  fireEvent.change(screen.getByLabelText(en.fsAllowUsers), { target: { value: 'ou_owner' } })
  expect((screen.getByRole('checkbox', { name: en.ifAllGroups }) as HTMLInputElement).checked).toBe(false)
  fireEvent.click(screen.getByRole('checkbox', { name: en.ifAllGroups }))
  fireEvent.keyDown(screen.getByRole('tab', { name: en.feishu }), { key: 'ArrowRight' })
  expect(screen.getByRole('tab', { name: en.infoflow }).getAttribute('aria-selected')).toBe('true')
  expect(screen.getByRole('tabpanel', { name: en.infoflow }).textContent).toContain(en.ifUnavailable)
  fireEvent.keyDown(screen.getByRole('tab', { name: en.infoflow }), { key: 'ArrowLeft' })
  expect(screen.getByRole('tab', { name: en.feishu }).getAttribute('aria-selected')).toBe('true')
  expect((screen.getByLabelText('App Secret') as HTMLInputElement).value).toBe('private-secret')
  expect((screen.getByLabelText('App ID') as HTMLInputElement).value).toBe('cli_sage')
  expect(feishu.save).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: en.fsBindAuthorize }))
  await waitFor(() => expect(feishu.save).toHaveBeenCalledWith({ botId: 'sage', appId: 'cli_sage', appSecret: 'private-secret', brand: 'feishu', allowUsers: ['ou_owner'], allowGroups: [], allowAllGroups: true, admins: [] }))
  await waitFor(() => expect((screen.getByLabelText('App Secret') as HTMLInputElement).value).toBe(''))
  expect(feishu.authorize).toHaveBeenCalledWith('sage')
  expect(feishu.register).not.toHaveBeenCalled()
})

it('shows an app-specific permission warning and clears it after verification recovers', async () => {
  const state: FeishuState = { available: true, registrations: [], groups: [], bindings: [{ botId: 'sage' as BotId, appId: 'cli_sage', botOpenId: 'ou_bot', robotName: 'Sage robot', brand: 'feishu', enabled: true,
    status: 'connected', error: null, credentialsConfigured: true, allowUsers: ['ou_owner'], allowGroups: [], admins: ['ou_owner'], groupNameStatus: 'permission-required' }] }
  const feishu = { createGroup: vi.fn(), resumeGroup: vi.fn(), snapshot: vi.fn(async () => structuredClone(state)), save: vi.fn(), verify: vi.fn(), toggle: vi.fn(), authorize: vi.fn(), cancel: vi.fn(), register: vi.fn() }
  await bench({ feishu }); fireEvent.click(screen.getByRole('button', { name: en.imTitle }))
  const warning = await screen.findByRole('alert')
  expect(warning.textContent).toContain(en.fsGroupNamePermissionHelp)
  expect(screen.getByRole('link', { name: en.fsPermissionConsole }).getAttribute('href')).toBe('https://open.feishu.cn/app/cli_sage/auth')
  expect(screen.getByText(en.fsConnected)).toBeTruthy()
  state.bindings[0]!.groupNameStatus = 'available'
  fireEvent.click(screen.getByRole('button', { name: en.ifVerify }))
  await screen.findByText(en.fsGroupNameAvailable)
  expect(screen.queryByRole('alert')).toBeNull()
  state.bindings[0]!.groupNameStatus = 'unavailable'
  fireEvent.click(screen.getByRole('button', { name: en.ifVerify }))
  await screen.findByText(en.fsGroupNameRetryHelp)
  expect(screen.queryByRole('alert')).toBeNull()
  expect(feishu.save).not.toHaveBeenCalled(); expect(feishu.register).not.toHaveBeenCalled()
})

it('creates a Feishu group from the selected bot without requiring a manually copied Chat ID', async () => {
  const binding = { botId: 'sage' as BotId, appId: 'cli_sage', botOpenId: 'ou_bot', robotName: 'Sage robot', brand: 'feishu' as const, enabled: true,
    status: 'connected' as const, error: null, credentialsConfigured: true, allowUsers: ['ou_owner'], allowGroups: [], admins: ['ou_owner'] }
  const feishu = { createGroup: vi.fn(), resumeGroup: vi.fn(), snapshot: vi.fn(async () => ({ available: true, bindings: [binding], registrations: [], groups: [] })), save: vi.fn(), verify: vi.fn(), toggle: vi.fn(), authorize: vi.fn(), cancel: vi.fn(), register: vi.fn() }
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
  const feishu = { createGroup: vi.fn(), resumeGroup: vi.fn(), snapshot: vi.fn(async () => state), save: vi.fn(), verify: vi.fn(), toggle: vi.fn(), authorize: vi.fn(), cancel: vi.fn(), register: vi.fn() }
  const f = await bench({ feishu })
  feishu.createGroup.mockImplementationOnce(async request => {
    state.groups.push({ ...request, owner: 'ou_owner', createdAt: 1, chatId: null, roomId: null, status: 'failed', error: 'Missing im:chat:create' })
    throw new Error('Missing im:chat:create')
  }).mockResolvedValueOnce(f.room)
  fireEvent.click(screen.getByRole('button', { name: en.newGroup }))
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
  }), save: vi.fn(), verify: vi.fn(), toggle: vi.fn(), authorize: vi.fn(), cancel: vi.fn(), register: vi.fn() }
  const f = await bench({ feishu })
  feishu.createGroup.mockImplementationOnce(async request => {
    submitted = true
    state.groups.push({ ...request, owner: 'ou_owner', createdAt: 1, chatId: outcome === 'linking' ? 'oc_created' : null, roomId: null, status: outcome === 'linking' ? 'linking' : 'uncertain', error: 'Original creation error' })
    throw new Error('Original creation error')
  }).mockResolvedValueOnce(f.room)
  fireEvent.click(screen.getByRole('button', { name: en.newGroup }))
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
  const feishu = { createGroup: vi.fn(), resumeGroup: vi.fn(), snapshot: vi.fn(async () => state), save: vi.fn(), verify: vi.fn(), toggle: vi.fn(), authorize: vi.fn(), cancel: vi.fn(), register: vi.fn() }
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
    save: vi.fn(async () => { bindings = [saved]; return saved }), verify: vi.fn(), toggle: vi.fn(), testMessage: vi.fn(async () => {}), createGroup: vi.fn(), resumeGroup: vi.fn(), attachGroup: vi.fn() }
  await bench({ infoflow }, true); fireEvent.click(screen.getByRole('button', { name: en.imTitle }))
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

it('renders inline questions and submits selected options with free text', async () => {
  const answerQuestion = vi.fn(async () => {})
  const capabilities = { answerQuestion } as unknown as CapabilityFace
  const b = await bench({ capabilities })
  b.room.messages[1]!.status = 'running'
  b.room.messages[1]!.progress = { phase: 'Answer required', tools: [], question: { id: 'question', questions: [{ id: 'q', question: 'Which approach?', options: [{ label: 'Small change' }, { label: 'Full rewrite' }] }] } }
  b.model.replace({ bots: b.bots, rooms: b.rooms })
  fireEvent.click(await screen.findByRole('radio', { name: 'Small change' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Your answer / additional details' }), { target: { value: 'Keep the API stable' } })
  fireEvent.click(screen.getByRole('button', { name: 'Submit answers' }))
  await waitFor(() => expect(answerQuestion).toHaveBeenCalledWith({ roomId: b.room.id, id: 'question', answer: { answers: [{ id: 'q', selected: ['Small change'], custom: 'Keep the API stable' }] } }))
})

it('saves a weekly calendar rule with an explicit zone and opens dedicated run history', async () => {
  const saveSchedule = vi.fn(async () => ({})), scheduleRuns = vi.fn(async () => [{ messageId: 'run', time: 1, status: 'complete', replies: [{ botId: 'alpha', status: 'complete', text: 'Scheduled result', error: null }] }])
  const capabilities = { saveSchedule, scheduleRuns, catalog: async () => ({ providers: [], tools: [] }) } as unknown as CapabilityFace
  const b = await bench({ capabilities })
  b.model.replace({ bots: b.bots, rooms: b.rooms, schedules: [{ id: 'scheduled', roomId: b.room.id, name: 'Existing', text: 'Check', targets: [b.room.defaultBot], enabled: false, nextAt: 1, intervalMinutes: 0, allowDelegation: false, notify: false }] })
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  fireEvent.click(screen.getByRole('button', { name: 'Schedules' }))
  fireEvent.click(screen.getByRole('button', { name: 'Run history' }))
  expect(await screen.findByText('Scheduled result')).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: 'Add schedule' }))
  fireEvent.change(screen.getByRole('combobox', { name: 'Repeat' }), { target: { value: 'week' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Time zone' }), { target: { value: 'America/New_York' } })
  fireEvent.change(screen.getByLabelText('Local time'), { target: { value: '10:30' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Task name' }), { target: { value: 'Weekday check' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Prompt' }), { target: { value: 'Check progress' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save and enable' }))
  await waitFor(() => expect(saveSchedule).toHaveBeenCalledWith(expect.objectContaining({ calendar: { timeZone: 'America/New_York', time: '10:30', weekdays: [1, 2, 3, 4, 5] }, notify: false })))
})

it('requires explicit capability and credential grants and never refills a saved secret value', async () => {
  const accessCatalog = vi.fn(async () => ({ capabilities: [], credentials: [{ name: 'API_TOKEN', revision: 2, description: 'Private API', botIds: ['sage'], shellBotIds: [], configured: true }] }))
  const saveCapability = vi.fn(async () => ({ name: 'guide', revision: 1 })), saveBotCredential = vi.fn(async () => {})
  await bench({ capabilities: { catalog: async () => ({ providers: [], tools: [] }), accessCatalog, saveCapability, saveBotCredential } as unknown as CapabilityFace })
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  fireEvent.click(screen.getByText('More settings', { exact: true }))
  fireEvent.click(screen.getByRole('button', { name: 'Tools & accounts' }))
  fireEvent.click(screen.getByRole('button', { name: 'Add skill' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'guide' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Skill content' }), { target: { value: 'Review the release checklist.' } })
  expect((screen.getByRole('checkbox', { name: 'Sage' }) as HTMLInputElement).checked).toBe(false)
  fireEvent.click(screen.getByRole('checkbox', { name: 'Sage' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save grants' }))
  await waitFor(() => expect(saveCapability).toHaveBeenCalledWith(expect.objectContaining({ name: 'guide', botIds: ['sage'], kind: 'skill' })))
  fireEvent.click(screen.getByRole('button', { name: 'Account keys' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Edit & grant' }))
  expect((screen.getByLabelText('New value (blank keeps saved value)') as HTMLInputElement).value).toBe('')
  fireEvent.click(screen.getByRole('button', { name: 'Save grants' }))
  await waitFor(() => expect(saveBotCredential).toHaveBeenCalledWith(expect.objectContaining({ name: 'API_TOKEN', revision: 2, botIds: ['sage'], shellBotIds: [], value: '' })))
})


it('opens a quiet settings home without fetching technical catalogs, and disables chat actions without a chat', async () => {
  const catalog = vi.fn(async () => ({ providers: [], tools: [] }))
  const b = await bench({ capabilities: { catalog } as unknown as CapabilityFace })
  b.model.replace({ bots: [], rooms: [] })
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  expect(screen.getByRole('heading', { name: 'What would you like to change?' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Tools & accounts' }).closest('details')!.open).toBe(false)
  expect(within(screen.getByRole('dialog')).queryByRole('textbox')).toBeNull()
  expect((screen.getByRole('button', { name: 'Chat history' }) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('button', { name: 'Schedules' }) as HTMLButtonElement).disabled).toBe(true)
  expect(catalog).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('More settings', { exact: true }))
  expect(screen.getByRole('button', { name: 'Tools & accounts' })).toBeTruthy()
})

it('keeps folded permissions and prices intact when saving a model change', async () => {
  const updateBot = vi.fn<PanelFace['updateBot']>(async request => ({ id: request.id, name: request.name, instructions: request.instructions, preset: 'standard' }))
  const b = await bench({ updateBot, capabilities: { catalog: async () => ({ providers: [], tools: [] }) } as unknown as CapabilityFace })
  b.bots[0]!.policy = { provider: 'configured', model: 'old', toolMode: 'none', fileMode: 'read-only', tools: [], inputPrice: 2, outputPrice: 8 }
  b.model.replace({ bots: b.bots, rooms: b.rooms })
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  fireEvent.click(screen.getByRole('button', { name: 'Model' }))
  expect(screen.getByRole('combobox', { name: 'Tool permissions' }).closest('details')!.open).toBe(false)
  fireEvent.change(screen.getByRole('textbox', { name: 'Model' }), { target: { value: 'new' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save model settings' }))
  await waitFor(() => expect(updateBot).toHaveBeenCalledWith(expect.objectContaining({ id: 'sage', policy: expect.objectContaining({ model: 'new', toolMode: 'none', fileMode: 'read-only', inputPrice: 2, outputPrice: 8 }) })))
  expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Saved. The next conversation will use these settings.')
})

it('creates a one-time schedule using local time without silently enabling repeats or notifications', async () => {
  const saveSchedule = vi.fn(async () => ({}))
  await bench({ capabilities: { saveSchedule } as unknown as CapabilityFace })
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  fireEvent.click(screen.getByRole('button', { name: 'Schedules' }))
  expect(screen.queryByRole('textbox', { name: 'Prompt' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Add schedule' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Task name' }), { target: { value: 'Review' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Prompt' }), { target: { value: 'Review progress' } })
  fireEvent.change(screen.getByLabelText('Run time (your local time)'), { target: { value: '2030-03-12T09:30' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save and enable' }))
  await waitFor(() => expect(saveSchedule).toHaveBeenCalledWith(expect.objectContaining({ nextAt: new Date('2030-03-12T09:30').getTime(), intervalMinutes: 0, notify: false, allowDelegation: false })))
})

it('bundles all connector permissions including images and files in the selected binding and requests existing-app consent without creating a bot', async () => {
  const binding = { botId: 'sage' as BotId, appId: 'cli_sage', botOpenId: 'ou_bot', robotName: 'Sage robot', brand: 'lark' as const,
    enabled: false, status: 'disabled' as const, error: null, credentialsConfigured: true, allowUsers: [], allowGroups: [], admins: [] }
  const state: FeishuState = { available: true, bindings: [binding], registrations: [], groups: [] }
  const feishu = { createGroup: vi.fn(), resumeGroup: vi.fn(), snapshot: vi.fn(async () => structuredClone(state)), save: vi.fn(), verify: vi.fn(), toggle: vi.fn(), cancel: vi.fn(), register: vi.fn(),
    authorize: vi.fn(async (botId: BotId) => {
      const registration = { botId, attemptId: 'permission-attempt', purpose: 'permissions' as const, status: 'waiting' as const,
        url: 'https://accounts.larksuite.com/fixture', qrDataUrl: 'data:image/png;base64,fixture', expiresAt: Date.now() + 600000, message: null }
      state.registrations = [registration]; return registration
    }) }
  await bench({ feishu }); fireEvent.click(screen.getByRole('button', { name: en.imTitle }))
  await screen.findByText(en.fsBindingPermissions)
  expect(screen.getByText(en.fsReadGroupPermission)).toBeTruthy()
  expect(screen.getByText(en.fsCreateGroupPermission)).toBeTruthy()
  expect(screen.getByText(en.fsMessagingPermission)).toBeTruthy()
  expect(screen.getByText(en.fsMediaPermission)).toBeTruthy()
  expect(screen.getByText(en.fsMembershipPermission)).toBeTruthy()
  fireEvent.click(screen.getByText(en.fsPermissionFallback))
  const config = screen.getByRole('textbox', { name: en.fsPermissionConfig }) as HTMLTextAreaElement
  expect(config.readOnly).toBe(true)
  expect(JSON.parse(config.value)).toEqual({ scopes: { tenant: ['im:message.p2p_msg:readonly', 'im:message.group_at_msg:readonly', 'im:message:send_as_bot', 'im:message:readonly', 'im:resource', 'im:chat:read', 'im:chat:create', 'im:chat.members:bot_access'] } })
  expect(config.value).not.toContain('secret')
  const previousClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard'), writeText = vi.fn(async (_value: string) => {})
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  try {
    fireEvent.click(screen.getByRole('button', { name: en.fsCopyPermissions }))
    await screen.findByText(en.copied)
    expect(writeText).toHaveBeenCalledWith(config.value)
    writeText.mockRejectedValueOnce(new Error('clipboard denied'))
    fireEvent.click(screen.getByRole('button', { name: en.fsCopyPermissions }))
    await screen.findByText(en.fsPermissionCopyFailed)
    expect(config.value).toContain('im:resource')
  } finally {
    if (previousClipboard) Object.defineProperty(navigator, 'clipboard', previousClipboard)
    else Reflect.deleteProperty(navigator, 'clipboard')
  }
  expect(screen.getByRole('link', { name: en.fsPermissionConsole }).getAttribute('href')).toBe('https://open.larksuite.com/app/cli_sage/auth')
  fireEvent.click(screen.getByRole('button', { name: en.fsAuthorizePermissions }))
  await screen.findByRole('img', { name: en.fsPermissionQrAlt })
  expect(feishu.authorize).toHaveBeenCalledWith('sage')
  expect(feishu.save).not.toHaveBeenCalled(); expect(feishu.register).not.toHaveBeenCalled()
  expect((screen.getByRole('button', { name: en.fsAuthorizePermissions }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: en.fsCancel }))
  await waitFor(() => expect(feishu.cancel).toHaveBeenCalledWith('permission-attempt'))
})
