/** Client commands exposed through the native authenticated Bot Remote namespace. */
import type { BotId, CreateInfoFlowGroupRequest, InfoFlowBindingView, InfoFlowState, Room, SaveInfoFlowBindingRequest, ToggleInfoFlowRequest, TestInfoFlowRequest } from '../types.ts'
export interface InfoFlowFace {
  snapshot(): Promise<InfoFlowState>
  save(request: SaveInfoFlowBindingRequest): Promise<InfoFlowBindingView>
  verify(botId: BotId): Promise<InfoFlowBindingView>
  toggle(request: ToggleInfoFlowRequest): Promise<InfoFlowBindingView>
  testMessage(request: TestInfoFlowRequest): Promise<void>
  createGroup(request: CreateInfoFlowGroupRequest): Promise<Room>
  attachGroup(request: { requestId: string; groupId: string }): Promise<Room>
  resumeGroup(requestId: string): Promise<Room>
}
