/** Create a local double-click entry pointing at this prepared source checkout. */
import { createHash } from 'node:crypto'
import { chmodSync, cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { root, runtime, run } from './common.mjs'
run(process.execPath, [join(root, 'scripts/start-desktop.mjs'), '--prepare-only'])
const home = resolve(process.env.DSH_HOME || join(root, '.data/desktop'))
const build = join(root, '.runtime/bot-desktop', createHash('sha256').update(home).digest('hex').slice(0, 16))
const config = JSON.parse(readFileSync(join(build, 'launch.json'), 'utf8'))
const output = join(root, 'dist')
mkdirSync(output, { recursive: true })
let destination
if (process.platform === 'darwin') {
  destination = join(output, 'DSH Bots.app')
  const contents = join(destination, 'Contents'), bin = join(contents, 'MacOS/DSH-Bots')
  mkdirSync(join(contents, 'MacOS'), { recursive: true }); mkdirSync(join(contents, 'Resources'), { recursive: true })
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'"
  writeFileSync(bin, `#!/bin/sh\nunset ELECTRON_RUN_AS_NODE\nexec ${quote(config.electron)} ${quote(config.app)}\n`)
  chmodSync(bin, 0o755)
  writeFileSync(join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleName</key><string>DSH Bots</string><key>CFBundleDisplayName</key><string>DSH Bots</string><key>CFBundleIdentifier</key><string>io.github.zzzpyyy.dsh-bots.local</string><key>CFBundleExecutable</key><string>DSH-Bots</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string><key>CFBundleIconFile</key><string>icon.png</string></dict></plist>`)
  cpSync(join(runtime, 'apps/desktop/resources/icon-macos.png'), join(contents, 'Resources/icon.png'))
} else if (process.platform === 'win32') {
  destination = join(output, 'DSH Bots.lnk')
  const script = join(build, 'shortcut.ps1'), input = join(build, 'shortcut.json')
  writeFileSync(input, JSON.stringify({ destination, executable: config.electron, arguments: `"${config.app}"`, cwd: root }))
  writeFileSync(script, `$c = Get-Content -Raw -LiteralPath $args[0] | ConvertFrom-Json\n$s = (New-Object -ComObject WScript.Shell).CreateShortcut($c.destination)\n$s.TargetPath = $c.executable\n$s.Arguments = $c.arguments\n$s.WorkingDirectory = $c.cwd\n$s.Description = 'DSH Bots native desktop'\n$s.Save()\n`)
  run('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', script, input])
} else throw new Error('Native desktop entries support macOS and Windows.')
console.log(`Created ${destination}. Keep this source checkout and its .runtime directory in place.`)
