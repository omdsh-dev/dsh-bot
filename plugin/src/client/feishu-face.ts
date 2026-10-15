import type { BotId, Room } from '../types.ts'
import type { CreateFeishuGroupRequest, FeishuState, FeishuBindingView, FeishuRegistration, SaveFeishuBindingRequest } from '../feishu/types.ts'
export interface FeishuFace {
  createGroup(request: CreateFeishuGroupRequest): Promise<Room>
  resumeGroup(requestId: string): Promise<Room>
  snapshot(): Promise<FeishuState>
  save(request: SaveFeishuBindingRequest): Promise<FeishuBindingView>
  verify(botId: BotId): Promise<FeishuBindingView>
  toggle(request: { botId: BotId; enabled: boolean }): Promise<FeishuBindingView>
  register(botId: BotId): Promise<FeishuRegistration>
  cancel(attemptId: string): Promise<void>
}
