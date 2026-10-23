/** Operator-owned capabilities. Secret values never enter this document or a snapshot. */
export interface BotCapability {
  name: string; revision: number; description: string; botIds: string[]
  kind: 'skill' | 'mcp' | 'browser'; content?: string | undefined
  executablePath?: string | undefined
  transport?: 'stdio' | 'streamable-http' | undefined
  command?: string | undefined; args?: string[] | undefined; env?: Record<string, string> | undefined
  url?: string | undefined; headers?: Record<string, string> | undefined
}
export interface BotCredential {
  name: string; revision: number; description: string; botIds: string[]; shellBotIds: string[]
  /** Opaque native credential record identity; never the stored value. */
  key: string
}
export interface AccessState { capabilities: BotCapability[]; credentials: BotCredential[] }
export interface AccessView {
  capabilities: BotCapability[]
  credentials: { name: string; revision: number; description: string; botIds: string[]; shellBotIds: string[]; configured: boolean }[]
}
export interface SaveCapability extends Omit<BotCapability, 'revision'> { revision?: number }
export interface SaveBotCredential {
  name: string; revision?: number; description: string; botIds: string[]; shellBotIds: string[]; value?: string
}
export interface AccessRemoval { name: string; revision: number; kind: 'capability' | 'credential' }
