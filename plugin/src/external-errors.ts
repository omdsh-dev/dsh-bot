/** An explicit rejection cannot succeed by replaying the same operation. */
export class PermanentChatError extends Error {
  readonly code = 'DSH_EXTERNAL_PERMANENT'
}

/** The owner and companion ship separate bundles, so instanceof alone is insufficient. */
export function isPermanentChatError(cause: unknown): boolean {
  return cause instanceof Error && 'code' in cause && cause.code === 'DSH_EXTERNAL_PERMANENT'
}
