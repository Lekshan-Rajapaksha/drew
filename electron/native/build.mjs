import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform === 'darwin') {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const headers = [
    resolve(dirname(process.execPath), '../include/node'), '/opt/homebrew/include/node', '/usr/local/include/node',
  ].find(path => existsSync(resolve(path, 'node_api.h')))
  if (!headers) throw new Error('Node.js development headers are required to build the macOS scroll monitor.')
  const output = resolve(root, 'out/native')
  mkdirSync(output, { recursive: true })
  execFileSync('xcrun', ['clang++', '-arch', 'arm64', '-arch', 'x86_64', '-mmacosx-version-min=13.0',
    '-fobjc-arc', '-fblocks', '-bundle', '-Wl,-undefined,dynamic_lookup', '-framework', 'AppKit',
    '-I', headers, resolve(root, 'electron/native/scroll.mm'), '-o', resolve(output, 'scroll.node')], { stdio: 'inherit' })
}
