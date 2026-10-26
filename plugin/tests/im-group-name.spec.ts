import { expect, it } from 'vitest'
import { suppliedGroupName, groupNamePermissionHelp, groupNamePrompt } from '../src/im-group-name.ts'
import { messageSchema } from '../src/domain.ts'
import type { FeishuBindingView } from '../src/feishu/types.ts'
import type { BotId } from '../src/types.ts'

it('offers the current app permission link only for a confirmed missing permission', () => {
  const binding: FeishuBindingView = { botId: 'bot' as BotId, appId: 'cli_current', botOpenId: 'ou_bot', robotName: 'Bot', brand: 'feishu', enabled: true,
    status: 'connected', error: null, allowUsers: [], allowGroups: [], admins: [], credentialsConfigured: true, groupNameStatus: 'permission-required' }
  expect(groupNamePermissionHelp(binding)?.url).toBe('https://open.feishu.cn/app/cli_current/auth?q=im%3Achat%3Aread')
  expect(groupNamePrompt(binding)).toContain('Do not repeat this notice during unrelated discussion')
  expect(groupNamePermissionHelp({ ...binding, brand: 'lark' })?.url).toContain('open.larksuite.com/app/cli_current/')
  for (const groupNameStatus of ['unknown', 'available', 'unavailable'] as const) expect(groupNamePermissionHelp({ ...binding, groupNameStatus })).toBeUndefined()
  expect(groupNamePermissionHelp({ ...binding, enabled: false })).toBeUndefined()
  expect(groupNamePermissionHelp(undefined)).toBeUndefined()
})

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
