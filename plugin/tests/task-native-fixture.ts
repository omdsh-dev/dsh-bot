/** Keyless native-profile driver. Only the model and the external effect are fixtures. */
import assert from 'node:assert/strict'
import { appendFile, readFile, rename, writeFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type {} from '../src/index.ts'
import type { BotState, ChatMessageId, RoomId } from '../src/types.ts'
import type { TaskInspection } from '../src/task-control-types.ts'

export const name = 'bot-mode-task-native-fixture'
export const inject = ['botMode', 'llm', 'agents']
const provider = 'task-native-fixture', toolName = 'task_native_effect'
interface Target { roomId: RoomId; rootId: ChatMessageId; attemptId: ChatMessageId; sessionId: string }
interface Manifest { denied: Target; success: Target; crash: Target & { childId: ChatMessageId } }
interface Effect { callId: string; action: string; sessionId: string }
export interface TaskNativeReport {
  ok: boolean; phase: string; modelCalls: number
  denied?: TaskInspection; success?: TaskInspection; crash?: TaskInspection; error?: string; stack?: string
}
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
async function atomicJson(file: string, value: unknown): Promise<void> {
  await writeFile(`${file}.partial`, JSON.stringify(value), { flush: true })
  await rename(`${file}.partial`, file)
}

export async function apply(ctx: Context): Promise<void> {
  const phase = process.env.TASK_NATIVE_PHASE!, result = process.env.TASK_NATIVE_RESULT!
  const manifestFile = process.env.TASK_NATIVE_MANIFEST!, effectFile = process.env.TASK_NATIVE_EFFECTS!
  const service = ctx.botMode, requests: GenerateOptions[] = []
  let crashToolStalled = false, effectInvocations = 0
  const emittedActions: string[] = []
  const effects = async (): Promise<Effect[]> => (await readFile(effectFile, 'utf8')).trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as Effect)
  const room = (id: RoomId) => {
    const found = service.snapshot().rooms.find(item => item.id === id)
    assert.ok(found, 'The task room must remain available'); return found
  }
  const view = (target: Target) => service.taskView({ roomId: target.roomId, messageId: target.rootId })
  async function until(ready: () => boolean | Promise<boolean>, description: string): Promise<void> {
    const end = Date.now() + 20000
    while (!await ready()) {
      if (Date.now() >= end) throw new Error(`${description}: ${JSON.stringify({ requests: requests.length, rooms: service.snapshot().rooms })}`)
      await pause(20)
    }
  }
  const durable = () => Reflect.get(service, 'domain').global.get() as BotState
  const readManifest = async () => JSON.parse(await readFile(manifestFile, 'utf8')) as Manifest

  class Fixture extends LlmAdapter {
    async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      requests.push(options)
      assert.ok(requests.length <= 16, 'Fixture must not spin an unbounded model/tool loop')
      // Titles are deterministic too; no provider, network service, key, or user config is consulted.
      const content = JSON.stringify(options.messages.findLast(message => message.role === 'user'
        && message.content.some(block => block.type === 'text' && block.text.includes('Public chat messages (JSON data):'))) ?? options.messages.at(-1))
      const action = content.includes('TASK_NATIVE_DENIED') ? 'denied' : content.includes('TASK_NATIVE_CHILD_MUST_NOT_RUN') ? 'child'
        : content.includes('TASK_NATIVE_CRASH') ? 'crash' : content.includes('TASK_NATIVE_SUCCESS') ? 'success' : undefined
      const id = `task-native-${action}`
      const hasResult = options.messages.some(message => message.role === 'tool' && message.toolCallId === id
        || message.content.some(block => { const kind: unknown = Reflect.get(block, 'type'); return kind === 'tool-result' && Reflect.get(block, 'toolCallId') === id }))
      if (!options.purpose && action && !hasResult) {
        emittedActions.push(action)
        const args = JSON.stringify({ action })
        yield { type: 'block-start', index: 0, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: 0, id: ToolCallId(id), name: toolName, argumentsDelta: args }
        yield { type: 'block-end', index: 0, block: { type: 'tool-call', id: ToolCallId(id), name: toolName, arguments: args } }
        yield { type: 'finish', reason: { kind: 'tool-calls' } }; return
      }
      const text = options.purpose === 'session-title' ? 'Native task fixture' : 'TASK_NATIVE_FINISHED'
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'usage', usage: { inputTokens: 3, outputTokens: 2 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter([provider], new Fixture())
  ctx.on('llm/stream', (options, next) => {
    assert.equal(options.provider, provider, 'This fixture must never use a remote model provider')
    return next()
  }, { global: true, prepend: true })
  ctx.on('agent/created', ({ agent }) => {
    agent.ctx.tools.register(defineTool({
      name: toolName, description: 'Append a test effect to a private local oracle, optionally stall before returning.',
      parameters: { action: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args, exec) {
        effectInvocations++
        assert.ok(exec.agent)
        const activeRoom = service.snapshot().rooms.find(item => item.members.some(member => member.sessionId === exec.agent!.session.id))
        assert.ok(activeRoom)
        const attempt = activeRoom.messages.find(message => message.status === 'running' && message.executionSessionId === exec.agent!.session.id)
        assert.ok(attempt)
        const inspection = await service.taskView({ roomId: activeRoom.id, messageId: attempt.id })
        const receipt = inspection.operations.find(operation => operation.callId === exec.callId)
        assert.equal(receipt?.status, 'started', 'The native tool body cannot begin before its durable intent')
        assert.equal(durable().taskOperations?.operations.find(operation => operation.id === receipt?.id)?.status, 'started')
        // Deliberately no deduplication here: replay appends another line and fails the outer oracle.
        await appendFile(effectFile, `${JSON.stringify({ callId: exec.callId, action: args.action, sessionId: exec.agent.session.id })}\n`, { flush: true })
        if (args.action === 'crash') {
          // SIGKILL, not a cooperative cancellation or an exception, ends this invocation.
          await new Promise<void>((_resolve, reject) => {
            if (exec.signal.aborted) reject(exec.signal.reason)
            else {
              exec.signal.addEventListener('abort', () => reject(exec.signal.reason), { once: true })
              crashToolStalled = true
            }
          })
        }
        return 'Local external-effect oracle updated'
      },
    }))
  })

  try {
    assert.ok(['seed', 'resume', 'confirm'].includes(phase))
    if (phase === 'seed') {
      await service.configureKnowledge({ reviewEnabled: false })
      const deniedBot = await service.createBot({ id: 'task-native-denied', name: 'Native denied', instructions: 'The fixture model will attempt a tool despite the immutable deny policy.' })
      const deniedRoom = service.snapshot().rooms.find(item => item.defaultBot === deniedBot.id && item.kind === 'dm')!
      const deniedRoot = await service.send({ roomId: deniedRoom.id, text: 'TASK_NATIVE_DENIED', taskPolicy: { toolMode: 'none' } })
      await until(() => room(deniedRoom.id).messages.some(message => message.replyTo === deniedRoot.id && message.status === 'complete'), 'The native denial did not return a bounded error result to the model')
      const deniedAttempt = room(deniedRoom.id).messages.find(message => message.replyTo === deniedRoot.id && message.botId === deniedBot.id)!
      assert.ok(deniedAttempt.executionSessionId)
      const denied: Target = { roomId: deniedRoom.id, rootId: deniedRoot.id, attemptId: deniedAttempt.id, sessionId: deniedAttempt.executionSessionId }
      assert.deepEqual(emittedActions, ['denied'], 'The real model adapter must attempt exactly one hallucinated tool call')
      assert.equal(effectInvocations, 0, 'The native tool guard must reject before entering the registered tool body')
      assert.deepEqual((await view(denied)).operations, [], 'Denied calls must not enter the dispatch journal')
      assert.equal((await view(denied)).task.status, 'awaiting_verification')
      assert.deepEqual(await effects(), [], 'A denied native call cannot apply the external effect')
      const completedBot = await service.createBot({ id: 'task-native-success', name: 'Native success', instructions: 'Perform only the requested fixture operation.' })
      const completedRoom = service.snapshot().rooms.find(item => item.defaultBot === completedBot.id && item.kind === 'dm')!
      const completedRoot = await service.send({ roomId: completedRoom.id, text: 'TASK_NATIVE_SUCCESS', taskPolicy: { toolMode: 'allow', tools: [toolName] } })
      await until(() => room(completedRoom.id).messages.some(message => message.replyTo === completedRoot.id && message.status === 'complete'), 'Successful native request did not finish')
      const completedAttempt = room(completedRoom.id).messages.find(message => message.replyTo === completedRoot.id && message.botId === completedBot.id)!
      assert.ok(completedAttempt.executionSessionId)
      const success: Target = { roomId: completedRoom.id, rootId: completedRoot.id, attemptId: completedAttempt.id, sessionId: completedAttempt.executionSessionId }
      const completed = await view(success)
      assert.equal(completed.task.status, 'awaiting_verification', 'A native turn end is not business acceptance')
      assert.equal(completed.operations.length, 1); assert.equal(completed.operations[0]!.status, 'returned')
      const beforeVerify = requests.length
      assert.equal((await service.verifyTask({ roomId: success.roomId, taskId: success.rootId, outcome: 'accepted' })).status, 'verified')
      assert.equal(requests.length, beforeVerify, 'Human acceptance cannot invoke the model')

      const owner = await service.createBot({ id: 'task-native-owner', name: 'Native owner', instructions: 'Perform only the requested fixture operation.' })
      const child = await service.createBot({ id: 'task-native-child', name: 'Native child', instructions: 'Must remain unstarted after a crash.' })
      const crashRoom = await service.createGroup({ title: 'Native crash recovery', botIds: [owner.id, child.id], defaultBot: owner.id })
      const crashRoot = await service.send({ roomId: crashRoom.id, targets: [owner.id], text: 'TASK_NATIVE_CRASH', allowDelegation: true,
        taskPolicy: { toolMode: 'allow', tools: [toolName] } })
      await until(() => crashToolStalled, 'Native tool did not reach the post-effect crash window')
      const crashAttempt = room(crashRoom.id).messages.find(message => message.replyTo === crashRoot.id && message.botId === owner.id)!
      assert.ok(crashAttempt.executionSessionId)
      assert.notEqual(ctx.agents.get(crashAttempt.executionSessionId)?.status, 'idle', 'The native call is still executing when SIGKILL is requested')
      const crash: Manifest['crash'] = { roomId: crashRoom.id, rootId: crashRoot.id, attemptId: crashAttempt.id,
        sessionId: crashAttempt.executionSessionId, childId: 'task-native-queued-child' as ChatMessageId }
      // Crash-window setup only: seed an already-reserved descendant through the actual atomic
      // Host change()/native storage path. Its execution, interruption, and recovery are not mocked.
      await Reflect.get(service, 'change').call(service, (state: BotState) => {
        const current = state.rooms.find(item => item.id === crash.roomId)!, parent = current.messages.find(message => message.id === crash.attemptId)!
        parent.awaiting = [crash.childId]
        current.messages.push({ id: crash.childId, botId: child.id, text: '', replyTo: parent.id,
          delegation: { rootId: crash.rootId, task: 'TASK_NATIVE_CHILD_MUST_NOT_RUN' }, status: 'queued', error: null, time: Date.now() })
      })
      const pending = await view(crash)
      assert.equal(pending.operations.length, 1); assert.equal(pending.operations[0]!.status, 'started')
      assert.equal(pending.task.runs.find(run => run.id === crash.attemptId)?.status, 'running')
      assert.equal(pending.task.runs.find(run => run.id === crash.childId)?.status, 'queued')
      assert.equal(durable().rooms.find(item => item.id === crash.roomId)!.messages.find(message => message.id === crash.childId)?.status, 'queued')
      assert.equal(service.tasks({ roomId: success.roomId })[0]?.status, 'verified')
      assert.deepEqual((await effects()).map(effect => effect.action), ['success', 'crash'])
      await atomicJson(manifestFile, { denied, success, crash } satisfies Manifest)
      // The outer runner waits for this report before killing the process while the tool is blocked.
      await atomicJson(result, { ok: true, phase, modelCalls: requests.length, denied: await view(denied), success: await view(success), crash: pending } satisfies TaskNativeReport)
      return
    }

    const { denied, success, crash } = await readManifest()
    const deniedView = await view(denied)
    assert.deepEqual(deniedView.operations, [])
    assert.equal(deniedView.task.status, 'awaiting_verification')
    assert.equal(deniedView.task.runs[0]?.sessionId, denied.sessionId)
    assert.deepEqual(room(denied.roomId).messages.find(message => message.id === denied.rootId)?.taskPolicy, { toolMode: 'none' })
    const completed = await view(success), interrupted = await view(crash)
    assert.equal(completed.task.status, 'verified'); assert.equal(completed.task.verification?.outcome, 'accepted')
    assert.equal(completed.operations.length, 1); assert.equal(completed.operations[0]!.status, 'returned')
    assert.equal(completed.task.runs[0]?.sessionId, success.sessionId)
    assert.equal(interrupted.task.status, 'interrupted')
    assert.equal(interrupted.task.runs.find(run => run.id === crash.attemptId)?.status, 'interrupted')
    assert.equal(interrupted.task.runs.find(run => run.id === crash.childId)?.status, 'canceled')
    assert.equal(interrupted.task.runs.find(run => run.id === crash.attemptId)?.sessionId, crash.sessionId)
    assert.equal(interrupted.operations.length, 1); assert.equal(interrupted.operations[0]!.status, 'unknown')
    assert.equal(room(crash.roomId).messages.find(message => message.id === crash.rootId)?.allowDelegation, false)
    assert.ok(room(crash.roomId).messages.filter(message => message.botId).every(message => message.collaborationCanceled))
    assert.equal(room(crash.roomId).messages.length, 3, 'Recovery must not create a summary callback or retry')
    assert.equal(service.tasks({ roomId: crash.roomId })[0]?.status, 'interrupted')
    assert.equal(service.snapshot().taskLedger, undefined); assert.equal(service.snapshot().taskOperations, undefined)
    assert.equal(requests.length, 0, 'Startup and task inspection cannot invoke a model')
    assert.equal(durable().taskOperations?.operations.find(operation => operation.id === interrupted.operations[0]!.id)?.status, 'unknown')
    if (phase === 'resume') {
      assert.equal(interrupted.operations[0]!.resolution, undefined)
      await assert.rejects(service.verifyTask({ roomId: crash.roomId, taskId: crash.rootId, outcome: 'accepted' }), /[Rr]econcile|uncertain/)
      await assert.rejects(service.retry({ roomId: crash.roomId, messageId: crash.attemptId }), /uncertain|reconcile/)
      await service.resolveTaskOperation({ roomId: crash.roomId, messageId: crash.attemptId,
        callId: interrupted.operations[0]!.callId, resolution: 'verified_applied' })
    }
    const reconciled = await view(crash)
    assert.equal(reconciled.operations[0]!.resolution?.outcome, 'verified_applied')
    assert.equal(reconciled.task.status, 'interrupted', 'Reconciliation is not automatic task acceptance or resume')
    // Allow at least two real scheduler ticks: no queue drain, native resume, or callback may replay.
    await pause(2200)
    assert.equal(requests.length, 0, 'Restart, reads, and manual reconciliation must not dispatch any model work')
    assert.deepEqual((await effects()).map(effect => effect.action), ['success', 'crash'])
    assert.deepEqual(await view(crash), reconciled, 'Quarantined descendants remain terminal after reconciliation')
    assert.equal(room(crash.roomId).messages.length, 3)
    await atomicJson(result, { ok: true, phase, modelCalls: requests.length, denied: deniedView, success: completed, crash: reconciled } satisfies TaskNativeReport)
  } catch (error) {
    await atomicJson(result, { ok: false, phase, modelCalls: requests.length, error: String(error),
      ...(error instanceof Error && error.stack ? { stack: error.stack } : {}) } satisfies TaskNativeReport)
  }
}
