/** Host-only registration seam for the optional multi-robot manager. */
import type { BotId, CreateInfoFlowGroupRequest, InfoFlowBindingView, InfoFlowState, Room, SaveInfoFlowBindingRequest, ToggleInfoFlowRequest, TestInfoFlowRequest } from '../types.ts'
import type { GroupBotInvite } from '../collaboration-types.ts'
export interface InfoFlowControl {
  inviteBots?(request: GroupBotInvite): Promise<void>
  snapshot(): InfoFlowState
  saveGroupInviteAllowlist?(users: string[]): Promise<string[]>
  save(request: SaveInfoFlowBindingRequest): Promise<InfoFlowBindingView>
  verify(botId: BotId): Promise<InfoFlowBindingView>
  toggle(request: ToggleInfoFlowRequest): Promise<InfoFlowBindingView>
  testMessage(request: TestInfoFlowRequest): Promise<void>
  createGroup(request: CreateInfoFlowGroupRequest): Promise<Room>
  attachGroup(request: { requestId: string; groupId: string }): Promise<Room>
  resumeGroup(requestId: string): Promise<Room>
}
