/** Pinned InfoFlow SDK wire encoding with HTTP replaced; never sends live messages. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { root, runtime, pluginPath } from './common.mjs'
const require = createRequire(join(root, 'package.json'))
const sdk = require(process.env.DSH_INFOFLOW_SDK_FILE || '@baidu/infoflow-sdk-nodejs')
const { InfoFlowTransport, robotApi } = await import(pathToFileURL(join(runtime, pluginPath, 'lib/types/infoflow/sdk.js')))

test('real InfoFlow group SDK keeps approved human accounts separate from robot Agent IDs and adds no implicit colleague', async () => {
  const requests = []
  const real = { ...sdk, Client: class extends sdk.Client {
    constructor(options) {
      super(options)
      this.im.group.httpClient.post = async (url, body) => { requests.push({ url, body }); return { errcode: 0, data: { groupId: 777 } } }
    }
  } }
  const api = robotApi(real, { appKey: 'fixture', appSecret: 'fixture', agentId: '11', timeout: 100 })
  for (const members of [[], ['approved-colleague']]) {
    await api.createGroup({ groupName: 'Fixture', groupOwner: 'approved-owner', memberList: members, robotList: [11, 22] })
    assert.deepEqual(requests.at(-1), { url: '/robot/group/create', body: {
      friendlyLevel: 3, searchAbility: 0, groupName: 'Fixture', groupOwner: 'approved-owner@baidu.com', memberList: members.map(user => user + '@baidu.com'), robotList: [11, 22], managers: undefined,
    } })
  }
})

test('real InfoFlow SDK encodes private/group images and file links without persisting signed URLs', async () => {
  const requests = []
  const real = { ...sdk, Client: class extends sdk.Client {
    constructor(options) {
      super(options)
      this.im.message.httpClient.post = async (url, body) => {
        requests.push({ url, body })
        return { errcode: 0, data: { msgkey: 'fixture', messageid: '1', msgseqid: '1' } }
      }
      this.im.file.upload = async () => ({ url: 'https://fixture.bcebos.com/file?signed=temporary' })
    }
  }, WSClient: class { on() {} async connect() {} disconnect() {} } }
  const config = { accountId: '11', robotId: '111', appKey: 'fixture', appSecret: 'fixture', baseUrl: '', wsGateway: '', wsConnectDomain: '', endpointTimeoutMs: 100, sendTimeoutMs: 100, connectRetryMs: 10, maxConnectRetryMs: 100,
    read: async item => ({ name: item.attachment.name, mediaType: item.type === 'image' ? 'image/png' : 'application/octet-stream', base64: 'aGVsbG8=' }) }
  const transport = new InfoFlowTransport(real, config, async () => {}, () => {})
  for (const kind of ['private', 'group']) for (const type of ['image', 'file']) {
    const delivery = { id: `${kind}:${type}`, conversation: { provider: 'infoflow', accountId: '11', kind, id: kind === 'group' ? '123' : 'alice' }, user: 'alice', text: '', attempts: 0, nextAt: 0,
      attachment: { type, attachment: { attachmentId: 'sha256:' + 'a'.repeat(64), name: 'result', bytes: 5 } } }
    await transport.send(delivery)
    assert.ok(!JSON.stringify(delivery).includes('signed='))
  }
  assert.deepEqual(requests[0].body.image, { content: 'aGVsbG8=' })
  assert.equal(requests[1].body.richtext.content[1].type, 'a')
  assert.deepEqual(requests[2].body.message.body, [{ type: 'IMAGE', content: 'aGVsbG8=' }])
  assert.equal(requests[3].body.message.body[1].type, 'LINK')
  await transport.close()
})

test('a retry reuses an uploaded BOS object after an uncertain URL lookup instead of being stuck on 40900', async () => {
  let uploads = 0, lookups = 0
  const sends = [], objectKey = 'dsh-bot/' + (await import('node:crypto')).createHash('sha256').update('file-retry').digest('hex')
  const real = { ...sdk, Client: class extends sdk.Client {
    constructor(options) {
      super(options)
      this.im.message.httpClient.post = async (_url, body) => { sends.push(body); return { errcode: 0, data: { msgkey: 'fixture', messageid: '1', msgseqid: '1' } } }
      this.im.file.httpClient.postBosFileUpload = async () => ++uploads === 1
        ? { code: 200, data: { object_key: objectKey } }
        : { code: 40900, message: '文件已存在，禁止覆盖', data: null }
      this.im.file.httpClient.getBosFileUrl = async query => {
        assert.equal(query.objectKey, objectKey)
        if (++lookups === 1) throw new Error('Connection lost after upload')
        return { code: 200, data: { url: 'https://fixture.bcebos.com/file?signed=temporary' } }
      }
    }
  }, WSClient: class { on() {} async connect() {} disconnect() {} } }
  const transport = new InfoFlowTransport(real, { accountId: '11', robotId: '111', appKey: 'fixture', appSecret: 'fixture', baseUrl: '', wsGateway: '', wsConnectDomain: '', endpointTimeoutMs: 100, sendTimeoutMs: 100, connectRetryMs: 10, maxConnectRetryMs: 100,
    read: async () => ({ name: 'retry.txt', mediaType: 'text/plain', base64: 'aGVsbG8=' }) }, async () => {}, () => {})
  const delivery = { id: 'file-retry', conversation: { provider: 'infoflow', accountId: '11', kind: 'group', id: '123' }, user: '', text: '', attempts: 0, nextAt: 0,
    attachment: { type: 'file', attachment: { attachmentId: 'sha256:' + 'a'.repeat(64), name: 'retry.txt', bytes: 5 } } }
  try {
    await assert.rejects(transport.send(delivery))
    await transport.send(delivery)
    assert.equal(uploads, 2); assert.equal(lookups, 2); assert.equal(sends.length, 1)
    assert.equal(sends[0].message.body[1].type, 'LINK')
    assert.ok(!JSON.stringify(delivery).includes('signed='))
  } finally { await transport.close() }
})

test('BOS HTTP links use HTTPS with their signed query preserved, and unsafe alternatives are rejected before sending', async () => {
  let uploadedUrl
  const sends = []
  const real = { ...sdk, Client: class extends sdk.Client {
    constructor(options) {
      super(options)
      this.im.file.upload = async () => ({ url: uploadedUrl })
      this.im.message.httpClient.post = async (_url, body) => { sends.push(body); return { errcode: 0, data: { msgkey: 'fixture', messageid: '1', msgseqid: '1' } } }
    }
  }, WSClient: class { on() {} async connect() {} disconnect() {} } }
  const transport = new InfoFlowTransport(real, { accountId: '11', robotId: '111', appKey: 'fixture', appSecret: 'fixture', baseUrl: '', wsGateway: '', wsConnectDomain: '', endpointTimeoutMs: 100, sendTimeoutMs: 100, connectRetryMs: 10, maxConnectRetryMs: 100,
    read: async () => ({ name: 'file.txt', mediaType: 'text/plain', base64: 'aGVsbG8=' }) }, async () => {}, () => {})
  const delivery = { id: 'file-tls', conversation: { provider: 'infoflow', accountId: '11', kind: 'group', id: '123' }, user: '', text: '', attempts: 0, nextAt: 0,
    attachment: { type: 'file', attachment: { attachmentId: 'sha256:' + 'a'.repeat(64), name: 'file.txt', bytes: 5 } } }
  try {
    for (const kind of ['group', 'private']) {
      uploadedUrl = 'http://common-archive.bj.bcebos.com/test/file?authorization=a%2Fb&name=a+b'
      await transport.send({ ...delivery, conversation: { ...delivery.conversation, kind } })
      const sent = sends.at(-1)
      assert.equal(kind === 'group' ? sent.message.body[1].href : sent.richtext.content[1].href, uploadedUrl.replace('http:', 'https:'))
    }
    for (const url of ['http://example.com/file', 'http://bcebos.com.example.com/file', 'http://fakebcebos.com/file', 'http://common-archive.bj.bcebos.com:8080/file', 'https://user:pass@common-archive.bj.bcebos.com/file', 'file:///tmp/file']) {
      uploadedUrl = url
      await assert.rejects(transport.send(delivery), { code: 'DSH_EXTERNAL_PERMANENT', message: 'Invalid uploaded media URL' })
    }
    assert.equal(sends.length, 2)
  } finally { await transport.close() }
})
