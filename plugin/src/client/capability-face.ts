import type { BotId, Room, Budget, ChatAttachment, ConfigureBudget, FailureAction, FailureView, HistoryPage, HistoryRequest, LifecycleRequest, RoomId, SaveScheduleRequest, Schedule, UploadRequest } from '../types.ts'
export interface CapabilityFace {
  openDirect(botId: BotId): Promise<Room>
  history(request: HistoryRequest): Promise<HistoryPage>
  exportChat(request: { roomId: RoomId; format: 'json' | 'markdown' }): Promise<string>
  lifecycle(request: LifecycleRequest): Promise<void>
  configureBudget(request: ConfigureBudget): Promise<Budget>
  upload(request: UploadRequest): Promise<ChatAttachment>
  decideApproval(request: { roomId: RoomId; id: string; allow: boolean }): Promise<void>
  saveSchedule(request: SaveScheduleRequest): Promise<Schedule>
  deleteSchedule(id: string): Promise<void>
  failures(): Promise<FailureView[]>
  resolveFailure(request: FailureAction): Promise<void>
}
