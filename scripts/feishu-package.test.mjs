/** Real packaged Host, offline official-SDK contract, two apps and durable replay protection. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { root, run } from './common.mjs'
import { desktopModule, materializePackage, readReport } from './package-fixture.mjs'

test('shared Feishu groups route each robot once while preserving DM isolation and restart state', { timeout: 120000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-feishu-package-')); let host
  try {
    const fixture = await materializePackage(home)
    const manifestPath = join(fixture.profile, 'package.json'), manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    for (const name of ['infoflow', 'feishu']) {
      const info = JSON.parse(await readFile(join(root, `dist/${name}-package-info.json`), 'utf8'))
      const target = join(fixture.profile, 'node_modules', info.name); await mkdir(target, { recursive: true })
      run('tar', ['-xzf', join(root, 'dist', info.file), '--strip-components=1', '-C', target])
      manifest.dependencies[info.name] = info.version; manifest.dsh.profile.bundles.push(info.name)
    }
    await writeFile(manifestPath, JSON.stringify(manifest))
    const sdk = join(fixture.profile, 'node_modules/@larksuiteoapi/node-sdk'); await mkdir(sdk, { recursive: true })
    await writeFile(join(sdk, 'package.json'), JSON.stringify({ name: '@larksuiteoapi/node-sdk', version: '1.75.0', main: 'index.cjs' }))
    await writeFile(join(sdk, 'index.cjs'), String.raw`
const state = { sockets: [], sent: [], groups: [], registrations: 0, authorizations: [] };
class Client {
 constructor(options) { this.appId=options.appId; }
 async request(options) {
  if(options.method==='GET'&&options.url.startsWith('/open-apis/im/v1/chats/')) return {code:0,data:{name:'飞书实际群名'}};
  if(options.method==='GET') return {code:0,bot:{open_id:'ou_bot_'+this.appId,app_name:'Robot '+this.appId}};
  if(options.url==='/open-apis/im/v1/chats') { state.groups.push(options); return {code:0,data:{chat_id:'oc_shared_group'}}; }
  state.sent.push({appId:this.appId,...options.data}); return {code:0};
 }
}
const EventDispatcher = process.env.DSH_FEISHU_SDK_FILE ? require(process.env.DSH_FEISHU_SDK_FILE).EventDispatcher : class {
 register(handlers) { this.handlers=handlers; return this; }
 async invoke({header,event}) {
  // Match official EventDispatcher.parse, including its enumerable symbol metadata.
  return this.handlers[header.event_type]({[Symbol('event-type')]:header.event_type,...header,...event});
 }
}
class WSClient {
 constructor(options) { this.options=options; state.sockets.push(this); }
 async start({eventDispatcher}) { this.dispatcher=eventDispatcher; this.active=true; this.options.onReady(); }
 close() { this.active=false; }
}
async function registerApp(options) {
 if(options.appId) {
  if(options.createOnly) throw new Error('Unexpected create-only for an existing app');
  state.authorizations.push(options);
  options.onQRCodeReady({url:'https://accounts.feishu.cn/fixture',expireIn:600});
  await new Promise(resolve=>setTimeout(resolve,30));
  return {client_id:options.appId,client_secret:'returned-existing-secret',user_info:{open_id:'ou_different_operator',tenant_brand:'feishu'}};
 }
 if(!options.createOnly) throw new Error('Expected create-only');
 state.registrations++; options.onQRCodeReady({url:'https://accounts.feishu.cn/fixture',expireIn:600});
 await new Promise(resolve=>setTimeout(resolve,30));
 return {client_id:'cli_alpha',client_secret:'offline-secret-alpha',user_info:{open_id:'ou_alpha_owner',tenant_brand:'feishu'}};
}
module.exports={Client,EventDispatcher,WSClient,registerApp,state,defaultHttpInstance:{defaults:{timeout:0}}};
`)
    const qr = join(fixture.profile, 'node_modules/qrcode'); await mkdir(qr, { recursive: true })
    await writeFile(join(qr, 'package.json'), '{"name":"qrcode","version":"1.5.4","main":"index.cjs"}')
    await writeFile(join(qr, 'index.cjs'), "module.exports={toDataURL:async()=> 'data:image/png;base64,fixture'};")
    await writeFile(join(fixture.profile, 'cordis.patch.yml'), '- id: agent-default-model\n  config:\n    provider: bot-fixture\n    model: fixture\n- id: bot-infoflow\n  disabled: false\n  config:\n    managed: true\n- id: bot-feishu\n  config:\n    pollMs: 100\n- insert:\n    - id: feishu-test\n      name: ./driver.js\n')
    await writeFile(join(fixture.profile, 'driver.js'), String.raw`
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
export const inject=['botMode','llm'];
export async function apply(ctx) {
 let requests=0; const modelRequests=[];
 class Fixture extends LlmAdapter {
  async *stream(options) {
   if(options.purpose!=='session-title') { requests++; modelRequests.push(options); }
   const text='Feishu fixture answer';
   yield {type:'block-start',index:0,blockType:'text'};
   yield {type:'text-delta',index:0,text};
   yield {type:'block-end',index:0,block:{type:'text',text}};
   yield {type:'finish',reason:{kind:'stop'}};
  }
 }
 ctx.llm.registerAdapter(['bot-fixture'],new Fixture());
 const wait=async predicate=>{const end=Date.now()+15000;while(!predicate()){if(Date.now()>end)throw new Error('Feishu fixture timed out');await new Promise(resolve=>setTimeout(resolve,20));}};
 try {
  const bot=ctx.botMode,sdk=createRequire(import.meta.url)(process.env.FEISHU_SDK_FILE);
  await ctx.botMode.configureKnowledge({reviewEnabled:false}); // Count connector deliveries independently of background memory maintenance.
  await wait(()=>bot.feishuSnapshot().available&&bot.infoflowSnapshot().available);
  assert.equal(bot.infoflowSnapshot().bindings.length,0);
  if(process.env.FEISHU_PHASE==='first') {
   for(const id of ['alpha','beta']) await bot.createBot({id,name:id,instructions:'PERSONA_'+id.toUpperCase()});
   const registration=await bot.registerFeishuBot('alpha');
   assert.equal((await bot.registerFeishuBot('alpha')).attemptId,registration.attemptId);
   await wait(()=>bot.feishuSnapshot().registrations[0]?.status==='complete');
   assert.equal(sdk.state.registrations,1);
   assert.equal(bot.feishuSnapshot().bindings[0].enabled,false);
   assert.deepEqual(bot.feishuSnapshot().bindings[0].allowUsers,['ou_alpha_owner']);
   await bot.saveFeishuBinding({botId:'beta',appId:'cli_beta',appSecret:'offline-secret-beta',brand:'feishu',allowUsers:['ou_beta_owner'],allowGroups:[],admins:['ou_beta_owner']});
   const beforePermissions=bot.feishuSnapshot().bindings.find(item=>item.botId==='beta');
   const permissionAttempt=await bot.authorizeFeishuBot('beta');
   assert.equal(permissionAttempt.purpose,'permissions');
   assert.equal((await bot.authorizeFeishuBot('beta')).attemptId,permissionAttempt.attemptId);
   await wait(()=>bot.feishuSnapshot().registrations.find(item=>item.botId==='beta')?.status==='complete');
   assert.deepEqual(bot.feishuSnapshot().bindings.find(item=>item.botId==='beta'),beforePermissions);
   assert.equal(sdk.state.registrations,1,'Existing-app consent must not create another app');
   assert.equal(sdk.state.authorizations.length,1);
   assert.deepEqual(sdk.state.authorizations[0].addons,{preset:false,scopes:{tenant:['im:message.p2p_msg:readonly', 'im:message.group_at_msg:readonly', 'im:message:send_as_bot', 'im:message:readonly', 'im:resource', 'im:chat:read', 'im:chat:create', 'im:chat.members:bot_access']}});
   for(const id of ['alpha','beta']) {
    const binding=bot.feishuSnapshot().bindings.find(item=>item.botId===id);
    await bot.toggleFeishuBinding({botId:id,enabled:true});
   }
   const created=await bot.createFeishuGroup({requestId:'native-group-request',title:'Managed Feishu group',botIds:['alpha','beta'],creatorBot:'alpha'});
   assert.equal(created.external.id,'oc_shared_group');
   await bot.resumeFeishuGroup('native-group-request');
   assert.equal(sdk.state.groups.length,1,'Retry must not create another remote group');
   assert.deepEqual(sdk.state.groups[0].data.bot_id_list,['cli_beta']);
   assert.equal(sdk.state.groups[0].data.owner_id,'ou_alpha_owner');
   assert.ok(bot.feishuSnapshot().bindings.every(binding=>binding.allowGroups.includes('oc_shared_group')));
   const settled=async roomId=>wait(()=>bot.snapshot().rooms.find(room=>room.id===roomId).messages.at(-1)?.status==='complete');
   const dm=bot.snapshot().rooms.find(room=>!room.external&&room.kind==='dm'&&room.defaultBot==='alpha');
   await bot.send({roomId:dm.id,text:'WEB_DM_ALPHA'}); await settled(dm.id);
   // The explicit Web @mention wins over a different default responder.
   const group=await bot.createGroup({title:'Web entry',botIds:['alpha','beta'],defaultBot:'beta'});
   await bot.send({roomId:group.id,text:'@alpha WEB_GROUP_ALPHA'}); await settled(group.id);
   assert.deepEqual(bot.snapshot().rooms.find(room=>room.id===group.id).messages.filter(m=>m.botId).map(m=>m.botId),['alpha']);
   assert.equal(sdk.state.sent.length,0,'Web replies must stay in Web');
  }
  await wait(()=>bot.feishuSnapshot().bindings.filter(b=>b.status==='connected').length===2);
  if(process.env.FEISHU_PHASE==='migrate') {
   await wait(()=>sdk.state.sent.some(s=>s.content.includes('Feishu fixture answer')));
   const rooms=bot.snapshot().rooms.filter(r=>r.external?.provider==='feishu');
   const group=rooms.find(r=>r.kind==='group');
   assert.equal(rooms.length,3); assert.equal(group.members.length,2);
   assert.equal(group.messages.filter(m=>m.external?.id==='om_multi').length,1);
   assert.equal(bot.feishuSnapshot().groups[0].roomId,group.id);
   assert.equal(requests,0,'Migration and retained reply delivery cannot rerun a model');
   assert.equal(sdk.state.sent.length,1); assert.equal(sdk.state.sent[0].appId,'cli_beta'); assert.equal(sdk.state.sent[0].receive_id,'oc_shared_group');
   assert.ok(group.aliases.includes(group.id+'-legacy-beta'));
   await writeFile(process.env.FEISHU_RESULT,JSON.stringify({ok:true,requests,rooms})); return;
  }
  const emit=async(appId,sender,kind='p2p',id='om_shared',chatId=kind==='p2p'?'oc_same_chat':'oc_shared_group',mention='ou_bot_'+appId)=>{
   const socket=sdk.state.sockets.findLast(s=>s.active&&s.options.appId===appId);
   const text=kind==='p2p'?'FS_DM_'+appId.slice(4).toUpperCase():'@_user_1 FS_GROUP_'+appId.slice(4).toUpperCase()+' @other';
   await socket.dispatcher.invoke({schema:'2.0',header:{event_type:'im.message.receive_v1',app_id:appId},event:{sender:{sender_type:'user',sender_id:{open_id:sender}},message:{message_id:id,chat_id:chatId,chat_type:kind,message_type:'text',content:JSON.stringify({text}),mentions:mention?[{key:'@_user_1',id:{open_id:mention}}]:[]}}},{needCheck:false});
  };
  // No model invocation for an unlisted group, another app's user, or absent/wrong platform mentions.
  await emit('cli_alpha','ou_alpha_owner','group','om_blocked_group','oc_unlisted');
  await emit('cli_alpha','ou_beta_owner','p2p','om_blocked_user');
  await emit('cli_alpha','ou_alpha_owner','group','om_no_at','oc_shared_group','');
  await emit('cli_alpha','ou_alpha_owner','group','om_wrong_at','oc_shared_group','ou_bot_cli_beta');
  for(const id of ['alpha','beta']) for(const kind of ['p2p','group']) {
   const messageId=kind==='group'?'om_group_'+id:'om_shared';
   await emit('cli_'+id,'ou_'+id+'_owner',kind,messageId);
   await emit('cli_'+id,'ou_'+id+'_owner',kind,messageId);
   if(process.env.FEISHU_PHASE==='first') await wait(()=>sdk.state.sent.some(s=>s.appId==='cli_'+id&&s.receive_id===(kind==='group'?'oc_shared_group':'oc_same_chat')&&s.content.includes('Feishu fixture answer')));
  }
  if(process.env.FEISHU_PHASE==='first') {
   await wait(()=>sdk.state.sent.filter(s=>s.content.includes('Feishu fixture answer')).length===4);
   assert.equal(requests,6,'Two Web requests plus four Feishu requests; duplicates and rejected inputs must not execute');
   const results=sdk.state.sent.filter(s=>s.content.includes('Feishu fixture answer'));
   assert.deepEqual(results.map(s=>[s.appId,s.receive_id]).sort(),[
    ['cli_alpha','oc_same_chat'],['cli_alpha','oc_shared_group'],['cli_beta','oc_same_chat'],['cli_beta','oc_shared_group']].sort());
   const markers=['WEB_DM_ALPHA','WEB_GROUP_ALPHA','FS_DM_ALPHA','FS_GROUP_ALPHA','FS_DM_BETA','FS_GROUP_BETA'];
   const toolNames=request=>(request.tools??[]).map(tool=>tool.name).sort();
   assert.ok(toolNames(modelRequests[0]).length>0,'The native Bot preset must expose its real tools');
   for(const marker of markers) {
    const request=modelRequests.find(r=>JSON.stringify(r.messages).includes(marker));
    assert.ok(request,'Missing model request for '+marker);
    const system=JSON.stringify(request.messages.filter(m=>m.role==='system'));
    assert.ok(system.includes(marker.endsWith('ALPHA')?'PERSONA_ALPHA':'PERSONA_BETA'),'All four entry points must use the selected Bot identity');
    const commonTools=value=>toolNames(value).filter(name=>!['create_bot','set_group_name'].includes(name));
    assert.deepEqual(commonTools(request),commonTools(modelRequests[0]),'All entry points use the same native tool preset');
    assert.equal(toolNames(request).includes('set_group_name'),marker.startsWith('FS_GROUP'),'Only IM groups receive group naming');
    assert.equal(toolNames(request).includes('create_bot'),marker.startsWith('FS_'),'Only authenticated IM admins receive narrow Bot creation');
    assert.ok(!toolNames(request).some(name=>name==='team_manage'||name==='team_list'));
    for(const other of markers) if(other!==marker && !(marker.startsWith('FS_GROUP_')&&other.startsWith('FS_GROUP_'))) assert.ok(!JSON.stringify(request.messages).includes(other),'Conversation history leaked from '+other+' to '+marker);
    if(marker==='FS_GROUP_BETA') assert.ok(JSON.stringify(request.messages).includes('FS_GROUP_ALPHA'),'The second Bot sees the same group history');
   }
   // The same message is delivered separately to both mentioned apps, with app-scoped sender IDs.
   // Let alpha finish first to prove a late beta callback still adds its response without adding another human row.
  } else {
   await new Promise(resolve=>setTimeout(resolve,250));
   assert.equal(requests,0); assert.equal(sdk.state.sent.length,0); assert.equal(sdk.state.registrations,0);
  }
  const multi=async appId=>{
   const socket=sdk.state.sockets.findLast(s=>s.active&&s.options.appId===appId);
   await socket.dispatcher.invoke({schema:'2.0',header:{event_type:'im.message.receive_v1',app_id:appId},event:{sender:{sender_type:'user',sender_id:{open_id:appId==='cli_alpha'?'ou_alpha_owner':'ou_beta_owner'}},message:{message_id:'om_multi',chat_id:'oc_shared_group',chat_type:'group',message_type:'text',content:JSON.stringify({text:'@_user_1 @_user_2 MULTI_TARGET'}),mentions:[{key:'@_user_1',id:{open_id:'ou_bot_cli_alpha'}},{key:'@_user_2',id:{open_id:'ou_bot_cli_beta'}}]}}},{needCheck:false});
  };
  for(const appId of ['cli_alpha','cli_beta']) {
   await multi(appId); await multi(appId);
   if(process.env.FEISHU_PHASE==='first') await wait(()=>bot.snapshot().rooms.find(r=>r.external?.id==='oc_shared_group')?.messages.some(m=>m.botId===appId.slice(4)&&m.status==='complete'&&m.replyTo===bot.snapshot().rooms.find(r=>r.external?.id==='oc_shared_group')?.messages.find(m=>m.external?.id==='om_multi')?.id));
  }
  if(process.env.FEISHU_PHASE==='first') { await wait(()=>sdk.state.sent.filter(s=>s.content.includes('Feishu fixture answer')).length===6); assert.equal(requests,8); }
  else { await new Promise(resolve=>setTimeout(resolve,250)); assert.equal(requests,0); assert.equal(sdk.state.sent.length,0); }
  const rooms=bot.snapshot().rooms.filter(r=>r.external?.provider==='feishu');
  assert.equal(rooms.length,3);
  const alphaRooms=bot.snapshot().rooms.filter(r=>r.members.some(m=>m.botId==='alpha'));
  assert.equal(alphaRooms.length,4);
  assert.equal(new Set(alphaRooms.map(r=>r.members.find(m=>m.botId==='alpha').sessionId)).size,4);
  for(const room of rooms) {
   const shared=room.kind==='group';
   assert.equal(room.messages.filter(m=>m.botId===null).length,shared?3:1); assert.equal(room.members.length,shared?2:1);
   assert.ok(!room.messages.some(m=>m.text.includes('@_user_1')||m.text.includes('@_user_2')),'Strip all platform mention placeholders');
   if(shared) {
    const human=room.messages.find(m=>m.external?.id==='om_multi');
    assert.deepEqual(room.messages.filter(m=>m.replyTo===human.id).map(m=>m.botId).sort(),['alpha','beta']);
    assert.deepEqual(human.external.sources.map(s=>s.accountId).sort(),['cli_alpha','cli_beta']);
    assert.equal(room.title,'飞书实际群名');
   }
  }
  assert.equal(bot.feishuSnapshot().groups[0].status,'ready');
  if(process.env.FEISHU_PHASE!=='first') assert.equal(sdk.state.groups.length,0);
  assert.ok(!JSON.stringify(bot.feishuSnapshot()).includes('offline-secret'));
  await writeFile(process.env.FEISHU_RESULT,JSON.stringify({ok:true,requests,rooms}));
 } catch(error) {await writeFile(process.env.FEISHU_RESULT,JSON.stringify({ok:false,error:String(error.stack||error)}));}
}
`)
    const { DesktopHostProcess } = await desktopModule('host-process'); let first
    for (const phase of ['first', 'resume', 'migrate']) {
      const result = join(home, phase + '.json')
      host = new DesktopHostProcess(process.execPath, fixture.resources, fixture.profile, undefined, { ...fixture.environment, DSH_HOME: home,
        FEISHU_SDK_FILE: join(sdk, 'index.cjs'), FEISHU_PHASE: phase, FEISHU_RESULT: result })
      await host.start(); const report = await readReport(result)
      assert.equal(report.ok, true, report.error + '\n' + host.stderr)
      if (phase === 'first') first = report.rooms
      else if (phase === 'resume') assert.deepEqual(report.rooms, first)
      else {
        assert.deepEqual(report.rooms.filter(room => room.kind === 'dm'), first.filter(room => room.kind === 'dm'))
        const group = report.rooms.find(room => room.kind === 'group'), original = first.find(room => room.kind === 'group')
        assert.deepEqual(group.members.map(member => member.sessionId), original.members.map(member => member.sessionId))
        assert.deepEqual(group.messages.filter(message => message.botId).map(message => message.id).sort(), original.messages.filter(message => message.botId).map(message => message.id).sort())
      }
      await host.stop(); host = undefined
      if (phase === 'resume') {
        const storage = join(home, 'storages'), botPath = join(storage, 'bot_mode.json')
        const state = JSON.parse(await readFile(botPath, 'utf8')), group = state.global.rooms.find(room => room.external?.id === 'oc_shared_group')
        const legacy = group.members.map(member => {
          const room = structuredClone(group), appId = 'cli_' + member.botId
          room.id = member.botId === 'alpha' ? group.id : group.id + '-legacy-beta'
          room.title = group.title + ' · ' + member.botId; room.external.accountId = appId; room.defaultBot = member.botId; room.members = [member]; delete room.aliases
          const replies = room.messages.filter(message => message.botId === member.botId)
          room.messages = room.messages.filter(message => message.botId === member.botId || replies.some(reply => reply.replyTo === message.id))
          for (const message of room.messages.filter(message => message.external)) {
            message.external.sender.id = message.external.sources.find(source => source.accountId === appId).senderId; delete message.external.sources
            if (member.botId === 'beta') { const previous = message.id; message.id = 'legacy-beta-' + previous; for (const reply of replies) if (reply.replyTo === previous) reply.replyTo = message.id }
          }
          return room
        })
        state.global.rooms = state.global.rooms.filter(room => room.id !== group.id).concat(legacy)
        await writeFile(botPath, JSON.stringify(state))
        const beta = legacy.find(room => room.defaultBot === 'beta'), human = beta.messages.find(message => message.external?.id === 'om_multi')
        const queuePath = join(storage, 'bot_fs_' + createHash('sha256').update('beta:cli_beta').digest('hex').slice(0, 28) + '.json')
        const queue = JSON.parse(await readFile(queuePath, 'utf8'))
        queue.global.pending.push({ key: JSON.stringify([JSON.stringify(['feishu', 'cli_beta', 'group', 'oc_shared_group']), 'om_multi']),
          input: { conversation: beta.external, message: human.external, text: human.text, targets: ['beta'] },
          binding: { conversation: beta.external, title: beta.title, botIds: ['beta'], defaultBot: 'beta' },
          submitted: { roomId: beta.id, attemptIds: beta.messages.filter(message => message.replyTo === human.id).map(message => message.id) } })
        await writeFile(queuePath, JSON.stringify(queue))
        const settingsPath = join(storage, 'bot_feishu_settings.json'), settings = JSON.parse(await readFile(settingsPath, 'utf8'))
        settings.global.groups[0].roomId = beta.id; await writeFile(settingsPath, JSON.stringify(settings))
      }
    }
  } finally { await host?.stop(); await rm(home, { recursive: true, force: true }) }
})
