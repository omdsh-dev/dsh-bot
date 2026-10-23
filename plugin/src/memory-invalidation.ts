import type { BotState, Room } from './types.ts'
import type { Memory } from './memory-types.ts'
import { canonicalUser, LOCAL_USER, memoryUser } from './memory.ts'

export interface MemoryTarget { roomId: string; botId: string }
/** Required generation is per membership. The old deployment epoch remains the migration baseline. */
export function memoryVersion(state: BotState, room: Room, botId: string): number {
  return room.members.find(member => member.botId === botId)?.requiredMemoryEpoch ?? state.memoryEpoch ?? 0
}
function roomUsers(state: BotState, room: Room): Set<string | undefined> {
  return new Set([...(room.external ? [] : [LOCAL_USER]), ...room.messages.filter(message => !message.botId).map(message => memoryUser(room, message, state))])
}
/** Ignore expiry/status when determining past exposure: stale values may already be in a Session. */
export function memoryAudience(state: BotState, memories: Memory[], users: string[] = []): MemoryTarget[] {
  const identities = new Set(users.map(user => canonicalUser(state, user)))
  const targets: MemoryTarget[] = []
  for (const room of state.rooms) {
    if (room.deleted) continue
    const participants = roomUsers(state, room)
    const sameRoom = (id?: string) => room.id === id || !!room.aliases?.some(alias => alias === id)
    for (const member of room.members) {
      const affected = [...participants].some(user => identities.has(user)) || memories.some(memory => {
        if (memory.access === 'source-room' && !sameRoom(memory.source.roomId)) return false
        if (memory.access === 'private' && (room.kind !== 'dm' || memory.scope !== 'user')) return false
        if (memory.scope === 'global') return memory.ownerId === '*'
        if (memory.scope === 'bot') return memory.ownerId === member.botId
        if (memory.scope === 'group') return room.kind === 'group' && sameRoom(memory.ownerId)
        const owner = canonicalUser(state, memory.ownerId)
        return !(room.external && owner === LOCAL_USER) && participants.has(owner)
      })
      if (affected) targets.push({ roomId: room.id, botId: member.botId })
    }
  }
  return targets
}
export function mergeMemoryTargets(...groups: MemoryTarget[][]): MemoryTarget[] {
  return [...new Map(groups.flat().map(target => [JSON.stringify([target.roomId, target.botId]), target])).values()]
}
export function invalidateMemories(state: BotState, targets: MemoryTarget[]): void {
  for (const target of targets) {
    const room = state.rooms.find(room => room.id === target.roomId), member = room?.members.find(member => member.botId === target.botId)
    if (room && member) {
      member.requiredMemoryEpoch = memoryVersion(state, room, member.botId) + 1; delete member.handoff
      for (const segment of member.segments ?? []) delete segment.handoff
    }
  }
}
