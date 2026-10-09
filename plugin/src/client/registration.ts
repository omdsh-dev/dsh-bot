/** Cross-owner UI registration with exact declaration lifetimes. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { createBotViewStore } from './view-store.ts'
import { BotPanel, BotIcon, type PanelFace } from './Panel.tsx'

/**
 * Install the panel whenever its native owners declare their holes.
 * @param ctx - plugin scope carrying slots and locale.
 * @param store - plugin-owned navigation store.
 * @param face - model source and commands, all owned by this plugin.
 */
export function registerPanel(ctx: Context, face: PanelFace, store: ReturnType<typeof createBotViewStore>): void {
  ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'bots', store, locale: 'botMode', inject: () => face }, BotPanel))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'bots', order: 10,
    label: () => ctx.locale.bind('botMode')('title') }, BotIcon))
}
