/** Browser plugin: generated Remote contribution, native feed, and slot occupants. */
import { checkClient } from '../compatibility.ts'
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
  checkClient(ctx)
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
    feishu: {
      createGroup: request => value(ctx.remote.bots.createFeishuGroup(request)),
      resumeGroup: requestId => value(ctx.remote.bots.resumeFeishuGroup(requestId)),
      snapshot: () => value(ctx.remote.bots.feishuSnapshot()),
      save: request => value(ctx.remote.bots.saveFeishuBinding(request)),
      verify: botId => value(ctx.remote.bots.verifyFeishuBinding(botId)),
      toggle: request => value(ctx.remote.bots.toggleFeishuBinding(request)),
      register: botId => value(ctx.remote.bots.registerFeishuBot(botId)),
      cancel: attemptId => value(ctx.remote.bots.cancelFeishuRegistration(attemptId)),
    },
    infoflow: {
      snapshot: () => value(ctx.remote.bots.infoflowSnapshot()),
      save: request => value(ctx.remote.bots.saveInfoflowBinding(request)),
      verify: botId => value(ctx.remote.bots.verifyInfoflowBinding(botId)),
      toggle: request => value(ctx.remote.bots.toggleInfoflowBinding(request)),
      testMessage: request => value(ctx.remote.bots.testInfoflowMessage(request)),
      createGroup: request => value(ctx.remote.bots.createInfoflowGroup(request)),
      resumeGroup: requestId => value(ctx.remote.bots.resumeInfoflowGroup(requestId)),
    },
    hooks: { bots: model }, toggleSidebar: () => { ctx.layout.toggleSidebar() },
    createBot: request => value(ctx.remote.bots.createBot(request)),
    createGroup: request => value(ctx.remote.bots.createGroup(request)), setMembers: request => value(ctx.remote.bots.setMembers(request)),
    send: request => value(ctx.remote.bots.send(request)), stop: request => value(ctx.remote.bots.stop(request)),
    retry: request => value(ctx.remote.bots.retry(request)), openSession: (id) => { ctx.uiWorkspace.openSession(id) },
  }
  registerPanel(ctx, face, createBotViewStore())
}
