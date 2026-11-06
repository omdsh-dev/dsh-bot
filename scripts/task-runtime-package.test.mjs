/** The same SIGKILL/restart proof against the installed release archive on each qualified runtime. */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { root, requireNode } from './common.mjs'
import { materializePackage, requireRuntime } from './package-fixture.mjs'
import { target } from './test-runtime.mjs'

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const redact = output => output.replace(/token=[^\s)]+/g, 'token=[redacted]')

// Keep the core fixture transpile-only and unchanged between source and archive tests. This
// small wrapper adds an explicit post-merge room shape, without mocking any Host controls.
// Room merging itself has separate tests; here the original operation key must remain usable.
const entry = String.raw`
import assert from 'node:assert/strict';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {apply as drive} from './driver.js';
export {inject,name} from './driver.js';
async function publish(file,value){
 await writeFile(file+'.partial',JSON.stringify(value),{flush:true});
 await rename(file+'.partial',file);
}
export async function apply(ctx){
 const result=process.env.TASK_PACKAGE_RESULT, phase=process.env.TASK_NATIVE_PHASE;
 let modelCalls=0;
 ctx.on('llm/stream',(options,next)=>{modelCalls++;return next();},{global:true,prepend:true});
 try{
  await drive(ctx);
  const report=JSON.parse(await readFile(process.env.TASK_NATIVE_RESULT,'utf8'));
  if(!report.ok){await publish(result,report);return;}
  assert.equal(modelCalls,report.modelCalls);
  if(phase!=='seed'){
   const manifest=JSON.parse(await readFile(process.env.TASK_NATIVE_MANIFEST,'utf8'));
   const service=ctx.botMode, key=report.crash.operations[0], canonical='task-native-merged-crash';
   const beforeEffects=await readFile(process.env.TASK_NATIVE_EFFECTS,'utf8');
   if(phase==='resume'){
    await Reflect.get(service,'change').call(service,state=>{
     const room=state.rooms.find(room=>room.id===key.roomId);
     assert.ok(room);
     room.aliases=[...new Set([...(room.aliases||[]),room.id])];
     room.id=canonical;
    });
    manifest.crash.roomId=canonical;
    await publish(process.env.TASK_NATIVE_MANIFEST,manifest);
   }
   assert.ok(service.snapshot().rooms.find(room=>room.id===canonical)?.aliases.includes(key.roomId));
   const original=await service.taskView({roomId:key.roomId,messageId:manifest.crash.rootId});
   const renamed=await service.taskView({roomId:canonical,messageId:manifest.crash.rootId});
   assert.deepEqual(original,renamed,'A retained room alias must expose the same authorized task');
   assert.equal(original.task.roomId,canonical);
   assert.equal(original.operations[0].roomId,key.roomId,'A merge must never rewrite a durable operation key');
   assert.equal(original.operations[0].id,key.id);
   assert.deepEqual(service.tasks({roomId:key.roomId}),service.tasks({roomId:canonical}));
   await service.resolveTaskOperation({roomId:key.roomId,messageId:key.messageId,callId:key.callId,resolution:'verified_applied'});
   await assert.rejects(service.taskView({roomId:manifest.success.roomId,messageId:manifest.crash.rootId}),/Task|task/);
   await new Promise(resolve=>setTimeout(resolve,1100));
   assert.equal(modelCalls,0,'Alias queries and idempotent reconciliation cannot dispatch any model work');
   assert.equal(await readFile(process.env.TASK_NATIVE_EFFECTS,'utf8'),beforeEffects,'Alias reconciliation cannot replay a tool');
   report.crash=await service.taskView({roomId:canonical,messageId:manifest.crash.rootId});
   assert.deepEqual(report.crash,original);
   report.alias={roomId:canonical,originalRoomId:key.roomId,operationId:key.id};
  }
  report.modelCalls=modelCalls;
  await publish(result,report);
 }catch(error){await publish(result,{ok:false,phase,modelCalls,error:String(error),stack:error?.stack});}
}
`

