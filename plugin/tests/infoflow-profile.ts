/** Real DSH execution and disk recovery, with only the network sender replaced. */
import assert from 'node:assert/strict'
import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type {} from '../src/index.ts'
import { InfoFlowBridge } from '../lib/types/infoflow/bridge.js'
import { infoflowDomain } from '../lib/types/infoflow/domain.js'
import { decodeMessage, type Incoming } from '../lib/types/infoflow/messages.js'
import type { RoomId } from '../src/types.ts'

/** @param ctx - live profile. @param requests - recorded fixture model requests. @param settled - native turn completion helper. */
export async function exerciseInfoflow(ctx: Context, requests: GenerateOptions[], settled: (id: RoomId) => Promise<unknown>): Promise<void> {
  const service = ctx.botMode
  const architect = service.snapshot().bots.find(bot => bot.id === 'architect')!
  const critic = service.snapshot().bots.find(bot => bot.id === 'critic')!
  const input = (id: string, text: string, user = 'alice'): Incoming => ({ conversation: { provider: 'infoflow', accountId: 'fixture', kind: 'private', id: user },
    message: { id, sender: { id: user, name: `PERSONA_INJECT_${user}` } }, text })
  const domain = await ctx.storageDomain.open(infoflowDomain)
  const sent: string[] = []
  const initialRequests = requests.length
  const resuming = process.env.BOT_TEST_PHASE === 'resume'
  const bridge = new InfoFlowBridge(service, domain.global, { send: async delivery => {
    if (!resuming && delivery.text.includes('fixture answer')) throw new Error('offline until next process')
    sent.push(delivery.text)
  } }, { accountId: 'fixture', botIds: [architect.id, critic.id], defaultBot: architect.id, allowUsers: ['alice', 'bob'], allowGroups: ['123'], admins: [],
    maxPending: 20, maxQueuePerRoom: 5, maxConcurrentRooms: 2, maxReceipts: 100, maxOutbox: 100, chunkSize: 3000, retryMs: 1, maxRetryMs: 1 }, () => {})
  try {
    if (resuming) {
      await bridge.wake()
      assert.equal(requests.length, initialRequests, 'restoring replies must not invoke the model')
      assert.ok(sent.some(text => text.includes('fixture answer')))
      assert.ok(sent.some(text => text.includes('未自动重跑')))
      assert.equal(domain.global.get().pending.length, 0)
      assert.equal(domain.global.get().outbox.length, 0)
      assert.equal(await bridge.receive(input('queued-1', 'external persistent reply')), 'duplicate')
      const alice = service.snapshot().rooms.find(room => room.external?.id === 'alice')!
      const old = alice.messages.find(message => message.external?.id === 'direct-1')!
      const receipt = await service.submitExternalMessage({ roomId: alice.id, text: old.text, external: old.external! })
      assert.equal(receipt.status, 'accepted')
      assert.equal(requests.length, initialRequests, 'Bot receipt must survive a process restart')
      return
    }
    const alice = await service.ensureExternalRoom({ conversation: input('x', '').conversation, title: 'PERSONA_INJECT_alice', botIds: [architect.id], defaultBot: architect.id })
    const bob = await service.ensureExternalRoom({ conversation: input('x', '', 'bob').conversation, title: 'Bob', botIds: [architect.id], defaultBot: architect.id })
    const local = service.snapshot().rooms.find(room => !room.external && room.kind === 'dm' && room.defaultBot === architect.id)!
    assert.notEqual(alice.members[0]!.sessionId, local.members[0]!.sessionId)
    assert.notEqual(alice.members[0]!.sessionId, bob.members[0]!.sessionId)
    const message = input('direct-1', 'EXTERNAL_ALICE_ONLY')
    const accepted = await service.submitExternalMessage({ roomId: alice.id, text: message.text, external: message.message })
    const duplicate = await service.submitExternalMessage({ roomId: alice.id, text: message.text, external: message.message })
    assert.deepEqual(duplicate, accepted)
    await settled(alice.id)
    assert.equal(requests.length, initialRequests + 1)
    assert.ok(!JSON.stringify(requests.at(-1)!.messages).includes('PRIVATE_SECRET'))
    assert.ok(!JSON.stringify(requests.at(-1)!.messages.filter(message => message.role === 'system')).includes('PERSONA_INJECT_alice'))
    assert.ok(JSON.stringify(requests.at(-1)!.messages.filter(message => message.role === 'user')).includes('PERSONA_INJECT_alice'))
    await assert.rejects(service.send({ roomId: alice.id, text: 'local accidental send' }), /through InfoFlow/)
    const group = decodeMessage('group.text', { data: { raw: { groupid: '123', eventtype: 'MESSAGE_RECEIVE',
      message: { header: { fromuserid: 'alice', messageid: 'group-1' }, body: [{ type: 'AT', robotid: 'robot' }, { type: 'TEXT', content: '@all group request' }] } } } }, 'fixture', 'robot')!
    const groupRoom = await service.ensureExternalRoom({ conversation: group.conversation, title: 'Group', botIds: [architect.id, critic.id], defaultBot: architect.id })
    const all = await service.submitExternalMessage({ roomId: groupRoom.id, text: group.text, external: group.message })
    assert.equal(all.status, 'accepted')
    if (all.status === 'accepted') assert.equal(all.attemptIds.length, 2)
    await settled(groupRoom.id)
    assert.ok(requests.slice(-2).every(request => !JSON.stringify(request.messages).includes('EXTERNAL_ALICE_ONLY')))
    await bridge.receive(input('queued-1', 'external persistent reply'))
    await bridge.wake(); await settled(alice.id); await bridge.wake()
    assert.ok(domain.global.get().outbox.some(delivery => delivery.text.includes('fixture answer')))
    await bridge.receive(input('crash-1', 'WAIT_FOR_STOP', 'bob')); await bridge.wake()
    const deadline = Date.now() + 10000
    while (!requests.some(request => request.messages.some(message => JSON.stringify(message).includes('WAIT_FOR_STOP') && JSON.stringify(message).includes('PERSONA_INJECT_bob')))) {
      if (Date.now() > deadline) throw new Error('external crash turn did not start')
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    assert.ok(domain.global.get().pending.some(item => item.submitted))
  } finally { await bridge.close(); await domain.close() }
}
