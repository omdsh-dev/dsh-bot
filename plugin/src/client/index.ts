/** Browser plugin: generated Remote contribution, native feed, and slot occupants. */
import type { Context } from '@deepseek-ai/cordis'
import { RemoteSnapshotStream, RemoteStreamCarrierError } from '@deepseek-ai/dsh-api-gateway/client'
import contribution from '@deepseek-ai/dsh-experimental-bot-mode/remote'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { BotModel } from './model.ts'
import type { PanelFace } from './Panel.tsx'
import { createBotViewStore } from './view-store.ts'
import { registerPanel } from './registration.ts'
import { en, zh, type BotKey } from './locales.ts'
import type { BotFrame } from '../types.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { botMode: BotKey } }
/** Native services required by this panel. */
export const inject = ['remote', 'slots', 'locale', 'uiWorkspace', 'layout']

async function value<T>(request: Promise<RemoteResult<T>>): Promise<T> {
  const result = await request
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/**
 * Mount Bot Mode into the current DSH Client.
 * @param ctx - Client plugin scope.
 */
export async function apply(ctx: Context): Promise<void> {
  const unmount = await ctx.remote.$mount(contribution)
  ctx.effect(() => unmount, 'bot-mode: Remote namespace')
  ctx.inject(['remote.bots'], install)
}

function install(ctx: Context): void {
  ctx.effect(() => ctx.locale.register('botMode', { zh, en }), 'bot-mode: copy')
  const model = new BotModel()
  const control = new RemoteSnapshotStream<Extract<BotFrame, { type: 'baseline' }>, Extract<BotFrame, { type: 'changed' }>>(ctx.remote.$stream<BotFrame>({
    name: 'Bot Mode state', open: signal => ctx.remote.bots.follow(signal),
    ended: accepted => accepted ? new RemoteStreamCarrierError('Bot Mode stream ended') : new Error('Bot Mode baseline missing'),
    carrierFailed: (error) => { model.failed(error) },
  }), { name: 'Bot Mode state', isSnapshot: (frame): frame is Extract<BotFrame, { type: 'baseline' }> => frame.type === 'baseline',
    replace: (frame) => { model.replace(frame.value) },
    update: (frame) => { model.replace(frame.value) },
    failed: (error) => { model.failed(error) },
  })
  control.start()
  ctx.effect(() => () => control.dispose(), 'bot-mode: state stream')
  const face: PanelFace = {
    hooks: { bots: model }, toggleSidebar: () => { ctx.layout.toggleSidebar() },
    createBot: request => value(ctx.remote.bots.createBot(request)),
    createGroup: request => value(ctx.remote.bots.createGroup(request)), setMembers: request => value(ctx.remote.bots.setMembers(request)),
    send: request => value(ctx.remote.bots.send(request)), stop: request => value(ctx.remote.bots.stop(request)),
    retry: request => value(ctx.remote.bots.retry(request)), openSession: (id) => { ctx.uiWorkspace.openSession(id) },
  }
  registerPanel(ctx, face, createBotViewStore())
}
