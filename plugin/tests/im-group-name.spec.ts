import { expect, it } from 'vitest'
import { suppliedGroupName } from '../src/im-group-name.ts'
import { messageSchema } from '../src/domain.ts'

it('requires a literal current-request name and rejects empty, multiline and excessive names', () => {
  expect(suppliedGroupName(' 产品讨论群 ', '这个群叫「产品讨论群」，补齐到 Web')).toBe('产品讨论群')
  for (const name of ['', ' ', '新群名', 'a\nb', 'a\tb', 'a\u0000b', 'x'.repeat(1001)]) {
    expect(() => suppliedGroupName(name, '这个群叫产品讨论群 ' + (name === '新群名' ? '' : name))).toThrow()
  }
})

it('retains the naming receipt through persisted history validation', () => {
  const receipt = { title: '产品讨论群', callId: 'save', time: 1, actor: { provider: 'feishu', accountId: 'app', senderId: 'admin' } }
  expect(messageSchema.parse({ id: 'reply', botId: 'bot', text: '', replyTo: 'human', status: 'complete', error: null, time: 1, groupNameUpdate: receipt }).groupNameUpdate).toEqual(receipt)
})
