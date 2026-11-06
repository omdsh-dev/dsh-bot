/** Per-execution evidence that a Host-owned local action failed without external side effects. */
export class LocalToolFailures {
  private readonly failures = new Set<string>()
  /** Pass only to trusted Host tool implementations, never infer this evidence from a tool name. */
  readonly onKnownFailure = (callId: string): void => { this.failures.add(callId) }
  /** Consume once, including on success, so one dispatch cannot lend evidence to another one. */
  consume(callId: string): boolean { return this.failures.delete(callId) }
  clear(): void { this.failures.clear() }
}
