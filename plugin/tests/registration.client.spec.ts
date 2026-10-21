import type {} from '../src/client/index.ts'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { PropsRuntime, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { expect, it } from 'vitest'
import { registerPanel } from '../src/client/registration.ts'
import { createBotViewStore } from '../src/client/view-store.ts'
import { BotModel } from '../src/client/model.ts'
import { zh, en } from '../src/client/locales.ts'
import type { PanelFace } from '../src/client/Panel.tsx'

it('waits for slot owners, reinstalls after owner reload, and disposes both contributions', async () => {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  ctx.provide('locale', new LocaleRuntime(ctx))
  ctx.locale.register('botMode', { zh, en })
  const unused = async (): Promise<never> => { throw new Error('unused command') }
  const face: PanelFace = { hooks: { bots: new BotModel() }, createBot: unused, updateBot: unused, createGroup: unused,
    setMembers: unused, send: unused, stop: unused, retry: unused, openSession: () => {}, toggleSidebar: () => {}, setInfoflowVisible: unused }
  const plugin = await ctx.plugin({ inject: ['slots', 'locale'], apply: (scope: Context) => { registerPanel(scope, face, createBotViewStore()) } })
  const Owner = (_props: PropsRuntime<'root'> & PropsRenderSlots<'main' | 'sidebar.panellist'>) => null
  const declare = () => ctx.slots.register({ name: 'root', children: {
    main: { kind: 'keyed', scope: 'root' }, 'sidebar.panellist': { kind: 'list', scope: 'root' },
  } }, Owner)
  const first = declare()
  expect(ctx.slots.entriesOfSlot('main').map(entry => entry.options.key)).toEqual(['bots'])
  expect(ctx.slots.entriesOfSlot('sidebar.panellist').map(entry => entry.options.id)).toEqual(['bots'])
  first()
  const second = declare()
  expect(ctx.slots.entriesOfSlot('main')).toHaveLength(1)
  await plugin.dispose()
  expect(ctx.slots.entriesOfSlot('main')).toHaveLength(0)
  expect(ctx.slots.entriesOfSlot('sidebar.panellist')).toHaveLength(0)
  second()
  await ctx.fiber.dispose()
})
