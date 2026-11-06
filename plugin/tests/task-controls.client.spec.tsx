// @vitest-environment jsdom
/** Task controls, structured permission choices, and safe operator reconciliation. */
import type {} from '../src/client/index.ts'
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
import type { CapabilityFace } from '../src/client/capability-face.ts'
import { TaskInspector } from '../src/client/TaskInspector.tsx'
import type { TaskInspection } from '../src/task-control-types.ts'
import type { ToolOperation } from '../src/task-operation-types.ts'

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


function inspection(operations: ToolOperation[] = []): TaskInspection {
  return { task: { id: 'question', rootMessageId: 'question', roomId: 'studio', status: 'awaiting_verification', createdAt: 1000, updatedAt: 2000,
    runs: [{ id: 'answer', botId: 'sage', status: 'complete', createdAt: 1000, updatedAt: 2000, resultIds: [], awaiting: [] }],
    events: [{ sequence: 1, time: 1000, kind: 'created', status: 'queued' }], nextSequence: 2, droppedEvents: 0 }, operations }
}
const request = { roomId: 'studio' as RoomId, messageId: 'answer' as ChatMessageId }
function expand() { const summary = screen.getByText('Task & recovery'); const details = summary.closest('details')!; details.open = true; fireEvent(details, new Event('toggle')) }

