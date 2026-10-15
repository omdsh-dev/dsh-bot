/** Host-only registration seam for the optional multi-robot manager. */
import type { BotId, CreateInfoFlowGroupRequest, InfoFlowBindingView, InfoFlowState, Room, SaveInfoFlowBindingRequest, ToggleInfoFlowRequest, TestInfoFlowRequest } from '../types.ts'
export interface InfoFlowControl {
  snapshot(): InfoFlowState
  save(request: SaveInfoFlowBindingRequest): Promise<InfoFlowBindingView>
  verify(botId: BotId): Promise<InfoFlowBindingView>
  toggle(request: ToggleInfoFlowRequest): Promise<InfoFlowBindingView>
  testMessage(request: TestInfoFlowRequest): Promise<void>
  createGroup(request: CreateInfoFlowGroupRequest): Promise<Room>
  resumeGroup(requestId: string): Promise<Room>
}
