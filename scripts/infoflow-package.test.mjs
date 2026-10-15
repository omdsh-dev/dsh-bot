/** Boot the actual companion archive in a native Desktop Host with a fixture SDK and model. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { root, run } from './common.mjs'
import { desktopModule, materializePackage, readReport } from './package-fixture.mjs'

test('the optional archive resolves Host dependencies, receives through the SDK, and sends the native Bot result', { timeout: 120000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-infoflow-package-'))
  let host
  try {
    const fixture = await materializePackage(home)
    const { DesktopHostProcess } = await desktopModule('host-process')
    const first = join(home, 'first.json')
    host = new DesktopHostProcess(process.execPath, fixture.resources, fixture.profile, undefined,
      { ...fixture.environment, DSH_HOME: home, BOT_TEST_PHASE: 'first', BOT_TEST_RESULT: first })
    await host.start()
    const seed = await readReport(first)
    assert.equal(seed.ok, true, seed.error)
    await host.stop(); host = undefined
    const info = JSON.parse(await readFile(join(root, 'dist/infoflow-package-info.json'), 'utf8'))
    const plugin = join(fixture.profile, 'node_modules', info.name)
    await mkdir(plugin, { recursive: true })
    run('tar', ['-xzf', join(root, 'dist', info.file), '--strip-components=1', '-C', plugin])
    const sdk = join(plugin, 'node_modules/@baidu/infoflow-sdk-nodejs')
    await mkdir(sdk, { recursive: true })
    await writeFile(join(sdk, 'package.json'), JSON.stringify({ name: '@baidu/infoflow-sdk-nodejs', version: '2026.8.28', main: 'index.cjs' }))
    await writeFile(join(sdk, 'index.cjs'), String.raw`
const { EventEmitter } = require('node:events');
const { appendFileSync, existsSync } = require('node:fs');
class Client {
  im = { message: {
    sendToUser: async (user, text, type) => { appendFileSync(process.env.INFOFLOW_TEST_REPORT, JSON.stringify({ user, text, type }) + '\n'); },
    sendToGroupWithOptions: async () => { throw new Error('fixture only admits DMs'); }
  } };
}
class WSClient {
  eventDispatcher = new EventEmitter();
  on(event, callback) { this.eventDispatcher.on(event, callback); }
  async connect() {
    this.eventDispatcher.emit('connected');
    const receive = () => {
      if (!existsSync(process.env.BOT_TEST_RESULT)) { this.timer = setTimeout(receive, 50); return; }
      this.eventDispatcher.emit('private.text', { data: { raw: {
        FromUserId: 'alice', MsgId: '9223372036854775807', Content: 'fixture external request'
      } } });
    };
    this.timer = setTimeout(receive, 50);
  }
  disconnect() { clearTimeout(this.timer); }
}
module.exports = { Client, WSClient };
`)
    const manifestPath = join(fixture.profile, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.dependencies[info.name] = info.version
    manifest.dsh.profile.bundles.push(info.name)
    await writeFile(manifestPath, JSON.stringify(manifest))
    fixture.validate()
    const patchPath = join(fixture.profile, 'cordis.patch.yml')
    await writeFile(patchPath, await readFile(patchPath, 'utf8') + '\n- id: bot-infoflow\n  disabled: false\n  config:\n    managed: false\n    accountId: fixture\n    robotId: robot\n    appKeyRef: INFOFLOW_TEST_KEY\n    appSecretRef: INFOFLOW_TEST_SECRET\n    botIds: [architect, critic]\n    defaultBot: architect\n    allowUsers: [alice]\n    pollMs: 100\n')
    const second = join(home, 'resume.json')
    const delivery = join(home, 'deliveries.jsonl')
    host = new DesktopHostProcess(process.execPath, fixture.resources, fixture.profile, undefined,
      { ...fixture.environment, DSH_HOME: home, BOT_TEST_PHASE: 'resume', BOT_TEST_RESULT: second,
        INFOFLOW_TEST_KEY: 'synthetic-key', INFOFLOW_TEST_SECRET: 'synthetic-secret', INFOFLOW_TEST_REPORT: delivery })
    await host.start()
    const report = await readReport(second)
    assert.equal(report.ok, true, report.error)
    const deadline = Date.now() + 30000
    let messages = []
    while (Date.now() < deadline) {
      try { messages = (await readFile(delivery, 'utf8')).trim().split('\n').map(line => JSON.parse(line)) }
      catch (error) { if (error.code !== 'ENOENT') throw error }
      if (messages.some(message => message.text.includes('fixture answer'))) break
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    assert.ok(messages.some(message => message.text.includes('已接收')), host.stderr)
    assert.ok(messages.some(message => message.text.includes('@architect\nfixture answer')), host.stderr)
    assert.ok(messages.every(message => message.user === 'alice' && message.type === 'md'))
  } finally {
    await host?.stop()
    await rm(home, { recursive: true, force: true })
  }
})
