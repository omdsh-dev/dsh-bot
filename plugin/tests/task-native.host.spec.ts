/** Real built DSH profile and native storage, including a non-cooperative mid-tool process crash. */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import type { TaskNativeReport } from './task-native-fixture.ts'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
const fixture = fileURLToPath(new URL('./task-native-fixture.ts', import.meta.url))
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

it('recovers a SIGKILLed native tool without replay, and persists operation receipts and human verification across restarts', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'dsh-task-native-'))
  const patch = join(temp, 'fixture.patch.yml'), effects = join(temp, 'external-effects.jsonl'), manifest = join(temp, 'manifest.json')
  try {
    await writeFile(effects, '')
    await writeFile(patch, `- id: agent-default-model\n  config:\n    provider: task-native-fixture\n    model: fixture\n- insert:\n    - id: task-native-driver\n      name: ${JSON.stringify(fixture)}\n`)
    let effectsAtCrash = '', stableSuccess: TaskNativeReport['success']
    for (const phase of ['seed', 'resume', 'confirm']) {
      const reportPath = join(temp, `${phase}.json`)
      const child = spawn(process.execPath, ['apps/cli/lib/bin.js', '--profile', 'web', '--patch',
        'packages/experimental/bot-mode/cordis.patch.yml', '--patch', patch, '--no-open', '--port', '0'], {
        cwd: root, env: { ...process.env, DSH_HOME: join(temp, 'home'), TASK_NATIVE_PHASE: phase,
          TASK_NATIVE_RESULT: reportPath, TASK_NATIVE_MANIFEST: manifest, TASK_NATIVE_EFFECTS: effects },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let output = '', spawnError: Error | undefined
      const capture = (data: Buffer) => { output = (output + String(data)).slice(-60000) }
      child.stdout.on('data', capture); child.stderr.on('data', capture)
      child.once('error', error => { spawnError = error })
      const exited = new Promise<void>(resolve => child.once('close', () => resolve()))
      try {
        let report: TaskNativeReport | undefined
        const deadline = Date.now() + 60000
        while (Date.now() < deadline) {
          if (spawnError) throw spawnError
          try {
            const decoded: unknown = JSON.parse(await readFile(reportPath, 'utf8'))
            if (!decoded || typeof decoded !== 'object' || !('ok' in decoded)) throw new Error('Invalid task native fixture report')
            report = decoded as TaskNativeReport; break
          } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
          }
          if (child.exitCode !== null || child.signalCode !== null) throw new Error(`Native fixture exited before ${phase} report:\n${output}`)
          await pause(40)
        }
        expect(report, `${phase} report timed out:\n${output}`).toBeDefined()
        expect(report?.ok, `${phase}: ${report?.error}\n${report?.stack ?? ''}\n${output}`).toBe(true)
        expect(report?.phase).toBe(phase)
        expect(report?.denied?.operations).toEqual([])
        expect(report?.denied?.task.status).toBe('awaiting_verification')
        expect(report?.success?.task.status).toBe('verified')
        expect(report?.success?.operations.map(operation => operation.status)).toEqual(['returned'])
        const oracle = await readFile(effects, 'utf8')
        expect(oracle.trim().split('\n').map(line => (JSON.parse(line) as { action: string }).action)).toEqual(['success', 'crash'])
        if (phase === 'seed') {
          expect(report?.modelCalls).toBeGreaterThanOrEqual(3)
          expect(report?.crash?.operations.map(operation => operation.status)).toEqual(['started'])
          expect(report?.crash?.task.runs.map(run => run.status)).toEqual(['running', 'queued'])
          expect(child.exitCode).toBeNull(); expect(child.signalCode).toBeNull()
          effectsAtCrash = oracle; stableSuccess = report?.success
        } else {
          expect(report?.modelCalls).toBe(0)
          expect(report?.success).toEqual(stableSuccess)
          expect(report?.crash?.task.status).toBe('interrupted')
          expect(report?.crash?.operations).toHaveLength(1)
          expect(report?.crash?.operations[0]).toMatchObject({ status: 'unknown', resolution: { outcome: 'verified_applied' } })
          expect(report?.crash?.task.runs.map(run => run.status)).toEqual(['interrupted', 'canceled'])
          expect(oracle).toBe(effectsAtCrash)
        }
      } finally {
        // seed never receives a cooperative shutdown: the mock tool's receipt is still started.
        child.kill(phase === 'seed' ? 'SIGKILL' : 'SIGTERM')
        const escalation = setTimeout(() => child.kill('SIGKILL'), 5000)
        try { await exited } finally { clearTimeout(escalation) }
      }
      if (phase === 'seed') expect(child.signalCode).toBe('SIGKILL')
    }
  } finally { await rm(temp, { recursive: true, force: true }) }
}, 200000)
