/** One cancellation path for native waits, idle work and unanswered approvals. */
export class RunDeadline {
  private controller = new AbortController()
  private timer: ReturnType<typeof setInterval>
  private started = Date.now()
  private progress = this.started
  private approvalAt: number | undefined
  constructor(limits: { idleMs: number; totalMs: number; approvalMs: number }, cancel: (reason: string) => void) {
    this.controller.signal.addEventListener('abort', () => cancel(String(this.controller.signal.reason)), { once: true })
    this.timer = setInterval(() => {
      const now = Date.now()
      if (now - this.started >= limits.totalMs) this.abort('Execution time limit reached; inspect the native Session before retrying')
      else if (this.approvalAt !== undefined && now - this.approvalAt >= limits.approvalMs) this.abort('Approval expired; no permission was granted')
      else if (this.approvalAt === undefined && now - this.progress >= limits.idleMs) this.abort('No execution progress within the time limit; inspect the native Session before retrying')
    }, 250)
    this.timer.unref()
  }
  get signal(): AbortSignal { return this.controller.signal }
  touch(): void { this.progress = Date.now() }
  awaitingApproval(value: boolean): void { this.approvalAt = value ? Date.now() : undefined; this.touch() }
  abort(reason = 'Execution canceled'): void { if (!this.signal.aborted) this.controller.abort(reason) }
  async wait<T>(promise: Promise<T>): Promise<T> {
    if (this.signal.aborted) throw new Error(String(this.signal.reason))
    let abort = () => {}
    const stopped = new Promise<never>((_resolve, reject) => { abort = () => reject(new Error(String(this.signal.reason))); this.signal.addEventListener('abort', abort, { once: true }) })
    try { return await Promise.race([promise, stopped]) } finally { this.signal.removeEventListener('abort', abort) }
  }
  dispose(): void { clearInterval(this.timer) }
}
