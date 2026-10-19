/** Merge legacy per-account external group histories without replacing native Bot Sessions. */
import type { BotState, ChatMessage, ChatMessageId, Room } from './types.ts'

/** Shared group identity; private chats remain scoped to the receiving app. */
export function isExternalGroup(room: Room): boolean { return room.external?.kind === 'group' }

/** Merge all legacy entries for one chat in a single BotMode storage transaction.
 * Retired room IDs remain aliases for pending connector work; response IDs and Sessions survive.
 */
export function mergeExternalRooms(state: BotState, chatId: string, provider: 'feishu' | 'infoflow' = 'feishu'): Room | undefined {
  const rooms = state.rooms.filter(room => isExternalGroup(room) && room.external!.provider === provider && room.external!.id === chatId)
  const accountId = `group:${chatId}`
  const target = rooms.find(room => room.external!.accountId === accountId) ?? rooms[0]
  if (!target) return
  if (rooms.length === 1 && target.external!.accountId === accountId) return target
  if (rooms.some(room => room.messages.some(message => message.status === 'running'))) throw new Error('Wait for active group responses before merging')
  const members = new Map(target.members.map(member => [member.botId, { ...member, cursor: 0 }]))
  const messages: ChatMessage[] = [], byReceipt = new Map<string, ChatMessage>(), aliases = new Map<ChatMessageId, ChatMessageId>()
  for (const room of rooms) {
    for (const member of room.members) {
      const prior = members.get(member.botId)
      if (prior && prior.sessionId !== member.sessionId) throw new Error('Conflicting Bot Sessions in the same external group; preserve both before merging')
      if (!prior) members.set(member.botId, { ...member, cursor: 0 })
    }
    for (const original of room.messages) {
      const message = structuredClone(original)
      if (message.external && message.botId === null) {
        const sources = [...(message.external.sources ?? [])]
        if (!room.external!.accountId.startsWith('group:') && !sources.some(source => source.accountId === room.external!.accountId)) {
          sources.push({ accountId: room.external!.accountId, senderId: message.external.sender.id })
        }
        message.external.sources = sources
        const previous = byReceipt.get(message.external.id)
        if (previous) {
          for (const source of sources) if (!previous.external!.sources!.some(item => item.accountId === source.accountId)) previous.external!.sources!.push(source)
          aliases.set(message.id, previous.id)
          continue
        }
        byReceipt.set(message.external.id, message)
      }
      messages.push(message)
    }
  }
  for (const message of messages) {
    if (message.replyTo) message.replyTo = aliases.get(message.replyTo) ?? message.replyTo
    if (message.delegation) message.delegation.rootId = aliases.get(message.delegation.rootId) ?? message.delegation.rootId
  }
  messages.sort((left, right) => left.time - right.time)
  target.aliases = [...new Set(rooms.flatMap(room => [...(room.aliases ?? []), ...(room.id !== target.id ? [room.id] : [])]))]
  target.external = { provider, accountId, kind: 'group', id: chatId }
  target.members = [...members.values()]; target.messages = messages
  state.rooms = state.rooms.filter(room => !rooms.includes(room) || room === target)
  return target
}