test(`release archive preserves native task safety across SIGKILL on DSH ${target.version}`, { timeout: 220000 }, async t => {
  requireNode()
  const home = await mkdtemp(join(tmpdir(), 'dsh-task-package-'))
  let archive, originalHash
  try {
    const fixture = await materializePackage(home)
    assert.equal(fixture.descriptor.release.version, target.version)
    archive = join(root, 'dist', fixture.info.file)
    originalHash = digest(await readFile(archive))
    assert.equal(originalHash, fixture.info.sha256, 'Use exactly the qualified release archive')
    t.diagnostic(`DSH ${target.version}; release ${fixture.info.name}@${fixture.info.version}; sha256 ${originalHash}`)
    const ts = requireRuntime('typescript')
    const driver = ts.transpileModule(await readFile(join(root, 'plugin/tests/task-native-fixture.ts'), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText
    assert.ok(!driver.includes('../src/'), 'The installed driver may not resolve development/source modules')
    await writeFile(join(fixture.profile, 'driver.js'), driver)
    await writeFile(join(fixture.profile, 'task-entry.js'), entry)
    await writeFile(join(fixture.profile, 'cordis.patch.yml'), '- id: agent-default-model\n  config:\n    provider: task-native-fixture\n    model: fixture\n- insert:\n    - id: task-native-driver\n      name: ./task-entry.js\n')
    // Match the supported installed Web launch path, not the managed source workspace.
    const profile = join(home, 'profiles/web')
    await cp(fixture.profile, profile, { recursive: true })
    // The copied Web profile owns the archive and private dependencies; release the unused copy.
    await rm(fixture.profile, { recursive: true, force: true })
    const effects = join(home, 'external-effects.jsonl'), manifest = join(home, 'task-manifest.json')
    await writeFile(effects, '')
    let effectsAtCrash, stableSuccess, stableDenied, initialCrash, reconciledCrash, alias
    for (const phase of ['seed', 'resume', 'confirm']) {
      const reportPath = join(home, `${phase}.json`)
      const child = spawn(process.execPath, ['--expose-internals', join(fixture.resources, 'node_modules/@deepseek-ai/dsh/lib/bin.js'),
        '--profile', 'web', '--port', '0', '--no-open'], {
        cwd: profile, env: { ...fixture.environment, DSH_HOME: home, TASK_NATIVE_PHASE: phase,
          TASK_NATIVE_RESULT: join(home, `${phase}.native.json`), TASK_PACKAGE_RESULT: reportPath,
          TASK_NATIVE_MANIFEST: manifest, TASK_NATIVE_EFFECTS: effects },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let output = '', spawnError
      const capture = data => { output = (output + String(data)).slice(-60000) }
      child.stdout.on('data', capture); child.stderr.on('data', capture)
      child.once('error', error => { spawnError = error })
      const closed = new Promise(resolve => child.once('close', resolve))
      try {
        let report
        const deadline = Date.now() + 60000
        while (Date.now() < deadline) {
          if (spawnError) throw spawnError
          try {
            report = JSON.parse(await readFile(reportPath, 'utf8')); break
          } catch (error) { if (error.code !== 'ENOENT') throw error }
          if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Host exited before ${phase} report`)
          await pause(40)
        }
        assert.ok(report, `${phase} report timed out`)
        assert.equal(report.ok, true, `${report.error}\n${report.stack ?? ''}`)
        assert.equal(report.phase, phase)
        assert.equal(report.success.task.status, 'verified')
        assert.equal(report.success.task.verification.outcome, 'accepted')
        assert.deepEqual(report.success.operations.map(operation => operation.status), ['returned'])
        assert.deepEqual(report.denied.operations, [], 'Deny-all must stop dispatch before a journal entry')
        assert.equal(report.denied.task.status, 'awaiting_verification')
        const oracle = await readFile(effects, 'utf8')
        assert.deepEqual(oracle.trim().split('\n').map(line => JSON.parse(line).action), ['success', 'crash'])
        if (phase === 'seed') {
          assert.ok(report.modelCalls >= 5, 'The native model attempts a denied tool, completes one effect, and stalls the crash effect')
          assert.deepEqual(report.crash.operations.map(operation => operation.status), ['started'])
          assert.deepEqual(report.crash.task.runs.map(run => run.status), ['running', 'queued'])
          assert.equal(child.exitCode, null); assert.equal(child.signalCode, null)
          effectsAtCrash = oracle; stableSuccess = report.success; stableDenied = report.denied; initialCrash = report.crash
        } else {
          assert.equal(report.modelCalls, 0)
          assert.deepEqual(report.success, stableSuccess)
          assert.deepEqual(report.denied, stableDenied)
          assert.equal(report.crash.task.status, 'interrupted')
          assert.deepEqual(report.crash.task.runs.map(run => run.status), ['interrupted', 'canceled'])
          assert.equal(report.crash.operations.length, 1)
          const operation = report.crash.operations[0]
          assert.equal(operation.status, 'unknown'); assert.equal(operation.resolution.outcome, 'verified_applied')
          assert.equal(operation.id, initialCrash.operations[0].id)
          assert.equal(operation.roomId, initialCrash.operations[0].roomId)
          assert.equal(report.alias.originalRoomId, operation.roomId)
          assert.equal(report.alias.roomId, report.crash.task.roomId)
          assert.notEqual(report.alias.roomId, report.alias.originalRoomId)
          assert.equal(oracle, effectsAtCrash, 'The oracle intentionally has no deduplication; any replay adds a line')
          if (phase === 'resume') { reconciledCrash = report.crash; alias = report.alias }
          else { assert.deepEqual(report.crash, reconciledCrash); assert.deepEqual(report.alias, alias) }
        }
        t.diagnostic(`${phase}: calls=${report.modelCalls}; denied=${report.denied.operations.length}; success=${report.success.task.status}/returned; crash=${report.crash.task.status}/${report.crash.operations[0].status}; effects=2`)
      } catch (error) {
        throw new Error(`${target.version} ${phase}: ${error.message}\n${redact(output)}`, { cause: error })
      } finally {
        // No graceful shutdown in the crash window: the body remains blocked with its started intent.
        child.kill(phase === 'seed' ? 'SIGKILL' : 'SIGTERM')
        const escalation = setTimeout(() => child.kill('SIGKILL'), 5000)
        try { await closed } finally { clearTimeout(escalation) }
      }
      if (phase === 'seed') assert.equal(child.signalCode, 'SIGKILL')
    }
  } finally {
    await rm(home, { recursive: true, force: true })
    if (archive) assert.equal(digest(await readFile(archive)), originalHash, 'The test must not modify or rebuild the release archive')
  }
})
