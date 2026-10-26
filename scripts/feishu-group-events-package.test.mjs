/** Real packaged Host; DSH_FEISHU_SDK_FILE selects the pinned official dispatcher for qualification. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { root, run } from './common.mjs'
import { desktopModule, materializePackage, readReport } from './package-fixture.mjs'

test('Feishu join and rename events persist shared group names without chat-read permission or messages', { timeout: 120000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-feishu-events-')); let host
  try {
    const fixture = await materializePackage(home)
    const manifestPath = join(fixture.profile, 'package.json'), manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    const info = JSON.parse(await readFile(join(root, 'dist/feishu-package-info.json'), 'utf8'))
    const target = join(fixture.profile, 'node_modules', info.name); await mkdir(target, { recursive: true })
    run('tar', ['-xzf', join(root, 'dist', info.file), '--strip-components=1', '-C', target])
    manifest.dependencies[info.name] = info.version; manifest.dsh.profile.bundles.push(info.name)
    await writeFile(manifestPath, JSON.stringify(manifest))
    const sdk = join(fixture.profile, 'node_modules/@larksuiteoapi/node-sdk'); await mkdir(sdk, { recursive: true })
    await writeFile(join(sdk, 'package.json'), JSON.stringify({ name: '@larksuiteoapi/node-sdk', version: '1.75.0', main: 'index.cjs' }))
    await writeFile(join(sdk, 'index.cjs'), String.raw`
const EventDispatcher=process.env.DSH_FEISHU_SDK_FILE?require(process.env.DSH_FEISHU_SDK_FILE).EventDispatcher:class {
 register(handlers){this.handlers=handlers;return this;}
 async invoke({header,event}){return this.handlers[header.event_type]({[Symbol('event-type')]:header.event_type,...header,...event});}
};
const state={sockets:[],metadataReads:0};
class Client {
 constructor(options){this.appId=options.appId;}
 async request(options){
  if(options.method!=='GET')throw new Error('No remote mutations are allowed');
  if(options.url.startsWith('/open-apis/im/v1/chats/')){state.metadataReads++;return {code:99991672};}
  return {code:0,bot:{open_id:'ou_bot_'+this.appId,app_name:this.appId}};
 }
}
class WSClient {
 constructor(options){this.options=options;state.sockets.push(this);}
 async start({eventDispatcher}){this.dispatcher=eventDispatcher;this.active=true;this.options.onReady();}
 close(){this.active=false;}
}
module.exports={Client,WSClient,EventDispatcher,state,registerApp:async()=>{throw new Error('No registration');},defaultHttpInstance:{defaults:{timeout:0}}};
`)
    await writeFile(join(fixture.profile, 'cordis.patch.yml'), '- id: bot-feishu\n  config:\n    pollMs: 100\n- insert:\n    - id: group-events-test\n      name: ./driver.js\n')
    await writeFile(join(fixture.profile, 'driver.js'), String.raw`
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
export const inject=['botMode'];
export async function apply(ctx){
 const bot=ctx.botMode,sdk=createRequire(import.meta.url)(process.env.FEISHU_FIXTURE_SDK);
 const wait=async condition=>{const end=Date.now()+10000;while(!condition()){if(Date.now()>end)throw new Error('Events fixture timed out');await new Promise(resolve=>setTimeout(resolve,20));}};
 try {
  await wait(()=>bot.feishuSnapshot().available);
  if(process.env.FEISHU_PHASE==='first') {
   for(const id of ['alpha','beta']) {
    await bot.createBot({id,name:id,instructions:'Metadata fixture; no messages are sent.'});
    await bot.saveFeishuBinding({botId:id,appId:'cli_'+id,appSecret:'fixture-secret',brand:'feishu',allowUsers:[],allowGroups:id==='beta'?['oc_shared']:[],allowAllGroups:id==='alpha',admins:[]});
    await bot.toggleFeishuBinding({botId:id,enabled:true});
   }
  }
  await wait(()=>bot.feishuSnapshot().bindings.filter(b=>b.status==='connected').length===2);
  await wait(()=>bot.feishuSnapshot().bindings.find(b=>b.botId==='beta')?.groupNameStatus==='permission-required');
  assert.equal(bot.feishuSnapshot().bindings.find(b=>b.botId==='beta').status,'connected','Missing metadata permission must not mark messaging as broken');
  const emit=async(app,event_type,event,at)=>{
   const socket=sdk.state.sockets.findLast(s=>s.active&&s.options.appId===app);
   await socket.dispatcher.invoke({schema:'2.0',header:{event_type,app_id:app,create_time:String(at)},event},{needCheck:false});
  };
  if(process.env.FEISHU_PHASE==='first') {
   await emit('cli_alpha','im.chat.member.bot.added_v1',{chat_id:'oc_new',name:'新建项目群'},100);
   await emit('cli_alpha','im.chat.member.bot.added_v1',{chat_id:'oc_new',name:'新建项目群'},100);
   await emit('cli_alpha','im.chat.member.bot.added_v1',{chat_id:'oc_shared',name:'入群时名称'},100);
   await emit('cli_alpha','im.chat.updated_v1',{chat_id:'oc_shared',before_change:{name:'入群时名称'},after_change:{name:'最新共享群名'}},200);
   await emit('cli_alpha','im.chat.member.bot.added_v1',{chat_id:'oc_shared',name:'延迟旧名称'},150);
   await emit('cli_alpha','im.chat.updated_v1',{chat_id:'oc_shared',after_change:{avatar:'new'}},300);
   await emit('cli_beta','im.chat.member.bot.added_v1',{chat_id:'oc_unlisted',name:'不应接入'},400);
  }
  const rooms=bot.snapshot().rooms.filter(r=>r.external?.provider==='feishu');
  assert.equal(rooms.length,2);
  const added=rooms.find(r=>r.external.id==='oc_new'),shared=rooms.find(r=>r.external.id==='oc_shared');
  assert.equal(added.title,'新建项目群');assert.deepEqual(added.members.map(m=>m.botId),['alpha']);
  assert.equal(shared.title,'最新共享群名');assert.equal(shared.defaultBot,'beta');
  assert.deepEqual(shared.members.map(m=>m.botId).sort(),['alpha','beta']);
  assert.ok(rooms.every(r=>r.messages.length===0),'Metadata must not create messages or model work');
  assert.ok(sdk.state.metadataReads>0,'The fixture must exercise denied metadata reads');
  await writeFile(process.env.FEISHU_RESULT,JSON.stringify({ok:true,rooms}));
 }catch(error){await writeFile(process.env.FEISHU_RESULT,JSON.stringify({ok:false,error:String(error.stack||error)}));}
}
`)
    const { DesktopHostProcess } = await desktopModule('host-process'); let first
    for (const phase of ['first', 'resume']) {
      const result = join(home, phase + '.json')
      host = new DesktopHostProcess(process.execPath, fixture.resources, fixture.profile, undefined, { ...fixture.environment, DSH_HOME: home,
        FEISHU_FIXTURE_SDK: join(sdk, 'index.cjs'), FEISHU_PHASE: phase, FEISHU_RESULT: result })
      await host.start(); const report = await readReport(result)
      assert.equal(report.ok, true, report.error + '\n' + host.stderr)
      if (phase === 'first') first = report.rooms
      else assert.deepEqual(report.rooms, first, 'Names, IDs, members and empty histories survive restart with denied metadata APIs')
      await host.stop(); host = undefined
    }
  } finally { if (host) await host.stop(); await rm(home, { recursive: true, force: true }) }
})
