/** Public Feishu configuration; no credential values or OAuth device codes. */
import type { BotId, Room, RoomId } from '../types.ts'
export type Brand = 'feishu' | 'lark'
export interface FeishuBindingView {
  botId: BotId; appId: string; botOpenId: string; robotName: string; brand: Brand; enabled: boolean
  status: 'disabled' | 'connecting' | 'connected' | 'error'; error: string | null
  allowUsers: string[]; allowGroups: string[]; admins: string[]; credentialsConfigured: boolean
}
export interface FeishuRegistration {
  botId: BotId; attemptId: string; status: 'starting' | 'waiting' | 'saving' | 'complete' | 'canceled' | 'expired' | 'error' | 'interrupted'
  url: string | null; qrDataUrl: string | null; expiresAt: number | null; message: string | null
}
/** One request owns one remote group, including retries after a lost response. */
export interface CreateFeishuGroupRequest { requestId: string; title: string; botIds: BotId[]; creatorBot: BotId; owner?: string }
export interface FeishuGroupView {
  requestId: string; title: string; botIds: BotId[]; creatorBot: BotId; owner: string; createdAt: number
  chatId: string | null; roomId: RoomId | null
  status: 'creating' | 'uncertain' | 'failed' | 'linking' | 'ready'; error: string | null
}
export interface FeishuState { available: boolean; bindings: FeishuBindingView[]; registrations: FeishuRegistration[]; groups: FeishuGroupView[] }
export interface SaveFeishuBindingRequest { botId: BotId; appId: string; appSecret?: string; brand: Brand; allowUsers: string[]; allowGroups: string[]; admins: string[] }
export interface FeishuControl {
  createGroup(request: CreateFeishuGroupRequest): Promise<Room>
  resumeGroup(requestId: string): Promise<Room>
  snapshot(): FeishuState
  save(request: SaveFeishuBindingRequest): Promise<FeishuBindingView>
  verify(botId: BotId): Promise<FeishuBindingView>
  toggle(request: { botId: BotId; enabled: boolean }): Promise<FeishuBindingView>
  register(botId: BotId): Promise<FeishuRegistration>
  cancel(attemptId: string): Promise<void>
}
