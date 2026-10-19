/** Bounded handoffs inside one human-initiated external group request. */
import type { Bot, BotId, ChatMessage, ChatMessageId, Room } from './types.ts'

/** Recover the human root without treating a Bot's text as a new human message. */
export function humanRequest(room: Room, response: ChatMessage): ChatMessage | undefined {
  const root = room.messages.find(item => item.id === (response.delegation?.rootId ?? response.replyTo))
  return root?.botId === null ? root : undefined
}

/** A connector owns its direct attempts and their descendants, never a sibling connector's work. */
export function responseTree(room: Room, ids: ChatMessageId[]): ChatMessage[] {
  const owned = new Set(ids)
  // Children are atomically appended after their parent. Persisted order survives restart.
  return room.messages.filter(message => {
    if (message.delegation && message.replyTo && owned.has(message.replyTo)) owned.add(message.id)
    return owned.has(message.id)
  })
}

/** Addressed task lines, list items and table rows; prose, code, quotes and broadcasts never dispatch. */
export function handoffs(text: string, bots: Bot[]): { botId: BotId; task: string }[] {
  const aliases = bots.flatMap(bot => [...new Set([bot.id, bot.name])].map(name => ({ name, botId: bot.id })))
    .filter(alias => !['all', 'everyone'].includes(alias.name.toLowerCase()))
    .sort((a, b) => b.name.length - a.name.length)
  const tasks = new Map<BotId, string>()
  let fence = ''
  for (const raw of text.split('\n')) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(raw)?.[1]
    if (marker) {
      if (!fence) fence = marker
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = ''
      continue
    }
    if (fence || raw.trimStart().startsWith('>')) continue
    // Models use Markdown for both the handle and the whole task. Keep inline code opaque.
    let line = raw.trim().replace(/^(?:[-*+]\s+|\d+[.)、]\s*)/, '')
    line = line.replace(/(`+)([^`]*?)\1|\*\*([^*]+)\*\*|__([^_]+)__/g, (all, code, _body, bold, strong) => code ? all : bold ?? strong)
    if (line.startsWith('|')) line = line.replace(/^\|\s*/, '').replace(/\s*\|\s*$/, '').replace(/\s*\|\s*/g, ' ')
    // A semicolon starts a new addressed task only outside inline code.
    if (!line.startsWith('@')) continue
    const segments = line.replace(/(`+[^`]*`+)|[;；]\s*(?=@)/g, (all, code) => code ? all : '\n').split('\n')
    for (const segment of segments) {
      const line = segment.trim()
      if (!line.startsWith('@')) continue
      const matching = aliases.filter(alias => line.slice(1, alias.name.length + 1).toLowerCase() === alias.name.toLowerCase()
        && /^(?:\s+|[:：]\s*)\S/.test(line.slice(alias.name.length + 1)))
      const match = matching[0]
      if (!match || matching.some(other => other.name.toLowerCase() === match.name.toLowerCase() && other.botId !== match.botId)) continue
      const task = line.slice(match.name.length + 1).replace(/^[\s:：]+/, '').trim()
      if (task && !tasks.has(match.botId)) tasks.set(match.botId, task)
    }
  }
  return [...tasks].map(([botId, task]) => ({ botId, task }))
}

/** Reserve bounded follow-ups as well as first assignments. Call inside the state transaction. */
export function planHandoffs(room: Room, response: ChatMessage, bots: Bot[], available: BotId[]): {
  tasks: { botId: BotId; task: string }[]; rejected: string[]
} {
  const root = humanRequest(room, response)
  const tasks: { botId: BotId; task: string }[] = [], rejected: string[] = []
  if (!root?.allowDelegation) return { tasks, rejected }
  const prior = room.messages.filter(item => item.replyTo === root.id || item.delegation?.rootId === root.id)
  const normalize = (task: string) => task.replace(/\s+/g, ' ').trim().replace(/[。.!！]+$/, '')
  for (const task of handoffs(response.text, bots)) {
    const attempts = prior.filter(item => item.botId === task.botId)
    const reason = task.botId === response.botId ? '不能给自己派活'
      : !available.includes(task.botId) ? '未接入当前群或连接不可用'
        : attempts.some(item => item.delegation && normalize(item.delegation.task) === normalize(task.task)) ? '同一任务已经派发'
          : attempts.some(item => item.status === 'running') ? '正在执行任务，请等待完成后再派活'
            : attempts.length >= 3 || prior.filter(item => item.delegation).length + tasks.length >= 12 ? '本轮协作已达上限，请由用户发起下一轮'
              : undefined
    if (reason) rejected.push(`${bots.find(bot => bot.id === task.botId)?.name ?? task.botId}（${reason}）`)
    else tasks.push(task)
  }
  return { tasks, rejected }
}
