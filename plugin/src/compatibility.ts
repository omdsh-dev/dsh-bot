/** Check the capabilities we use before creating durable state or delivering input. */
export function optionalService<T>(context: unknown, name: string): T | undefined {
  if (!context || typeof context !== 'object') return undefined
  const get = Reflect.get(context, 'get')
  // Cordis property access requires inject; get() is its native optional-service lookup.
  return (typeof get === 'function' ? get.call(context, name) : Reflect.get(context, name)) as T | undefined
}

export function requireMethods(owner: string, value: unknown, paths: readonly string[]): void {
  const missing = paths.filter(path => {
    let current: unknown = value
    for (const key of path.split('.')) {
      if (current === null || (typeof current !== 'object' && typeof current !== 'function')) return true
      current = Reflect.get(current, key)
    }
    return typeof current !== 'function'
  })
  if (missing.length) throw new Error(`DSH Bot compatibility: ${owner} is missing ${missing.join(', ')}. This DSH interface changed; update DSH Bot or use a tested DSH release.`)
}

/** Required Host operations; no DSH version-number branch is needed. */
export function checkHost(ctx: unknown): void {
  requireMethods('Host', ctx, ['on', 'effect', 'storageDomain.open', 'sessionController.create', 'agents.get', 'sessions.flush'])
}

/** Check each native Agent before attaching identity or submitting a request. */
export function checkAgent(agent: unknown): void {
  requireMethods('Agent', agent, ['followup', 'whenIdle', 'cancel', 'ctx.systemPrompt.variable', 'ctx.systemPrompt.section', 'ctx.systemPrompt.assemble'])
}

/** Both IM connectors use the same native credential and storage contract. */
export function checkIM(ctx: unknown): void {
  requireMethods('IM Host', ctx, ['storageDomain.open', 'credentials.resolve', 'credentials.set', 'botMode.snapshot', 'botMode.ensureExternalRoom', 'botMode.submitExternalMessage', 'botMode.follow', 'botMode.attachQueue', 'botMode.upload'])
}

/** Check the Client services before mounting a Remote namespace or UI slots. */
export function checkClient(ctx: unknown): void {
  requireMethods('Client', ctx, ['remote.$mount', 'remote.$stream', 'slots.inject', 'slots.register', 'locale.register', 'locale.bind', 'uiWorkspace.openSession', 'layout.toggleSidebar'])
}
