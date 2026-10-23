export type TeamOperation = 'create-bot' | 'edit-bot' | 'create-group' | 'edit-group' | 'archive'
export interface TeamSettings { revision: number; botId: string | null; operations: TeamOperation[] }
export interface TeamAudit { id: string; time: number; botId: string; roomId: string; messageId: string; operation: TeamOperation; targetId: string }
export interface TeamView { settings: TeamSettings; audit: TeamAudit[] }
export type TeamCommand =
  | { operation: 'create-bot'; id: string; name: string; instructions: string }
  | { operation: 'edit-bot'; id: string; name: string; instructions: string }
  | { operation: 'create-group'; title: string; botIds: string[]; defaultBot: string }
  | { operation: 'edit-group'; id: string; title: string; botIds: string[]; defaultBot: string }
  | { operation: 'archive'; kind: 'bot' | 'room'; id: string; archived: boolean }
