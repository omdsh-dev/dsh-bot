/** Full built DSH Web profile: only the external LLM is replaced. */
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../../..', import.meta.url))
const fixture = fileURLToPath(new URL('./profile-fixture.ts', import.meta.url))
it('composes the native plugin, isolates identities, stops work, and resumes persistent Sessions after restart', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'dsh-bot-profile-'))
  const patch = join(temp, 'fixture.patch.yml')
  await writeFile(patch, `- id: agent-default-model\n  config:\n    provider: bot-fixture\n    model: fixture\n- insert:\n    - id: bot-test-driver\n      name: ${JSON.stringify(fixture)}\n`)
  try {
    for (const phase of ['first', 'resume']) {
      const result = join(temp, `${phase}.json`)
      const child = spawn(process.execPath, ['apps/cli/lib/bin.js', '--profile', 'web', '--patch',
        'packages/experimental/bot-mode/cordis.patch.yml', '--patch', patch, '--no-open', '--port', '0'], {
        cwd: root, env: { ...process.env, DSH_HOME: join(temp, 'home'), BOT_TEST_RESULT: result, BOT_TEST_PHASE: phase, BOT_TEST_INFOFLOW: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      let output = ''
      child.stdout.on('data', (data) => { output += String(data) })
      child.stderr.on('data', (data) => { output += String(data) })
      const exited = new Promise<void>(resolve => child.once('exit', () => { resolve() }))
      try {
        const deadline = Date.now() + 60000
        let report: { ok: boolean; error?: string } | undefined
        while (Date.now() < deadline) {
          try {
            const decoded: unknown = JSON.parse(await readFile(result, 'utf8'))
            if (typeof decoded !== 'object' || decoded === null || !('ok' in decoded)) throw new Error('Invalid fixture report')
            report = { ok: decoded.ok === true, ...('error' in decoded ? { error: String(decoded.error) } : {}) }
            break
          } catch (error) {
            if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
          }
          if (child.exitCode !== null) throw new Error(output)
          await new Promise(resolve => setTimeout(resolve, 50))
        }
        expect(report, output).toBeDefined()
        expect(report?.ok, `${report?.error}\n${output}`).toBe(true)
      } finally {
        child.kill(phase === 'first' ? 'SIGKILL' : 'SIGTERM')
        const kill = setTimeout(() => child.kill('SIGKILL'), 5000)
        await exited
        clearTimeout(kill)
      }
    }
  } finally { await rm(temp, { recursive: true, force: true }) }
}, 140000)
