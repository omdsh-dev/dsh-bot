import type { ChatMessageId, RoomId } from './types.ts'

/** Data-only views rendered by the client; no HTML, scripts, URLs or executable actions. */
export type CardContent =
  | { kind: 'metric'; title: string; value: string; detail?: string | undefined }
  | { kind: 'table'; title: string; columns: string[]; rows: string[][] }
  | { kind: 'progress'; title: string; value: number; total: number; detail?: string | undefined }
  | { kind: 'form'; title: string; description?: string | undefined; submitLabel: string; fields: CardField[] }
export interface CardField {
  name: string; label: string; type: 'text' | 'textarea' | 'select'; required: boolean
  options?: string[] | undefined
}
export interface ChatCard {
  id: string; revision: number; content: CardContent
  submitted?: { messageId: string; values: Record<string, string>; time: number } | undefined
}
export interface SubmitCardRequest { roomId: RoomId; messageId: ChatMessageId; cardId: string; revision: number; values: Record<string, string> }
