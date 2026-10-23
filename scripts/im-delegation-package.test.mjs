/** Exercise real packaged Host/connector dispatch; only model and platform networks are replaced. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { root, run } from './common.mjs'
import { desktopModule, materializePackage, readReport } from './package-fixture.mjs'

test('group Bots delegate within each platform and return each result once under its own robot', { timeout: 120000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-im-delegation-'))
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
      manifest.dependencies[info.name] = info.version; manifest.dsh.profile.bundles.push(info.name)
    }
    await writeFile(manifestPath, JSON.stringify(manifest))
    const sdk = async (name, version, source) => {
      const path = join(fixture.profile, 'node_modules', name)
      await mkdir(path, { recursive: true })
      await writeFile(join(path, 'package.json'), JSON.stringify({ name, version, main: 'index.cjs' }))
      await writeFile(join(path, 'index.cjs'), source)
    }
    await sdk('@larksuiteoapi/node-sdk', '1.75.0', String.raw`
const state={sockets:[],sent:[]};
class Client {
 constructor(options){this.id=options.appId;}
 async request(o){
  if(o.method==='GET')return {code:0,bot:{open_id:'ou_'+this.id,app_name:this.id}};
  state.sent.push({bot:this.id,...o.data});return {code:0};
 }
}
const EventDispatcher=process.env.DSH_FEISHU_SDK_FILE?require(process.env.DSH_FEISHU_SDK_FILE).EventDispatcher:class {
 register(handlers){this.handlers=handlers;return this;}
 async invoke({header,event}){return this.handlers[header.event_type]({...header,...event});}
};
class WSClient {
 constructor(options){this.options=options;state.sockets.push(this);}
 async start({eventDispatcher}){this.dispatcher=eventDispatcher;this.active=true;this.options.onReady();}
 close(){this.active=false;}
}
module.exports={Client,EventDispatcher,WSClient,state,registerApp:async()=>{throw new Error("unused");},defaultHttpInstance:{defaults:{timeout:0}}};
`)
    await sdk('@baidu/infoflow-sdk-nodejs', '2026.8.28', String.raw`
const {EventEmitter}=require('node:events');const state={sockets:[],sent:[]};
class Client {
 constructor(o){const id=o.appKey==='alpha'?11:o.appKey==='beta'?22:33;
  this.robot={getInfo:async()=>({agentId:id,imId:id*10+1,name:o.appKey})};
  this.im={message:{sendToUser:async(user,text)=>state.sent.push({bot:id,user,text}),
   sendToGroupWithOptions:async v=>{if(v.msgtype==='MD'&&v.body.length>2)throw new Error('msg body wrong, markdown count exceed limit (errcode: 40067)');return state.sent.push({bot:id,group:v.groupId,msgtype:v.msgtype,body:v.body,text:v.body.map(b=>b.content||'').join('')});}},
   group:{create:async()=>({groupId:'777'})}};
 }
}
class WSClient {
 constructor(o){this.key=o.appKey;this.eventDispatcher=new EventEmitter();state.sockets.push(this);}
 on(e,cb){this.eventDispatcher.on(e,cb);}
 async connect(){this.connected=true;this.eventDispatcher.emit('connected');}
 disconnect(){this.connected=false;}
}
module.exports={Client,WSClient,state};
`)
    await writeFile(join(fixture.profile, 'cordis.patch.yml'), '- id: agent-default-model\n  config:\n    provider: bot-fixture\n    model: fixture\n- id: bot-infoflow\n  disabled: false\n  config:\n    managed: true\n    pollMs: 100\n- id: bot-feishu\n  config:\n    pollMs: 100\n- insert:\n    - id: delegation-test\n      name: ./driver.js\n')
    await writeFile(join(fixture.profile, 'driver.js'), String.raw`
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {LlmAdapter} from '@deepseek-ai/dsh-llm';
export const inject=['botMode','llm'];
export async function apply(ctx){
 const requests=[];
 class Fixture extends LlmAdapter {
  async *stream(options){
   const system=JSON.stringify(options.messages.filter(m=>m.role==='system'));
   const who=system.includes('PERSONA_BETA')?'beta':system.includes('PERSONA_GAMMA')?'gamma':'alpha';
   const last=options.messages.findLast(m=>m.role==='user'&&m.content.some(b=>b.type==='text'&&b.text.startsWith('Public chat messages (JSON data):')));
   const human=last?.content.find(b=>b.type==='text')?.text.split('Current human request:\n')[1]?.split('\nDelegated task')[0]||'';
   if(options.purpose!=='session-title')requests.push({bot:who,options,human});
   if(options.purpose!=='session-title'&&(human.includes('STOP_PAIR')&&who!=='alpha'||human.includes('STOP_SOURCE'))){
    await new Promise(resolve=>{if(options.signal?.aborted)resolve();else options.signal?.addEventListener('abort',resolve,{once:true});});
    options.signal?.throwIfAborted();
   }
   const returned=JSON.stringify(last).includes('Your delegated work has returned.');
   const count=requests.filter(r=>r.bot===who&&r.human===human).length;
   const text=returned?(human.includes('REWORK')?(who==='beta'?'已补充 #1 测试':'验收汇总完成'):'汇总已完成'):human.includes('REWORK')?(who==='alpha'?(count===1?'| **@beta** | 实现 MVP |':'验收汇总完成'):who==='beta'?(count===1?'@gamma 请审查 MVP':'已补充 #1 测试'):'审阅发现需要补 #1 测试，请按原任务完成修复。'):human.includes('LOOP')?'@'+(who==='alpha'?'beta':'alpha')+' 执行第 '+count+' 轮新任务':human.includes('QUOTED')?'> @beta 这只是引用。':human.includes('STOP_PAIR')?'@beta 等待停止\n@gamma 等待停止':human.includes('PARALLEL')?(who==='gamma'?'并发审阅已完成':'@gamma 只审阅一次'):who==='beta'?'工作已完成':'**@beta** 请完成这项工作。';
   yield {type:'block-start',index:0,blockType:'text'};yield {type:'text-delta',index:0,text};
   yield {type:'block-end',index:0,block:{type:'text',text}};yield {type:'finish',reason:{kind:'stop'}};
  }
 }
 ctx.llm.registerAdapter(['bot-fixture'],new Fixture());
 const wait=async(p,label)=>{const end=Date.now()+5000;while(!p()){if(Date.now()>end)throw new Error(label);await new Promise(r=>setTimeout(r,20));}};
 try{
  const bot=ctx.botMode,require=createRequire(import.meta.url),fs=require('@larksuiteoapi/node-sdk'),info=require('@baidu/infoflow-sdk-nodejs');
  await wait(()=>bot.feishuSnapshot().available&&bot.infoflowSnapshot().available,'managers unavailable');
  if(process.env.DELEGATION_PHASE==='first'){
   for(const id of ['alpha','beta','gamma']){
    await bot.createBot({id,name:id,instructions:'PERSONA_'+id.toUpperCase()});
    await bot.saveFeishuBinding({botId:id,appId:'cli_'+id,appSecret:'fixture',brand:'feishu',allowUsers:['ou_alice'],allowGroups:[],admins:['ou_alice']});
    await bot.toggleFeishuBinding({botId:id,enabled:true});
    await bot.saveInfoflowBinding({botId:id,appKey:id,appSecret:'fixture',agentId:id==='alpha'?'11':id==='beta'?'22':'33',connect:true,allowUsers:['ou_alice'],allowGroups:['888'],admins:['ou_alice']});
   }
   // First contact in a previously unseen group must discover configured peers too.
   // Do not seed a room through a whitelist: that hid the real all-groups failure.
   for(const id of ['alpha','beta','gamma']) await bot.saveFeishuBinding({botId:id,appId:'cli_'+id,brand:'feishu',allowUsers:['ou_alice'],allowGroups:[],allowAllGroups:true,admins:['ou_alice']});
   await bot.createInfoflowGroup({requestId:'delegation-group-1',title:'Delegation',botIds:['alpha','beta','gamma'],defaultBot:'alpha',owner:'ou_alice',members:[]});
  }
  await wait(()=>bot.feishuSnapshot().bindings.every(b=>b.status==='connected')&&bot.infoflowSnapshot().bindings.every(b=>b.status==='connected'),'connections unavailable');
  assert.ok(bot.feishuSnapshot().bindings.every(b=>b.allowAllGroups===true&&b.allowGroups.length===0),'All-groups access must survive restart without a group whitelist');
  const emit=async(provider,id='root',text='请把任务派给 beta。',targets=['alpha'],sender='ou_alice',groupId='777')=>{
   if(provider==='infoflow'){
    const ids={alpha:'111',beta:'221',gamma:'331'};
    for(const s of info.state.sockets.filter(s=>s.connected))s.eventDispatcher.emit('group.text',{data:{raw:{groupid:groupId,eventtype:'MESSAGE_RECEIVE',message:{header:{fromuserid:sender,messageid:id},body:[...targets.map(t=>({type:'AT',robotid:ids[t]})),{type:'TEXT',content:text.startsWith('/')?text:'IF_ONLY '+text}]}}}});
   }else{
    for(const target of targets){
     const s=fs.state.sockets.findLast(s=>s.active&&s.options.appId==='cli_'+target);
     const mentions=targets.map((t,i)=>({key:'@_user_'+i,id:{open_id:'ou_cli_'+t}}));
     await s.dispatcher.invoke({schema:'2.0',header:{event_type:'im.message.receive_v1',app_id:'cli_'+target},event:{sender:{sender_type:'user',sender_id:{open_id:sender}},message:{message_id:id,chat_id:'oc_group',chat_type:'group',message_type:'text',content:JSON.stringify({text:mentions.map(m=>m.key).join(' ')+' '+(text.startsWith('/')?text:'FS_ONLY '+text)}),mentions}}},{needCheck:false});
    }
   }
  };
  const rooms=()=>bot.snapshot().rooms.filter(r=>r.external?.kind==='group');
  if(process.env.DELEGATION_PHASE==='first'){
   for(const provider of ['infoflow','feishu']){
    await emit(provider);
    const room=()=>rooms().find(r=>r.external.provider===provider&&(provider!=='infoflow'||r.external.id==='777'));
    await wait(()=>room()?.messages.some(m=>m.botId==='alpha'&&m.status==='complete'),'source Bot failed');
    await wait(()=>room()?.messages.some(m=>m.botId==='beta'&&m.status==='complete'),provider+': @beta remained plain text; target Bot never ran');
    await wait(()=>provider==='infoflow'?info.state.sent.some(s=>s.bot===22&&s.text.includes('工作已完成')):fs.state.sent.some(s=>s.bot==='cli_beta'&&s.content.includes('工作已完成')),provider+': delegated result not returned by beta');
    await emit(provider);
   }
   await new Promise(r=>setTimeout(r,250));
   assert.equal(requests.length,6,'Each platform runs the initial assignment, child, and one result callback; duplicate ingress adds no work');
   for(const provider of ['infoflow','feishu']){
    const room=rooms().find(r=>r.external.provider===provider&&(provider!=='infoflow'||r.external.id==='777'));
    assert.deepEqual(room.messages.filter(m=>m.botId).map(m=>m.botId),['alpha','beta','alpha']);
    assert.equal(room.messages.filter(m=>!m.botId).length,1,'Delegation is not fabricated as a human message');
    assert.equal(room.messages.filter(m=>m.continuationOf).length,1,'Each settled branch returns exactly once');
    await wait(()=>provider==='infoflow'?info.state.sent.filter(s=>s.bot===11&&s.text==='汇总已完成').length===1:fs.state.sent.filter(s=>s.bot==='cli_alpha'&&JSON.parse(s.content).text==='汇总已完成').length===1,provider+': callback result was not delivered exactly once');
   }
   for(const {options} of requests){const s=JSON.stringify(options.messages);assert.ok(!(s.includes('IF_ONLY')&&s.includes('FS_ONLY')),'Cross-platform context leak');}
   assert.equal(info.state.sent.filter(s=>s.text.includes('工作已完成')).length,1);
   assert.equal(fs.state.sent.filter(s=>s.content.includes('工作已完成')).length,1);
   assert.ok(info.state.sent.some(s=>s.bot===11&&s.body?.some(b=>b.type==='AT'&&b.atagentids?.includes(22))),'InfoFlow handoff must include the engineer agentId in a real robot AT');
   assert.ok(info.state.sent.filter(s=>s.body?.some(b=>b.atagentids?.length)).every(s=>s.msgtype==='TEXT'),'InfoFlow must visibly render every robot AT; Markdown hides it');
   assert.ok(fs.state.sent.some(s=>s.bot==='cli_alpha'&&JSON.parse(s.content).text.includes('<at user_id="ou_cli_beta">beta</at>')),'Feishu handoff must include the engineer openId in a real AT');
   assert.ok(!info.state.sent.some(s=>s.bot===22&&s.body?.some(b=>b.atagentids?.includes(11))),'An unaddressed completion cannot produce a handoff mention');
   assert.ok(!fs.state.sent.some(s=>s.bot==='cli_beta'&&s.content.includes('<at ')),'An unaddressed completion cannot produce a handoff mention');
   for(const provider of ['infoflow','feishu']){
    const room=()=>rooms().find(r=>r.external.provider===provider&&(provider!=='infoflow'||r.external.id==='777'));
    const chain=id=>{const r=room(),root=r.messages.find(m=>m.external?.id===id);if(!root)return [];return r.messages.filter(m=>m.botId&&(m.replyTo===root?.id||m.delegation?.rootId===root?.id));};
    await emit(provider,'parallel','PARALLEL 请共同交给 gamma 审阅',['alpha','beta','alpha']);
    await wait(()=>chain('parallel').length===4&&chain('parallel').every(m=>m.status==='complete'),'parallel delegation did not settle');
    assert.equal(chain('parallel').filter(m=>m.botId==='gamma').length,1,'Competing Bots reserve the same recipient once');
    await emit(provider,'rework','REWORK 实现、审阅、修复并汇总');
    await wait(()=>chain('rework').length===5&&chain('rework').every(m=>m.status==='complete'),provider+': real Markdown/multiple mentions/rework failed');
    assert.deepEqual(chain('rework').map(m=>m.botId),['alpha','beta','gamma','beta','alpha']);
    assert.ok(chain('rework').some(m=>m.botId==='beta'&&m.text==='已补充 #1 测试'));
    assert.deepEqual(chain('rework').filter(m=>m.continuationOf).map(m=>m.botId),['beta','alpha'],'Review results return to the worker, then the coordinator');
    await emit(provider,'loop','LOOP 验证循环有界');
    await wait(()=>chain('loop').length===3&&chain('loop').every(m=>m.status==='complete'),provider+': bounded follow-ups did not settle');
    assert.ok(chain('loop').some(m=>m.text.includes('正在等待子任务结果')),'An ancestor waiting for results cannot be assigned a recursive task');
    await emit(provider,'quoted','QUOTED 引用示例');
    await wait(()=>chain('quoted').some(m=>m.status==='complete'),'quoted reply');
    assert.equal(chain('quoted').length,1,'Quoted addressing must not dispatch');
    const toggle=provider==='infoflow'?q=>bot.toggleInfoflowBinding(q):q=>bot.toggleFeishuBinding(q);
    await toggle({botId:'beta',enabled:false});
    await emit(provider,'disabled','请派给停用的 beta');
    await wait(()=>chain('disabled').some(m=>m.status==='complete'),'disabled reply');
    assert.equal(chain('disabled').length,1,'Disabled targets must not execute');
    await toggle({botId:'beta',enabled:true});
    await wait(()=>(provider==='infoflow'?bot.infoflowSnapshot():bot.feishuSnapshot()).bindings.find(b=>b.botId==='beta').status==='connected','reconnect');
    await emit(provider,'stop-pair','STOP_PAIR 派给 beta 和 gamma');
    await wait(()=>requests.filter(r=>r.human.includes('STOP_PAIR')&&r.human.includes(provider==='infoflow'?'IF_ONLY':'FS_ONLY')).length===3,'both delegated turns started');
    await wait(()=>provider==='infoflow'?info.state.sent.some(s=>s.bot===33&&s.text.includes('已接单')):fs.state.sent.some(s=>s.bot==='cli_gamma'&&s.content.includes('已接单')),provider+': running target must acknowledge before its work finishes');
    await emit(provider,'stop-stranger','/stop',['alpha'],'ou_stranger');
    await new Promise(r=>setTimeout(r,100));
    assert.equal(chain('stop-pair').filter(m=>m.status==='running').length,2,'Another user cannot stop delegated tasks');
    await emit(provider,'stop-owner','/stop');
    await wait(()=>chain('stop-pair').filter(m=>m.status==='canceled').length===2,'original sender stops all delegated tasks');
    assert.equal(room().messages.find(m=>m.external?.id==='stop-pair').allowDelegation,false,'Stopping prevents new child reservations');
   }
   await emit('infoflow','ordinary-root','请把任务派给 beta。',['alpha'],'ou_alice','888');
   const ordinary=()=>rooms().find(r=>r.external.provider==='infoflow'&&r.external.id==='888');
   await wait(()=>ordinary()?.messages.some(m=>m.botId==='beta'&&m.status==='complete'),'Ordinary InfoFlow group cannot hand off');
   assert.equal(ordinary().members.length,3,'Configured peers share an existing group without recreating it');
   await wait(()=>info.state.sent.some(s=>s.bot===22&&s.text.includes('工作已完成')&&s.group==='888'),'Ordinary group target replies to the original group');
   await emit('feishu','late-root','STOP_SOURCE 先停止，再模拟另一应用迟到的事件');
   await wait(()=>requests.some(r=>r.human.includes('STOP_SOURCE')),'source turn started');
   await emit('feishu','stop-source','/stop');
   const late=()=>{const r=rooms().find(r=>r.external.provider==='feishu'),root=r.messages.find(m=>m.external?.id==='late-root');return r.messages.filter(m=>m.botId&&root&&(m.replyTo===root.id||m.delegation?.rootId===root.id));};
   await wait(()=>late().some(m=>m.status==='canceled'),'source stopped');
   await emit('feishu','late-root','STOP_SOURCE 先停止，再模拟另一应用迟到的事件',['beta']);
   await new Promise(r=>setTimeout(r,200));
   assert.equal(late().length,1,'A delayed app event cannot resurrect a stopped request');
   const dm=bot.snapshot().rooms.find(r=>!r.external&&r.kind==='dm'&&r.defaultBot==='alpha');
   await bot.send({roomId:dm.id,text:'请派给 beta'});
   await wait(()=>bot.snapshot().rooms.find(r=>r.id===dm.id).messages.some(m=>m.botId==='alpha'&&m.status==='complete'),'private reply');
   assert.ok(!bot.snapshot().rooms.find(r=>r.id===dm.id).messages.some(m=>m.botId==='beta'),'Private chat cannot hand off into another chat');
   await wait(()=>info.state.sent.filter(s=>s.text==='执行已停止。').length===2&&fs.state.sent.filter(s=>JSON.parse(s.content).text==='执行已停止。').length===3,'stop replies drained before restart');

  }else{
   await emit('infoflow');await emit('feishu');await new Promise(r=>setTimeout(r,300));
   assert.equal(requests.length,0,'Restart/replayed receipts must not re-run the delegation chain');
   assert.equal(info.state.sent.length,0);assert.equal(fs.state.sent.length,0);
  }
  await writeFile(process.env.DELEGATION_RESULT,JSON.stringify({ok:true,rooms:rooms()}));
 }catch(error){await writeFile(process.env.DELEGATION_RESULT,JSON.stringify({ok:false,error:String(error.stack||error)}));}
}
`)
    const { DesktopHostProcess } = await desktopModule('host-process')
    let first
    for (const phase of ['first', 'resume']) {
      const result = join(home, phase + '.json')
      host = new DesktopHostProcess(process.execPath, fixture.resources, fixture.profile, undefined, {
        ...fixture.environment, DSH_HOME: home, DELEGATION_PHASE: phase, DELEGATION_RESULT: result,
      })
      await host.start()
      const report = await readReport(result)
      assert.equal(report.ok, true, report.error + '\n' + host.stderr)
      if (phase === 'first') first = report.rooms
      else assert.deepEqual(report.rooms, first)
      await host.stop(); host = undefined
    }
  } finally { await host?.stop(); await rm(home, { recursive: true, force: true }) }
})
