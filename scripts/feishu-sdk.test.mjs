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

test('real SDK Axios errors preserve the nested group-information permission code', async () => {
  const { FeishuTransport } = await import(pathToFileURL(join(runtime, pluginPath, 'lib/types/feishu/sdk.js')))
  const { AxiosError } = createRequire(require.resolve(process.env.DSH_FEISHU_SDK_FILE || '@larksuiteoapi/node-sdk'))('axios')
  const states = []
  const httpInstance = {
    async post() { return { tenant_access_token: 'fixture-token', expire: 7200 } },
    async request() { throw new AxiosError('private SDK details', 'ERR_BAD_REQUEST', undefined, undefined, { status: 400, data: { code: 99991672 } }) },
  }
  const real = { ...sdk, Client: class extends sdk.Client { constructor(options) { super({ ...options, httpInstance, logger: silent }) } }, WSClient: class { async start() {} close() {} } }
  const transport = new FeishuTransport(real, { appId: 'cli_group_permission', appSecret: 'correct', brand: 'feishu', botOpenId: 'ou_bot', timeoutMs: 100,
    groupTitles: { groups: () => ['oc_group'], update: async () => {} }, groupNameStatus: state => states.push(state) }, async () => { throw new Error('No message expected') }, () => {}, () => {})
  try {
    transport.start()
    const deadline = Date.now() + 2000
    while (!states.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
    assert.deepEqual(states, ['permission-required'])
  } finally { await transport.close() }
})

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

test('real SDK uploads native image/file bytes and sends returned keys with stable delivery UUIDs', async () => {
  const { FeishuTransport } = await import(pathToFileURL(join(runtime, pluginPath, 'lib/types/feishu/sdk.js')))
  const uploads = [], sends = []
  const httpInstance = {
    async post() { return { tenant_access_token: 'fixture-token', expire: 7200 } },
    async request(options) {
      if (options.url.endsWith('/images') || options.url.endsWith('/files')) {
        uploads.push(options)
        assert.equal(options.headers['Content-Type'], 'multipart/form-data')
        return { code: 0, data: options.url.endsWith('/images') ? { image_key: 'img_uploaded' } : { file_key: 'file_uploaded' } }
      }
      sends.push(options.data)
      return { code: 0, data: { message_id: 'fixture' } }
    },
  }
  const real = { ...sdk, Client: class extends sdk.Client { constructor(options) { super({ ...options, httpInstance, logger: silent }) } }, WSClient: class { async start() {} close() {} } }
  const transport = new FeishuTransport(real, { appId: 'cli_upload', appSecret: 'correct', brand: 'feishu', botOpenId: 'ou_bot', timeoutMs: 100 }, async () => {}, () => {}, () => {}, undefined,
    async item => ({ name: item.attachment.name, mediaType: item.type === 'image' ? 'image/png' : 'application/octet-stream', base64: Buffer.from('bytes').toString('base64') }))
  const base = { conversation: { provider: 'feishu', accountId: 'cli_upload', kind: 'group', id: 'oc_group' }, text: '', user: 'ou_user', attempts: 0, nextAt: 0 }
  for (const type of ['image', 'file']) {
    const delivery = { ...base, id: 'output-' + type, attachment: { type, attachment: { attachmentId: 'sha256:' + 'a'.repeat(64), name: 'result.' + (type === 'image' ? 'png' : 'txt'), bytes: 5 } } }
    await transport.send(delivery); await transport.send(delivery)
  }
  assert.equal(uploads.length, 4)
  assert.deepEqual(sends.map(item => JSON.parse(item.content)), [{ image_key: 'img_uploaded' }, { image_key: 'img_uploaded' }, { file_key: 'file_uploaded' }, { file_key: 'file_uploaded' }])
  assert.equal(sends[0].uuid, sends[1].uuid)
  assert.equal(sends[2].uuid, sends[3].uuid)
  assert.notEqual(sends[0].uuid, sends[2].uuid)
  await transport.close()
})

test('real SDK HTTP permission failures stop media delivery while server and throttling failures remain retryable', async () => {
  const { FeishuTransport } = await import(pathToFileURL(join(runtime, pluginPath, 'lib/types/feishu/sdk.js')))
  let status = 400
  const httpInstance = {
    async post() { return { tenant_access_token: 'fixture-token', expire: 7200 } },
    async request() { throw { response: { status, data: { code: 99991672, msg: 'sensitive response' } } } },
  }
  const real = { ...sdk, Client: class extends sdk.Client { constructor(options) { super({ ...options, httpInstance, logger: silent }) } }, WSClient: class { async start() {} close() {} } }
  const transport = new FeishuTransport(real, { appId: 'cli_permission', appSecret: 'correct', brand: 'feishu', botOpenId: 'ou_bot', timeoutMs: 100 }, async () => {}, () => {}, () => {}, undefined,
    async () => ({ name: 'check.png', mediaType: 'image/png', base64: 'aGVsbG8=' }))
  const base = { id: 'permission', conversation: { provider: 'feishu', accountId: 'cli_permission', kind: 'group', id: 'oc_group' }, text: 'check', user: '', attempts: 0, nextAt: 0 }
  try {
    for (status of [400, 403, 429, 500, 503]) for (const media of [false, true]) {
      const delivery = { ...base, ...(media ? { attachment: { type: 'image', attachment: { attachmentId: 'sha256:' + 'a'.repeat(64), name: 'check.png', bytes: 5 } } } : {}) }
      const cause = await transport.send(delivery).catch(cause => cause)
      assert.equal(cause?.code === 'DSH_EXTERNAL_PERMANENT', status === 400 || status === 403)
      if (status === 400 || status === 403) assert.ok(!cause.message.includes('sensitive response'))
    }
  } finally { await transport.close() }
})