it('keeps policy defaults unchanged and explicitly submits narrower request permissions', async () => {
  const b = await bench({ capabilities: { taskView: async () => inspection() } as unknown as CapabilityFace })
  const input = screen.getByRole('textbox', { name: 'Message' })
  fireEvent.change(input, { target: { value: 'Default scope' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(b.face.send).toHaveBeenLastCalledWith({ roomId: 'studio', text: 'Default scope' }))
  fireEvent.change(screen.getByRole('combobox', { name: 'Request restrictions' }), { target: { value: 'none' } })
  fireEvent.change(input, { target: { value: 'Think only' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(b.face.send).toHaveBeenLastCalledWith({ roomId: 'studio', text: 'Think only', taskPolicy: { toolMode: 'none' } }))
  fireEvent.change(screen.getByRole('combobox', { name: 'Request restrictions' }), { target: { value: 'read-only' } })
  expect(screen.getByText('Native files/shell only; network/MCP writes and independent external agents are not restricted.')).toBeTruthy()
  fireEvent.change(input, { target: { value: 'Read workspace' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(b.face.send).toHaveBeenLastCalledWith({ roomId: 'studio', text: 'Read workspace', taskPolicy: { fileMode: 'read-only' } }))
  fireEvent.click(screen.getByRole('button', { name: 'Sage @sage' }))
  expect((screen.getByRole('combobox', { name: 'Request restrictions' }) as HTMLSelectElement).value).toBe('inherit')
  fireEvent.click(screen.getByRole('button', { name: /Design studio/ }))
  expect((screen.getByRole('combobox', { name: 'Request restrictions' }) as HTMLSelectElement).value).toBe('read-only')
})

it('loads task metadata only when expanded and requires checked evidence before manual reconciliation', async () => {
  const operation: ToolOperation = { id: 'operation', roomId: 'studio', messageId: 'answer', callId: 'call-1', name: 'create_pr', status: 'unknown', startedAt: 1000, finishedAt: 2000 }
  const view = inspection([operation]), read = vi.fn(async () => structuredClone(view)), verify = vi.fn(async () => view.task)
  const resolve = vi.fn(async (_request: unknown) => { operation.resolution = { outcome: 'verified_applied', time: 3000 } })
  render(<TaskInspector face={{ taskView: read, verifyTask: verify, resolveTaskOperation: resolve } as unknown as CapabilityFace} request={request} english/>)
  expect(read).not.toHaveBeenCalled()
  expand()
  await screen.findByText('Finished; awaiting verification')
  expect(read).toHaveBeenCalledWith(request)
  expect((screen.getByRole('button', { name: 'Accept checked result' }) as HTMLButtonElement).disabled).toBe(true)
  const receipts = screen.getByText(/Tool operation receipts/).closest('details')!; receipts.open = true
  const confirm = screen.getByRole('button', { name: 'Confirm applied' }) as HTMLButtonElement
  expect(confirm.disabled).toBe(true)
  fireEvent.click(confirm)
  expect(resolve).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('checkbox', { name: 'I checked the actual external state of create_pr (call-1)' }))
  fireEvent.click(confirm)
  await waitFor(() => expect(resolve).toHaveBeenCalledExactlyOnceWith({ roomId: 'studio', messageId: 'answer', callId: 'call-1', resolution: 'verified_applied' }))
  await screen.findByText('User checked: applied')
  fireEvent.click(screen.getByRole('button', { name: 'Accept checked result' }))
  await waitFor(() => expect(verify).toHaveBeenCalledExactlyOnceWith({ roomId: 'studio', taskId: 'question', outcome: 'accepted' }))
})

it('requests whole-task cancellation through the control API without claiming the running tool stopped', async () => {
  const view = inspection(); view.task.status = 'running'; view.task.runs[0]!.status = 'running'
  const stop = vi.fn(async (_request: unknown) => { view.task.cancelRequestedAt = 3000; return view.task })
  render(<TaskInspector face={{ taskView: async () => structuredClone(view), stopTask: stop } as unknown as CapabilityFace} request={request} english/>)
  expand()
  fireEvent.click(await screen.findByRole('button', { name: 'Stop whole task' }))
  await waitFor(() => expect(stop).toHaveBeenCalledExactlyOnceWith({ roomId: 'studio', taskId: 'question' }))
  await screen.findByText('A stop request was recorded. Running tools may not have exited yet; check external effects. New runs can still be stopped.')
  expect((screen.getByRole('button', { name: 'Stop whole task' }) as HTMLButtonElement).disabled).toBe(false)
  expect(screen.getByText('Running', { exact: true })).toBeTruthy()
})

it('allows stopping a new retry even when a prior cancellation remains in task history', async () => {
  const view = inspection(); view.task.status = 'running'; view.task.cancelRequestedAt = 3000
  view.task.runs[0]!.status = 'canceled'
  view.task.runs.push({ id: 'retry-answer', botId: 'sage', status: 'running', createdAt: 4000, updatedAt: 4000,
    retryOf: 'answer', resultIds: [], awaiting: [] })
  const stop = vi.fn(async (_request: unknown) => view.task)
  render(<TaskInspector face={{ taskView: async () => structuredClone(view), stopTask: stop } as unknown as CapabilityFace}
    request={{ ...request, messageId: 'retry-answer' as ChatMessageId }} english/>)
  expand()
  const button = await screen.findByRole('button', { name: 'Stop whole task' }) as HTMLButtonElement
  expect(button.disabled).toBe(false)
  fireEvent.click(button)
  await waitFor(() => expect(stop).toHaveBeenCalledExactlyOnceWith({ roomId: 'studio', taskId: 'question' }))
})

it('ignores late task responses after the inspected room changes', async () => {
  let finish!: (view: TaskInspection) => void
  const first = new Promise<TaskInspection>(resolve => { finish = resolve })
  const next = inspection(); next.task.id = 'new-task'; next.task.roomId = 'second-room'
  const read = vi.fn<NonNullable<CapabilityFace['taskView']>>().mockReturnValueOnce(first).mockResolvedValue(next)
  const face = { taskView: read } as unknown as CapabilityFace
  const component = render(<TaskInspector face={face} request={request} english/>)
  expand(); await waitFor(() => expect(read).toHaveBeenCalledOnce())
  component.rerender(<TaskInspector face={face} request={{ roomId: 'second-room' as RoomId, messageId: 'second-answer' as ChatMessageId }} english/>)
  await screen.findByText('Task ID: new-task')
  finish(inspection())
  await Promise.resolve()
  expect(screen.queryByText('Task ID: question')).toBeNull()
  expect(screen.getByText('Task ID: new-task')).toBeTruthy()
})

function pending<T>() {
  let resolve!: (value: T) => void, reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

it('keeps a failed control request visible and retryable without claiming cancellation succeeded', async () => {
  const view = inspection(); view.task.status = 'running'; view.task.runs[0]!.status = 'running'
  const read = vi.fn(async () => structuredClone(view))
  const stop = vi.fn().mockRejectedValue(new Error('Control-plane persistence failed'))
  render(<TaskInspector face={{ taskView: read, stopTask: stop } as unknown as CapabilityFace} request={request} english/>)
  expand()
  fireEvent.click(await screen.findByRole('button', { name: 'Stop whole task' }))
  expect((await screen.findByRole('alert')).textContent).toContain('Control-plane persistence failed')
  expect(screen.getByText('Running', { exact: true })).toBeTruthy()
  expect(screen.queryByText(/A stop request was recorded/)).toBeNull()
  expect((screen.getByRole('button', { name: 'Stop whole task' }) as HTMLButtonElement).disabled).toBe(false)
  expect(read).toHaveBeenCalledOnce()
})

it.each(['resolve', 'reject'] as const)('ignores a late control %s after switching the inspected task', async outcome => {
  const control = pending<TaskInspection['task']>()
  const first = inspection(); first.task.status = 'running'
  const next = inspection(); next.task.id = 'other-task'; next.task.roomId = 'other-room'
  const read = vi.fn<NonNullable<CapabilityFace['taskView']>>().mockResolvedValueOnce(first).mockResolvedValue(next)
  const stop = vi.fn(() => control.promise)
  const face = { taskView: read, stopTask: stop } as unknown as CapabilityFace
  const component = render(<TaskInspector face={face} request={request} english/>)
  expand()
  fireEvent.click(await screen.findByRole('button', { name: 'Stop whole task' }))
  await waitFor(() => expect(stop).toHaveBeenCalledOnce())
  component.rerender(<TaskInspector face={face} request={{ roomId: 'other-room' as RoomId, messageId: 'other-answer' as ChatMessageId }} english/>)
  await screen.findByText('Task ID: other-task')
  await act(async () => {
    if (outcome === 'resolve') control.resolve(first.task)
    else control.reject(new Error('Old task error must not leak'))
  })
  expect(screen.getByText('Task ID: other-task')).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(read).toHaveBeenCalledTimes(2)
})

it('locks reconciliation controls during an in-flight action and clears operator evidence on task switch', async () => {
  const operation: ToolOperation = { id: 'same-test-id', roomId: 'studio', messageId: 'answer', callId: 'receipt', name: 'write_result', status: 'unknown', startedAt: 1000 }
  const control = pending<void>()
  const next = inspection([{ ...operation, roomId: 'other-room', messageId: 'other-answer' }]); next.task.id = 'other-task'
  const read = vi.fn<NonNullable<CapabilityFace['taskView']>>().mockResolvedValueOnce(inspection([operation])).mockResolvedValue(next)
  const resolve = vi.fn(() => control.promise)
  const face = { taskView: read, resolveTaskOperation: resolve } as unknown as CapabilityFace
  const component = render(<TaskInspector face={face} request={request} english/>)
  expand()
  await screen.findByText('Task ID: question')
  screen.getByText(/Tool operation receipts/).closest('details')!.open = true
  fireEvent.click(screen.getByRole('checkbox'))
  const confirm = screen.getByRole('button', { name: 'Confirm applied' }) as HTMLButtonElement
  fireEvent.click(confirm)
  expect(confirm.disabled).toBe(true)
  fireEvent.click(confirm)
  fireEvent.click(screen.getByRole('button', { name: 'Confirm not applied' }))
  expect(resolve).toHaveBeenCalledOnce()
  component.rerender(<TaskInspector face={face} request={{ roomId: 'other-room' as RoomId, messageId: 'other-answer' as ChatMessageId }} english/>)
  await screen.findByText('Task ID: other-task')
  expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false)
  expect((screen.getByRole('button', { name: 'Confirm applied' }) as HTMLButtonElement).disabled).toBe(true)
  await act(async () => { control.resolve() })
  expect(read).toHaveBeenCalledTimes(2)
})
