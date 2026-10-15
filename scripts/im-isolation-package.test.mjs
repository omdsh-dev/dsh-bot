/** One Bot, both packaged IM companions, native Sessions and offline transport endpoints. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { root, run } from './common.mjs'
import { desktopModule, materializePackage, readReport } from './package-fixture.mjs'

test('one Bot keeps Web, Feishu and InfoFlow histories and replies separate across restart', { timeout: 120000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-im-isolation-'))
  let host
  try {
    const fixture = await materializePackage(home)
    const manifestPath = join(fixture.profile, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    for (const name of ['infoflow', 'feishu']) {
      const info = JSON.parse(await readFile(join(root, `dist/${name}-package-info.json`), 'utf8'))
      const target = join(fixture.profile, 'node_modules', info.name)
      await mkdir(target, { recursive: true })
      run('tar', ['-xzf', join(root, 'dist', info.file), '--strip-components=1', '-C', target])
      manifest.dependencies[info.name] = info.version
      manifest.dsh.profile.bundles.push(info.name)
    }
    await writeFile(manifestPath, JSON.stringify(manifest))
    const installSdk = async (name, version, source) => {
      const directory = join(fixture.profile, 'node_modules', name)
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'package.json'), JSON.stringify({ name, version, main: 'index.cjs' }))
      await writeFile(join(directory, 'index.cjs'), source)
      return join(directory, 'index.cjs')
    }
    const feishu = await installSdk('@larksuiteoapi/node-sdk', '1.75.0', String.raw`
const state = { sockets: [], sent: [] };
class Client {
 constructor(options) { this.appId=options.appId; }
 async request(options) {
  if(options.method==='GET') return {code:0,bot:{open_id:'ou_robot',app_name:'Shared Bot'}};
  state.sent.push({appId:this.appId,...options.data}); return {code:0};
 }
}
const EventDispatcher = process.env.DSH_FEISHU_SDK_FILE ? require(process.env.DSH_FEISHU_SDK_FILE).EventDispatcher : class {
 register(handlers) { this.handlers=handlers; return this; }
 async invoke({header,event}) { return this.handlers[header.event_type]({[Symbol('event-type')]:header.event_type,...header,...event}); }
};
class WSClient {
 constructor(options) { this.options=options; state.sockets.push(this); }
 async start({eventDispatcher}) { this.dispatcher=eventDispatcher; this.active=true; this.options.onReady(); }
 close() { this.active=false; }
}
module.exports={Client,EventDispatcher,WSClient,registerApp:async()=>{throw new Error('Registration is not used');},state,defaultHttpInstance:{defaults:{timeout:0}}};
`)
    const infoflow = await installSdk('@baidu/infoflow-sdk-nodejs', '2026.8.28', String.raw`
const { EventEmitter } = require('node:events');
const state = { sockets: [], sent: [] };
class Client {
 constructor() {
  this.robot={getInfo:async()=>({agentId:11,imId:111,name:'Shared Bot'})};
  this.im={message:{
   sendToUser:async(user,text)=>{state.sent.push({user,text});},
   sendToGroupWithOptions:async value=>{state.sent.push({group:value.groupId,text:value.body.map(b=>b.content||'').join('')});}
  }};
 }
}
class WSClient {
 constructor() { this.eventDispatcher=new EventEmitter(); state.sockets.push(this); }
 on(event,callback) { this.eventDispatcher.on(event,callback); }
 async connect() { this.connected=true; this.eventDispatcher.emit('connected'); }
 disconnect() { this.connected=false; }
}
module.exports={Client,WSClient,state};
`)
    await writeFile(join(fixture.profile, 'cordis.patch.yml'), '- id: agent-default-model\n  config:\n    provider: bot-fixture\n    model: fixture\n- id: bot-infoflow\n  disabled: false\n  config:\n    managed: true\n    pollMs: 100\n- id: bot-feishu\n  config:\n    pollMs: 100\n- insert:\n    - id: im-isolation-test\n      name: ./driver.js\n')
    await writeFile(join(fixture.profile, 'driver.js'), String.raw`
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
export const inject=['botMode','llm'];
export async function apply(ctx) {
 const requests=[];
 class Fixture extends LlmAdapter {
  async *stream(options) {
   const marker=JSON.stringify(options.messages).match(/ISO_(?:WEB|FS|IF)_(?:DM|GROUP)_[123]/g)?.at(-1);
   if(options.purpose!=='session-title') { assert.ok(marker,'Missing scenario input'); requests.push({marker,options}); }
   const text='isolation reply for '+marker;
   yield {type:'block-start',index:0,blockType:'text'};
   yield {type:'text-delta',index:0,text};
   yield {type:'block-end',index:0,block:{type:'text',text}};
   yield {type:'finish',reason:{kind:'stop'}};
  }
 }
 ctx.llm.registerAdapter(['bot-fixture'],new Fixture());
 const wait=async(predicate,label)=>{const end=Date.now()+15000;while(!predicate()){if(Date.now()>end)throw new Error('Timed out: '+label);await new Promise(resolve=>setTimeout(resolve,20));}};
 try {
  const bot=ctx.botMode,require=createRequire(import.meta.url);
  const fs=require(process.env.ISOLATION_FEISHU_SDK),info=require(process.env.ISOLATION_INFOFLOW_SDK);
  const first=process.env.ISOLATION_PHASE==='first';
  const fsBinding=()=>bot.feishuSnapshot().bindings.find(b=>b.botId==='alpha');
  const ifBinding=()=>bot.infoflowSnapshot().bindings.find(b=>b.botId==='alpha');
  const connected=()=>fsBinding()?.status==='connected'&&ifBinding()?.status==='connected';
  await wait(()=>bot.feishuSnapshot().available&&bot.infoflowSnapshot().available,'both companion managers');
  if(first) {
   await bot.createBot({id:'alpha',name:'Shared Bot',instructions:'SHARED_PERSONA_ALPHA'});
   await bot.saveFeishuBinding({botId:'alpha',appId:'cli_alpha',appSecret:'offline-feishu-secret',brand:'feishu',allowUsers:['ou_alice'],allowGroups:['oc_group'],admins:['ou_alice']});
   await bot.toggleFeishuBinding({botId:'alpha',enabled:true});
   await bot.saveInfoflowBinding({botId:'alpha',appKey:'offline-key',appSecret:'offline-infoflow-secret',agentId:'11',connect:true,allowUsers:['ou_alice'],allowGroups:['777'],admins:['ou_alice']});
   await bot.createGroup({title:'Web group',botIds:['alpha'],defaultBot:'alpha'});
  }
  await wait(connected,'simultaneous platform connections');
  const channels=['WEB_DM','WEB_GROUP','FS_DM','FS_GROUP','IF_DM','IF_GROUP'];
  const roomFor=channel=>bot.snapshot().rooms.find(room=>{
   const [platform,kind]=channel.split('_');
   return room.members.some(m=>m.botId==='alpha')&&room.kind===(kind==='DM'?'dm':'group')&&
    (platform==='WEB'?!room.external:room.external?.provider===(platform==='FS'?'feishu':'infoflow'));
  });
  const emit=async(channel,round)=>{
   const marker='ISO_'+channel+'_'+round;
   const [platform,kind]=channel.split('_'),group=kind==='GROUP';
   // Identical message IDs on both platforms must remain independently processable.
   const id='shared-'+kind+'-'+round;
   if(platform==='WEB') return bot.send({roomId:roomFor(channel).id,text:(group?'@alpha ':'')+marker});
   if(platform==='FS') {
    const socket=fs.state.sockets.findLast(s=>s.active);
    assert.ok(socket,'Feishu socket is active');
    return socket.dispatcher.invoke({schema:'2.0',header:{event_type:'im.message.receive_v1',app_id:'cli_alpha'},event:{sender:{sender_type:'user',sender_id:{open_id:'ou_alice'}},message:{message_id:id,chat_id:group?'oc_group':'oc_private',chat_type:group?'group':'p2p',message_type:'text',content:JSON.stringify({text:(group?'@_user_1 ':'')+marker}),mentions:group?[{key:'@_user_1',id:{open_id:'ou_robot'}}]:[]}}},{needCheck:false});
   }
   const socket=info.state.sockets.findLast(s=>s.connected);
   assert.ok(socket,'InfoFlow socket is active');
   socket.eventDispatcher.emit(group?'group.text':'private.text',{data:{raw:group?
    {groupid:'777',eventtype:'MESSAGE_RECEIVE',message:{header:{fromuserid:'ou_alice',messageid:id},body:[{type:'AT',robotid:'111'},{type:'TEXT',content:marker}]}}:
    {FromUserId:'ou_alice',MsgId:id,Content:marker}}});
  };
  const fsReplies=()=>fs.state.sent.filter(s=>s.content.includes('isolation reply for'));
  const ifReplies=()=>info.state.sent.filter(s=>s.text.includes('isolation reply for'));
  const settled=(channel,round)=>wait(()=>roomFor(channel)?.messages.some(m=>m.botId==='alpha'&&m.status==='complete'&&m.text==='isolation reply for ISO_'+channel+'_'+round),channel+' round '+round);
  for(const round of [1,2]) {
   const active=first?channels:channels.filter(c=>!c.startsWith('WEB'));
   await Promise.all(active.map(channel=>emit(channel,round)));
   await Promise.all(active.map(channel=>settled(channel,round)));
   await Promise.all(active.filter(c=>!c.startsWith('WEB')).map(channel=>emit(channel,round)));
   if(first) await wait(()=>fsReplies().length===round*2&&ifReplies().length===round*2,'both platform outboxes');
  }
  if(first) {
   assert.equal(requests.length,12,'Six independent entry points, two turns each, no duplicate executions');
   const infoSocket=info.state.sockets.findLast(s=>s.connected);
   await bot.toggleFeishuBinding({botId:'alpha',enabled:false});
   assert.equal(fsBinding().enabled,false);
   assert.equal(ifBinding().status,'connected');
   assert.equal(info.state.sockets.findLast(s=>s.connected),infoSocket,'Disabling Feishu preserves the InfoFlow connection');
   await emit('IF_DM',3); await settled('IF_DM',3);
   await wait(()=>ifReplies().length===5,'InfoFlow reply while Feishu disabled');
   await bot.toggleFeishuBinding({botId:'alpha',enabled:true}); await wait(connected,'Feishu reconnect');
   const fsSocket=fs.state.sockets.findLast(s=>s.active);
   await bot.toggleInfoflowBinding({botId:'alpha',enabled:false});
   assert.equal(ifBinding().enabled,false);
   assert.equal(fsBinding().status,'connected');
   assert.equal(fs.state.sockets.findLast(s=>s.active),fsSocket,'Disabling InfoFlow preserves the Feishu connection');
   await emit('FS_DM',3); await settled('FS_DM',3);
   await wait(()=>fsReplies().length===5,'Feishu reply while InfoFlow disabled');
   await bot.toggleInfoflowBinding({botId:'alpha',enabled:true}); await wait(connected,'InfoFlow reconnect');
   assert.equal(requests.length,14);
   const toolNames=options=>(options.tools??[]).map(t=>t.name).sort();
   assert.ok(toolNames(requests[0].options).length>0,'Native tools remain available');
   for(const {marker,options} of requests) {
    const channel=marker.slice(4,-2),round=Number(marker.at(-1)),messages=JSON.stringify(options.messages);
    assert.ok(JSON.stringify(options.messages.filter(m=>m.role==='system')).includes('SHARED_PERSONA_ALPHA'),'Same Bot identity at every entry');
    assert.deepEqual(toolNames(options),toolNames(requests[0].options),'Same Bot capabilities at every entry');
    for(const other of channels) if(other!==channel) assert.ok(!messages.includes('ISO_'+other+'_'),'Context leaked from '+other+' to '+channel);
    for(let prior=1;prior<round;prior++) assert.ok(messages.includes('ISO_'+channel+'_'+prior),'Own prior turns must remain in '+channel);
   }
   for(const reply of fsReplies()) {
    const text=JSON.parse(reply.content).text;
    assert.equal(reply.appId,'cli_alpha');
    assert.match(text,/^isolation reply for ISO_FS_(DM|GROUP)_[123]$/);
    assert.equal(reply.receive_id,text.includes('_GROUP_')?'oc_group':'oc_private');
   }
   for(const reply of ifReplies()) {
    assert.match(reply.text,/^isolation reply for ISO_IF_(DM|GROUP)_[123]$/);
    if(reply.text.includes('_GROUP_')) { assert.equal(reply.group,'777'); assert.equal(reply.user,undefined); }
    else { assert.equal(reply.user,'ou_alice'); assert.equal(reply.group,undefined); }
   }
  } else {
   for(const channel of ['FS_DM','IF_DM']) await emit(channel,3);
   await new Promise(resolve=>setTimeout(resolve,300));
   assert.equal(requests.length,0,'Redelivery after restart cannot rerun any model');
   assert.equal(fs.state.sent.length,0); assert.equal(info.state.sent.length,0);
  }
  const rooms=channels.map(roomFor);
  assert.equal(bot.snapshot().rooms.filter(r=>r.members.some(m=>m.botId==='alpha')).length,6);
  assert.equal(new Set(rooms.map(r=>r.id)).size,6,'Every platform and chat has its own Room');
  assert.equal(new Set(rooms.map(r=>r.members.find(m=>m.botId==='alpha').sessionId)).size,6,'Every platform and chat has its own native Session');
  for(const [index,room] of rooms.entries()) {
   const channel=channels[index],turns=['FS_DM','IF_DM'].includes(channel)?3:2;
   assert.equal(room.messages.filter(m=>m.botId===null).length,turns);
   assert.equal(room.messages.filter(m=>m.botId==='alpha'&&m.status==='complete').length,turns);
   for(const other of channels) if(other!==channel) assert.ok(!JSON.stringify(room.messages).includes('ISO_'+other+'_'),'Stored history leaked into '+channel);
  }
  await writeFile(process.env.ISOLATION_RESULT,JSON.stringify({ok:true,requests:requests.length,rooms}));
 } catch(error) {await writeFile(process.env.ISOLATION_RESULT,JSON.stringify({ok:false,error:String(error.stack||error)}));}
}
`)
    const { DesktopHostProcess } = await desktopModule('host-process')
    let first
    for (const phase of ['first', 'resume']) {
      const result = join(home, phase + '.json')
      host = new DesktopHostProcess(process.execPath, fixture.resources, fixture.profile, undefined, {
        ...fixture.environment, DSH_HOME: home, ISOLATION_FEISHU_SDK: feishu, ISOLATION_INFOFLOW_SDK: infoflow,
        ISOLATION_PHASE: phase, ISOLATION_RESULT: result,
      })
      await host.start()
      const report = await readReport(result)
      assert.equal(report.ok, true, report.error + '\n' + host.stderr)
      if (phase === 'first') first = report.rooms
      else assert.deepEqual(report.rooms, first, 'Restart preserves all six isolated histories and Session IDs')
      await host.stop(); host = undefined
    }
  } finally { await host?.stop(); await rm(home, { recursive: true, force: true }) }
})
