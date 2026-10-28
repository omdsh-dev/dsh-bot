/** Exercise two real Host robot bindings and shared group deduplication using an offline SDK. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { root, run } from './common.mjs'
import { desktopModule, materializePackage, readReport } from './package-fixture.mjs'

test('managed robots own separate identities and share a deduplicated group across restart', { timeout: 120000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-managed-infoflow-'))
  let host
  try {
    const fixture = await materializePackage(home)
    const info = JSON.parse(await readFile(join(root, 'dist/infoflow-package-info.json'), 'utf8'))
    const plugin = join(fixture.profile, 'node_modules', info.name)
    await mkdir(plugin, { recursive: true })
    run('tar', ['-xzf', join(root, 'dist', info.file), '--strip-components=1', '-C', plugin])
    const sdk = join(plugin, 'node_modules/@baidu/infoflow-sdk-nodejs')
    await mkdir(sdk, { recursive: true })
    await writeFile(join(sdk, 'package.json'), JSON.stringify({ name: '@baidu/infoflow-sdk-nodejs', version: '2026.8.28', main: 'index.cjs' }))
    await writeFile(join(sdk, 'index.cjs'), String.raw`
const { EventEmitter } = require('node:events');
const state = { sockets: [], sent: [], created: [] };
class Client {
  constructor(options) {
    const id = options.appKey === 'key-a' ? 11 : 22;
    this.robot = { getInfo: async () => ({ agentId: id, imId: id * 10 + 1, name: 'Robot ' + id }) };
    this.im = { message: {
      sendToUser: async (user, text) => { state.sent.push({ agentId: id, user, text }); },
      sendToGroupWithOptions: async value => { state.sent.push({ agentId: id, group: value.groupId, text: value.body.map(block => block.content || '').join('') }); }
    }, group: { getGroupInfo: async groupId => ({groupId,name:'如流实际群名',masterUserId:'alice'}), create: async options => { state.created.push(options); return { groupId: '777' }; } } };
  }
}
class WSClient {
  constructor(options) { this.key = options.appKey; this.eventDispatcher = new EventEmitter(); state.sockets.push(this); }
  on(event, callback) { this.eventDispatcher.on(event, callback); }
  async connect() { this.connected = true; this.eventDispatcher.emit('connected'); }
  disconnect() { this.connected = false; }
}
module.exports = { Client, WSClient, state };
`)
    const manifestPath = join(fixture.profile, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.dependencies[info.name] = info.version; manifest.dsh.profile.bundles.push(info.name)
    await writeFile(manifestPath, JSON.stringify(manifest))
    await writeFile(join(fixture.profile, 'cordis.patch.yml'), '- id: agent-default-model\n  config:\n    provider: bot-fixture\n    model: fixture\n- id: bot-infoflow\n  disabled: false\n  config:\n    managed: true\n    pollMs: 100\n- insert:\n    - id: managed-test\n      name: ./driver.js\n')
    await writeFile(join(fixture.profile, 'driver.js'), String.raw`
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
export const inject = ['botMode', 'llm'];
export async function apply(ctx) {
  let requests = 0;
  class Fixture extends LlmAdapter {
    async *stream(options) {
      if(options.purpose !== 'session-title') requests++;
      const text = 'managed fixture answer';
      yield { type:'block-start',index:0,blockType:'text' };
      yield { type:'text-delta',index:0,text };
      yield { type:'block-end',index:0,block:{type:'text',text} };
      yield { type:'finish',reason:{kind:'stop'} };
    }
  }
  ctx.llm.registerAdapter(['bot-fixture'], new Fixture());
  const wait = async predicate => { const deadline=Date.now()+15000; while(!predicate()) { if(Date.now()>deadline) throw new Error('Managed condition timed out'); await new Promise(resolve=>setTimeout(resolve,20)); } };
  try {
    const bot=ctx.botMode;
  await ctx.botMode.configureKnowledge({reviewEnabled:false}); // Count connector deliveries independently of background memory maintenance.
    await wait(()=>bot.infoflowSnapshot().available);
    const sdk=createRequire(import.meta.url)(process.env.MANAGED_SDK_FILE);
    if(process.env.MANAGED_PHASE === 'first') {
      for(const [id,key] of [['alpha','key-a'],['beta','key-b']]) {
        await bot.createBot({id,name:id,instructions:'Test robot '+id});
        await bot.saveInfoflowBinding({botId:id,appKey:key,appSecret:'test-secret',agentId:id==='alpha'?'11':'22',connect:true,allowAllGroups:id==='alpha',allowUsers:['alice'],allowGroups:[],admins:['alice']});
      }
      await bot.testInfoflowMessage({botId:'alpha',user:'alice'});
      assert.equal(sdk.state.sent.filter(item=>item.user==='alice'&&item.text.includes('DSH 如流连接测试')).length,1);
      assert.equal(requests,0);
      const unlisted={data:{raw:{groupid:'888',eventtype:'MESSAGE_RECEIVE',message:{header:{fromuserid:'visitor',messageid:'group-policy'},body:[{type:'AT',robotid:'111'},{type:'AT',robotid:'221'},{type:'TEXT',content:'/help'}]}}}};
      for(const socket of sdk.state.sockets) socket.eventDispatcher.emit('group.text',unlisted);
      await wait(()=>sdk.state.sent.some(item=>item.group==='888'));
      assert.deepEqual(sdk.state.sent.filter(item=>item.group==='888').map(item=>item.agentId),[11]);
      assert.equal(requests,0);
      const request={requestId:'managed-group-1',title:'Shared robots',botIds:['alpha','beta'],defaultBot:'alpha',owner:'alice',members:[]};
      assert.deepEqual(bot.infoflowSnapshot().groupInviteAllowlist,[]);
      await assert.rejects(bot.createInfoflowGroup(request),/白名单/);
      assert.equal(sdk.state.created.length,0);
      await bot.saveInfoflowGroupInviteAllowlist(['alice@baidu.com']);
      await assert.rejects(bot.createInfoflowGroup({...request,owner:'unapproved-colleague'}),/白名单/);
      await assert.rejects(bot.createInfoflowGroup({...request,members:['unapproved-colleague']}),/白名单/);
      assert.equal(sdk.state.created.length,0);
      const room=await bot.createInfoflowGroup(request);
      assert.equal((await bot.createInfoflowGroup(request)).id,room.id);
      assert.equal(sdk.state.created.length,1);
      assert.deepEqual(sdk.state.created[0].robotList,[11,22]);
      const payload={data:{raw:{groupid:'777',eventtype:'MESSAGE_RECEIVE',message:{header:{fromuserid:'alice',messageid:'group-one'},body:[{type:'AT',robotid:'111'},{type:'AT',robotid:'221'},{type:'TEXT',content:'work together'}]}}}};
      for(const socket of sdk.state.sockets) socket.eventDispatcher.emit('group.text',payload);
      await wait(()=>sdk.state.sent.filter(item=>item.group==='777'&&item.text.includes('managed fixture answer')).length===2);
      assert.equal(bot.snapshot().rooms.find(item=>item.id===room.id).title,'如流实际群名');
      const messages=bot.snapshot().rooms.find(item=>item.id===room.id).messages;
      assert.equal(messages.filter(item=>item.botId===null).length,1);
      assert.deepEqual(messages.filter(item=>item.botId).map(item=>item.botId).sort(),['alpha','beta']);
      assert.deepEqual(sdk.state.sent.filter(item=>item.text.includes('managed fixture answer')).map(item=>item.agentId).sort(),[11,22]);
      assert.ok(sdk.state.sent.filter(item=>item.text.includes('managed fixture answer')).every(item=>item.text==='managed fixture answer'),'Each robot supplies its identity; replies must not add an internal Bot ID');
      sdk.state.sockets.find(socket=>socket.key==='key-a').eventDispatcher.emit('private.text',{data:{raw:{FromUserId:'alice',MsgId:'private-one',Content:'private question'}}});
      await wait(()=>sdk.state.sent.some(item=>item.user==='alice'&&item.text.includes('managed fixture answer')));
      assert.equal(requests,3);
      const dm=bot.snapshot().rooms.find(item=>item.external?.kind==='private');
      assert.equal(dm.defaultBot,'alpha'); assert.equal(dm.members.length,1);
      await bot.toggleInfoflowBinding({botId:'alpha',enabled:false});
    } else {
      await wait(()=>bot.infoflowSnapshot().bindings.find(item=>item.botId==='beta')?.status==='connected');
      assert.equal(bot.infoflowSnapshot().bindings.find(item=>item.botId==='alpha').enabled,false);
      assert.equal(bot.infoflowSnapshot().bindings.find(item=>item.botId==='alpha').allowAllGroups,true);
      assert.equal(bot.infoflowSnapshot().bindings.find(item=>item.botId==='beta').allowAllGroups,false);
      assert.equal(bot.infoflowSnapshot().groups.length,1);
      assert.equal(requests,0);
    }
    const snapshot=bot.infoflowSnapshot();
    assert.ok(!JSON.stringify(snapshot).includes('test-secret'));
    await writeFile(process.env.MANAGED_RESULT,JSON.stringify({ok:true,requests,snapshot,rooms:bot.snapshot().rooms}));
  } catch(error) { await writeFile(process.env.MANAGED_RESULT,JSON.stringify({ok:false,error:String(error.stack||error)})); }
}
`)
    const { DesktopHostProcess } = await desktopModule('host-process')
    let first
    for (const phase of ['first', 'resume']) {
      const result = join(home, phase + '.json')
      host = new DesktopHostProcess(process.execPath, fixture.resources, fixture.profile, undefined, { ...fixture.environment, DSH_HOME: home,
        MANAGED_SDK_FILE: join(sdk, 'index.cjs'), MANAGED_PHASE: phase, MANAGED_RESULT: result })
      await host.start()
      const report = await readReport(result)
      assert.equal(report.ok, true, report.error + '\n' + host.stderr)
      const group = report.rooms.find(room => room.external?.id === '777')
      assert.equal(group.title, '如流实际群名')
      if (phase === 'first') first = group
      else assert.deepEqual(group, first)
      await host.stop(); host = undefined
    }
  } finally { await host?.stop(); await rm(home, { recursive: true, force: true }) }
})
