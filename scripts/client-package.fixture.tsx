// @vitest-environment jsdom
/** Execute the shipped Client factory against the selected DSH's actual UI owners. */
import { readFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import * as React from 'react'
import * as jsx from 'react/jsx-runtime'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import * as store from '@deepseek-ai/dsh-client-store'
import * as gateway from '@deepseek-ai/dsh-api-gateway/client'
import { SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { Context } from '@deepseek-ai/cordis'
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'

let runtime
afterEach(async () => { await runtime?.dispose(); cleanup(); vi.restoreAllMocks() })

it('mounts the archive UI, renders native controls, and sends through its Remote face', async () => {
  const modules = { react: React, 'react/jsx-runtime': jsx, '@deepseek-ai/dsh-client-ui-primitives': primitives,
    '@deepseek-ai/dsh-client-store': store, '@deepseek-ai/dsh-api-gateway/client': gateway }
  let client
  new Function('window', readFileSync(process.env.BOT_CLIENT_FILE, 'utf8'))({ __ModuleLoader__: { load({ factory }) {
    client = factory(name => {
      if (!(name in modules)) throw new Error(`Unknown Client dependency: ${name}`)
      return modules[name]
    })
  } } })
  runtime = await SlotTestRuntime.create()
  const locale = new LocaleRuntime(runtime.ctx); locale.setLocale('en')
  const bot = { id: 'sage', name: 'Sage', instructions: 'Review', preset: 'standard' }
  const state = { bots: [bot], rooms: [{ id: 'dm', title: 'Sage', kind: 'dm', defaultBot: bot.id,
    members: [{ botId: bot.id, sessionId: 'session', cursor: 0 }], messages: [] }] }
  const send = vi.fn(async () => ({ ok: true, value: {} }))
  const createBot = vi.fn(async request => ({ ok: true, value: request }))
  // Validate shipped codecs with the actual runtime registry, including 0.1's schema contract.
  const mount = vi.fn(async contribution => {
    const ctx = new Context()
    const fiber = await ctx.plugin(TypertRegistry)
    try {
      const dispose = ctx.typert.remotes.register(contribution)
      await dispose()
    } finally { await fiber.dispose() }
    return () => {}
  })
  await runtime.mount({ inject: ['slots'], async apply(ctx) {
    ctx.provide('locale', locale)
    ctx.slots.installLocale(locale)
    ctx.provide('layout', { toggleSidebar() {} })
    ctx.provide('uiWorkspace', { openSession() {} })
    const remote = { bots: { send, createBot }, $mount: mount, $stream: () => ({
      async *[Symbol.asyncIterator]() { yield { generation: 1, value: { type: 'baseline', value: state }, accept() {} } },
      async dispose() {}, restart() {},
    }) }
    // DSH 0.2's slot harness already owns a Remote double; 0.1 does not.
    if (runtime.remote) Object.assign(runtime.remote, remote)
    else ctx.provide('remote', remote)
    ctx.provide('remote.bots', { send, createBot })
    await client.apply(ctx)
  } })
  await runtime.root.declare({ main: { kind: 'keyed', scope: 'root' }, 'sidebar.panellist': { kind: 'list', scope: 'root' } },
    ({ renderSlot }) => <>{renderSlot('main', {}, { entryKey: 'bots' })}</>)
  Element.prototype.scrollIntoView = vi.fn()
  runtime.renderRoot()
  await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeDefined())
  expect(mount).toHaveBeenCalledOnce()
  expect(screen.getByRole('button', { name: 'Send' }).querySelector('svg')).not.toBeNull()
  fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'Archive compatibility check' } })
  expect(screen.getByRole('button', { name: 'Send' }).disabled).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  await waitFor(() => expect(send).toHaveBeenCalledWith(expect.objectContaining({ roomId: 'dm', text: 'Archive compatibility check' })))
  fireEvent.click(screen.getAllByRole('button', { name: 'Create Bot' })[0])
  fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Reviewer' } })
  fireEvent.change(screen.getByLabelText('Bot handle (ASCII)'), { target: { value: 'reviewer' } })
  fireEvent.change(screen.getByLabelText('Identity and responsibilities'), { target: { value: 'Review code' } })
  fireEvent.click(screen.getByRole('button', { name: 'Create' }))
  await waitFor(() => expect(createBot).toHaveBeenCalledWith(expect.objectContaining({ id: 'reviewer', name: 'Reviewer' })))
})
