/** Pinned InfoFlow SDK wire encoding with HTTP replaced; never sends live messages. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { root, runtime, pluginPath } from './common.mjs'
const require = createRequire(join(root, 'package.json'))
const sdk = require(process.env.DSH_INFOFLOW_SDK_FILE || '@baidu/infoflow-sdk-nodejs')
const { InfoFlowTransport } = await import(pathToFileURL(join(runtime, pluginPath, 'lib/types/infoflow/sdk.js')))

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
