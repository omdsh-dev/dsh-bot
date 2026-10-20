/** Real pinned Client and TokenManager, with only HTTP replaced by offline responses. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { root, runtime, pluginPath } from './common.mjs'
const require = createRequire(join(root, '.runtime/feishu-sdk/package.json'))
const sdk = require(process.env.DSH_FEISHU_SDK_FILE || '@larksuiteoapi/node-sdk')
const { identity, createGroup, GroupCreateError } = await import(pathToFileURL(join(runtime, pluginPath, 'lib/types/feishu/sdk.js')))
const silent = { error() {}, warn() {}, info() {}, debug() {}, trace() {} }

test('wrong secret cannot reuse a real SDK client token for the same app ID', async () => {
  let exchanges = 0
  const httpInstance = {
    async post(_url, data) {
      exchanges++
      if (data.app_secret !== 'correct') return { code: 10014, msg: 'invalid secret' }
      return { tenant_access_token: 'fixture-token', expire: 7200 }
    },
    async request(options) {
      assert.equal(options.headers.Authorization, 'Bearer fixture-token')
      return { code: 0, bot: { open_id: 'ou_robot', app_name: 'Fixture' } }
    },
  }
  const real = { ...sdk, Client: class extends sdk.Client { constructor(options) { super({ ...options, httpInstance, logger: silent }) } } }
  assert.equal((await identity(real, 'cli_cache_test', 'correct', 'feishu', 100)).openId, 'ou_robot')
  await assert.rejects(identity(real, 'cli_cache_test', 'wrong', 'feishu', 100))
  assert.equal(exchanges, 2)
})

test('real SDK preserves an uncertain HTTP 503 group outcome and reuses its uuid', async () => {
  const uuids = []
  const httpInstance = {
    async post() { return { tenant_access_token: 'fixture-token', expire: 7200 } },
    async request(options) {
      uuids.push(options.params.uuid)
      throw { response: { status: 503, data: { code: 99991672 } } }
    },
  }
  const real = { ...sdk, Client: class extends sdk.Client { constructor(options) { super({ ...options, httpInstance, logger: silent }) } } }
  for (let i = 0; i < 2; i++) {
    const cause = await createGroup(real, 'cli_group_test', 'correct', 'feishu', 100,
      { requestId: 'one-request', title: 'Team', owner: 'ou_owner', botAppIds: [] }).catch(cause => cause)
    assert.ok(cause instanceof Error && !(cause instanceof GroupCreateError))
  }
  assert.deepEqual(uuids, ['one-request', 'one-request'])
})
