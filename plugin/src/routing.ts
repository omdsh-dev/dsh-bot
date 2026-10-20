/** Explicit public-message routing; quoted/code/email mentions never dispatch. */
import type { BotId, BotState, ChatMessage, ChatMessageId, Room, SendRequest } from './types.ts'

/**
 * Resolve only explicit human addressing.
 * @param state - known Bot identities.
 * @param room - current roster and public history.
 * @param request - human input and optional routing override.
 * @returns distinct admitted members, or throws for invalid recipients.
 */
export function route(state: BotState, room: Room, request: SendRequest): BotId[] {
  const lines: string[] = []
  let fence = ''
  for (const line of request.text.split('\n')) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]
    if (marker) {
      if (!fence) fence = marker
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = ''
    } else if (!fence && !line.trimStart().startsWith('>')) lines.push(line.replace(/(`+).*?\1/g, ''))
  }
  const mentions = [...lines.join('\n').matchAll(/(?<![\w@])@([a-zA-Z][a-zA-Z0-9_-]*)/g)].flatMap(match => match[1] === undefined ? [] : [match[1].toLowerCase()])
  let targets: BotId[]
  if (request.targets !== undefined) targets = request.targets
  else if (room.kind === 'dm') targets = [room.defaultBot]
  else if (mentions.includes('all') || mentions.includes('everyone')) targets = room.members.filter(member => state.bots.some(bot => bot.id === member.botId && !bot.archived)).map(member => member.botId)
  else {
    targets = state.bots.filter(bot => mentions.includes(bot.id)).map(bot => bot.id)
    if (targets.length === 0) {
      const reply = request.replyTo === undefined ? undefined : findMessage(room, request.replyTo)
      const defaultBot = state.bots.some(bot => bot.id === room.defaultBot && !bot.archived) ? room.defaultBot
        : room.members.find(member => state.bots.some(bot => bot.id === member.botId && !bot.archived))?.botId
      targets = reply?.botId ? [reply.botId] : defaultBot ? [defaultBot] : []
    }
  }
  targets = [...new Set(targets)]
  if (targets.length === 0 || targets.some(id => !room.members.some(member => member.botId === id))) {
    throw new Error('Recipients must be current members of this chat')
  }
  return targets
}

/**
 * Resolve a message strictly within one chat.
 * @param room - owning chat.
 * @param id - message to resolve.
 * @returns the record, or throws if absent.
 */
export function findMessage(room: Room, id: ChatMessageId): ChatMessage {
  const message = room.messages.find(item => item.id === id)
  if (!message) throw new Error('Message not found in this chat')
  return message
}
