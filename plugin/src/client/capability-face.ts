import type { KnowledgeSettings, KnowledgeStatus } from '../knowledge-types.ts'
import type { AttachmentRequest, AttachmentData, CapabilityCatalog, QuestionAnswer, ScheduleRun, BotId, Room, Budget, ChatAttachment, ConfigureBudget, FailureAction, FailureView, HistoryPage, HistoryRequest, LifecycleRequest, RoomId, SaveScheduleRequest, Schedule, UploadRequest } from '../types.ts'
import type { Memory, MemoryAction, MemoryCatalog, MemoryListRequest, MemoryPreviewRequest, MemorySelection, SaveMemoryRequest } from '../memory-types.ts'
export interface CapabilityFace {
  knowledgeStatus(): Promise<KnowledgeStatus>
  configureKnowledge(settings: KnowledgeSettings): Promise<void>
  reviewAction(request: { id: string; action: 'retry' | 'skip' }): Promise<void>
  linkIdentity(request: { id?: string; name: string; aliases: string[] }): Promise<void>
  unlinkIdentity(request: { id: string }): Promise<void>
  memoryCatalog(): Promise<MemoryCatalog>
  listMemories(request: MemoryListRequest): Promise<Memory[]>
  saveMemory(request: SaveMemoryRequest): Promise<Memory>
  memoryAction(request: MemoryAction): Promise<void>
  previewMemories(request: MemoryPreviewRequest): Promise<MemorySelection>
  attachment(request: AttachmentRequest): Promise<AttachmentData>
  answerQuestion(request: { roomId: RoomId; id: string; answer: QuestionAnswer }): Promise<void>
  catalog(botId?: BotId): Promise<CapabilityCatalog>
  scheduleRuns(request: { id: string; before?: number; limit?: number }): Promise<ScheduleRun[]>
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
