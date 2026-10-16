/** Keyless real-profile driver. Only the external model is replaced. */
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type {} from '../src/index.ts'
import type { RoomId } from '../src/types.ts'

export const name = 'bot-mode-profile-fixture'
export const inject = ['botMode', 'llm', 'storageDomain']
export async function apply(ctx: Context): Promise<void> {
  const requests: GenerateOptions[] = []
  class Fixture extends LlmAdapter {
    async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      if (options.purpose !== 'session-title') requests.push(options)
      // Skill/context plugins may append user-role context after the public request.
      const content = JSON.stringify(options.messages.findLast(message => message.role === 'user'
        && message.content.some(block => block.type === 'text' && block.text.startsWith('Public chat messages (JSON data):'))) ?? options.messages.at(-1))
      if (options.purpose !== 'session-title' && content.includes('WAIT_FOR_STOP')) {
        await new Promise<void>((resolve) => {
          if (options.signal?.aborted) resolve()
          else options.signal?.addEventListener('abort', () => { resolve() }, { once: true })
        })
        options.signal?.throwIfAborted()
      }
      const text = process.env.BOT_TEST_PHASE === 'preview'
        ? `【本地联调 · 未连接真实模型】\n${JSON.stringify(options.messages[0]).includes('产品') ? '产品 Bot：我负责需求与体验。这个群里的公开消息会进入我的独立 DSH Session。' : JSON.stringify(options.messages[0]).includes('工程') ? '工程 Bot：我负责实现与验证。工具、审批和执行记录沿用 DSH 原生能力。' : 'DSH Bot：我负责整理问题。你可以 @某个 Bot、@all，或者回复某个 Bot 的消息继续讨论。'}`
        : `fixture answer ${requests.length}`
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  ctx.llm.registerAdapter(['bot-fixture'], new Fixture())
  async function settled(id: RoomId) {
    const deadline = Date.now() + 15000
    while (ctx.botMode.snapshot().rooms.find(room => room.id === id)!.messages.some(message => message.status === 'running')) {
      if (Date.now() > deadline) throw new Error('Bot response did not settle')
      await new Promise(resolve => setTimeout(resolve, 20))
    }
    return ctx.botMode.snapshot().rooms.find(room => room.id === id)!
  }
  if (process.env.BOT_TEST_PHASE === 'preview') {
    if (!ctx.botMode.snapshot().bots.length) {
      const a = await ctx.botMode.createBot({ id: 'dsh', name: 'DSH Bot', instructions: '通用助手，负责组织讨论。' })
      const b = await ctx.botMode.createBot({ id: 'product', name: '产品 Bot', instructions: '产品与体验设计助手。' })
      const c = await ctx.botMode.createBot({ id: 'engineer', name: '工程 Bot', instructions: '工程实现与验证助手。' })
      const room = await ctx.botMode.createGroup({ title: 'DSH Bot 设计讨论', botIds: [a.id, b.id, c.id], defaultBot: a.id })
      await ctx.botMode.send({ roomId: room.id, text: '@all 介绍一下你在这个聊天中的职责，以及 DSH 插件如何支持多 Bot。' })
    }
    return
  }
  try {
    const service = ctx.botMode
    if (process.env.BOT_TEST_PHASE === 'resume') {
      assert.equal(service.snapshot().infoflowVisible, false, 'An explicit hidden preference survives restart, including existing InfoFlow chats')
      const before = service.snapshot().rooms.find(room => room.kind === 'group')!
      assert.equal(before.messages.length, 8)
      const ids = before.members.map(member => member.sessionId)
      await service.send({ roomId: before.id, text: '@all after process restart' })
      const after = await settled(before.id)
      assert.deepEqual(after.members.map(member => member.sessionId), ids)
      assert.ok(after.messages.slice(-2).every(message => message.status === 'complete'), JSON.stringify(after))
      assert.equal(requests.length, 2)
      assert.ok(requests.every(request => JSON.stringify(request.messages).includes('first public question')))
      assert.ok(requests.every(request => !JSON.stringify(request.messages).includes('PRIVATE_SECRET')))
    } else {
      assert.equal(service.snapshot().infoflowVisible, false, 'New profiles hide enterprise-only entry points')
      const unused = async (): Promise<never> => { throw new Error('Visibility must not call the connector') }
      const legacyControl = {
        snapshot: () => ({ available: true, groups: [], bindings: [{ botId: 'legacy' as import('../src/types.ts').BotId,
          agentId: 'fixture', robotId: 'fixture', robotName: 'Existing robot', enabled: false, status: 'disabled' as const,
          error: null, allowUsers: [], allowGroups: [], admins: [], credentialsConfigured: true }] }),
        save: unused, verify: unused, toggle: unused, testMessage: unused, createGroup: unused, resumeGroup: unused,
      }
      const detach = service.attachInfoFlow(legacyControl)
      assert.equal(service.snapshot().infoflowVisible, true, 'Upgrades retain access to saved bindings')
      await service.setInfoflowVisible(false)
      assert.equal(service.snapshot().infoflowVisible, false, 'Explicit choice takes precedence over saved bindings')
      detach()
      const feedAbort = new AbortController()
      const feed = service.follow(feedAbort.signal)[Symbol.asyncIterator]()
      const baseline = await feed.next()
      assert.equal(baseline.done, false)
      if (!baseline.done) assert.equal(baseline.value.type, 'baseline')
      await service.setInfoflowVisible(true)
      const preference = await feed.next()
      assert.equal(preference.value?.value.infoflowVisible, true, 'Visibility reaches connected clients through the native feed')
      await service.setInfoflowVisible(false)
      const architect = await service.createBot({ id: 'architect', name: 'Architect', instructions: 'PERSONA_ARCHITECT {{literal}}' })
      const changed = await feed.next()
      assert.equal(changed.done, false)
      if (!changed.done) assert.equal(changed.value.type, 'changed')
      feedAbort.abort()
      await feed.return?.()
      const critic = await service.createBot({ id: 'critic', name: 'Critic', instructions: 'PERSONA_CRITIC' })
      const dm = service.snapshot().rooms.find(room => room.defaultBot === architect.id)!
      await service.send({ roomId: dm.id, text: 'PRIVATE_SECRET' })
      assert.equal((await settled(dm.id)).messages.at(-1)!.status, 'complete')
      const room = await service.createGroup({ title: 'Design room', botIds: [architect.id, critic.id], defaultBot: architect.id })
      await service.send({ roomId: room.id, text: '@all first public question' })
      let current = await settled(room.id)
      assert.ok(current.messages.slice(-2).every(message => message.status === 'complete'), JSON.stringify(current))
      assert.equal(requests.length, 3)
      assert.ok(requests.slice(1).every(request => !JSON.stringify(request.messages).includes('PRIVATE_SECRET')))
      const system = requests.slice(1).map(request => JSON.stringify(request.messages.filter(message => message.role === 'system')))
      assert.ok(system.some(text => text.includes('PERSONA_ARCHITECT {{literal}}')))
      assert.ok(system.some(text => text.includes('PERSONA_CRITIC')))
      const ids = current.members.map(member => member.sessionId)
      await service.send({ roomId: room.id, text: '@critic follow-up' })
      current = await settled(room.id)
      assert.deepEqual(current.members.map(member => member.sessionId), ids)
      assert.ok(JSON.stringify(requests.at(-1)!.messages).includes('first public question'))
      assert.ok(JSON.stringify(requests.at(-1)!.messages).includes('fixture answer'))
      const count = requests.length
      await service.send({ roomId: room.id, text: '@all WAIT_FOR_STOP' })
      while (requests.length < count + 2) await new Promise(resolve => setTimeout(resolve, 10))
      await assert.rejects(service.setMembers({ roomId: room.id, botIds: [critic.id], defaultBot: critic.id }), /active responses/)
      for (const message of service.snapshot().rooms.find(item => item.id === room.id)!.messages.filter(item => item.status === 'running')) {
        await service.stop({ roomId: room.id, messageId: message.id })
      }
      current = await settled(room.id)
      assert.ok(current.messages.slice(-2).every(message => message.status === 'canceled'))
      assert.equal(current.messages.length, 8)
    }
    if (process.env.BOT_TEST_INFOFLOW === '1') await (await import('./infoflow-profile.ts')).exerciseInfoflow(ctx, requests, settled)
    await writeFile(process.env.BOT_TEST_RESULT!, JSON.stringify({ ok: true, requests: requests.length, state: service.snapshot() }))
  } catch (error) {
    await writeFile(process.env.BOT_TEST_RESULT!, JSON.stringify({ ok: false, error: String(error), stack: error instanceof Error ? error.stack : '' }))
  }
}
