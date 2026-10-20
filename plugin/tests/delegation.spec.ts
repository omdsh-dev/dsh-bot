import { expect, it } from 'vitest'
import { brandString } from '@deepseek-ai/dsh-brand'
import { handoffs, planHandoffs } from '../src/delegation.ts'
import type { Bot, BotId, ChatMessage, Room } from '../src/types.ts'

const bots: Bot[] = ['engineer', 'review'].map((id, index) => ({ id: brandString<BotId>(id), name: ['工程 Bot', '审阅 Bot'][index]!, instructions: '', preset: 'standard' }))
it('recognizes standalone task lines by handle or unambiguous display name, once per recipient', () => {
  expect(handoffs('派活如下：\n- @工程 Bot：实现接口\n2. @REVIEW 审查实现\n@engineer 重复任务', bots)).toEqual([
    { botId: 'engineer', task: '实现接口' }, { botId: 'review', task: '审查实现' },
  ])
})
it('does not dispatch quoted/code/prose/broadcast/email/unknown/empty mentions', () => {
  expect(handoffs('讨论 @engineer 的方案\n> @review 引用\n```\n@engineer 代码\n```\n~~~\n@review 代码\n~~~\n`@engineer 行内代码`\na@review.com\n@all 全体\n@outsider 外人\n@review\n@engineer-too 名称前缀', bots)).toEqual([])
  expect(handoffs('    @engineer 缩进代码\n\t@review 制表符代码', bots)).toEqual([])
  expect(handoffs('@工程 Bot 做事', [...bots, { ...bots[1]!, name: '工程 Bot' }])).toEqual([])
})
it('dispatches the bold/table assignments and semicolon follow-ups seen in real group replies', () => {
  expect(handoffs('| 角色 | 任务 |\n| **@engineer** | 实现五子棋 MVP |\n\n**@review 请先开工**，审查边界测试。', bots)).toEqual([
    { botId: 'engineer', task: '实现五子棋 MVP' }, { botId: 'review', task: '请先开工，审查边界测试。' },
  ])
  expect(handoffs('@engineer 补 #1 测试；@review 重新审查测试覆盖。', bots)).toEqual([
    { botId: 'engineer', task: '补 #1 测试' }, { botId: 'review', task: '重新审查测试覆盖。' },
  ])
})

it('allows concrete rework but explains duplicate, unavailable, busy and exhausted recipients', () => {
  const root = { id: 'root', botId: null, allowDelegation: true }
  const response = { id: 'review', botId: 'review', delegation: { rootId: 'root', task: '审阅' }, text: '@engineer 补测试', status: 'complete' }
  const earlier = { id: 'engineering', botId: 'engineer', delegation: { rootId: 'root', task: '实现' }, status: 'complete' }
  // Persisted fixtures use the same root and response relationships as the live review report.
  const room = { messages: [root, earlier, response] } as unknown as Room
  const plan = () => planHandoffs(room, response as unknown as ChatMessage, bots, bots.map(bot => bot.id))
  expect(plan().tasks).toEqual([{ botId: 'engineer', task: '补测试' }])
  earlier.delegation.task = '补测试。'
  expect(plan().rejected[0]).toContain('已经派发')
  earlier.delegation.task = '实现'; earlier.status = 'running'
  expect(plan().rejected[0]).toContain('正在执行')
  earlier.status = 'complete'
  expect(planHandoffs(room, response as unknown as ChatMessage, bots, []).rejected[0]).toContain('未接入当前群')
  room.messages.push({ ...room.messages[1]!, id: brandString('second') }, { ...room.messages[1]!, id: brandString('third') })
  expect(plan().rejected[0]).toContain('已达上限')
})
