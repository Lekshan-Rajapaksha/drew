import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const output = join(root, 'release', version, 'distribution')
const mac = process.platform === 'darwin'
const windows = process.platform === 'win32'
const env = process.env

function run(file, args, options = {}) {
  return execFileSync(file, args, { cwd: root, stdio: 'inherit', ...options })
}

if (!mac && !windows) throw new Error('Run the release command on the target macOS or Windows host.')
if (!env.npm_execpath) throw new Error('Run npm run release:signed.')
if (mac) {
  const identities = run('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
  if (!identities.includes('Developer ID Application:')) throw new Error('A trusted Apple Developer ID Application identity is required.')
  const notarization = (env.APPLE_ID && env.APPLE_APP_SPECIFIC_PASSWORD && env.APPLE_TEAM_ID) ||
    (env.APPLE_API_KEY && env.APPLE_API_KEY_ID && env.APPLE_API_ISSUER) || env.APPLE_KEYCHAIN_PROFILE
  if (!notarization) throw new Error('Configure Apple notarization credentials in the signing environment.')
}
const feed = new URL(env.DREW_UPDATE_URL ?? 'http://localhost')
if (feed.protocol !== 'https:' || feed.username || feed.password || feed.search || feed.hash) {
  throw new Error('Set DREW_UPDATE_URL to the HTTPS directory for the stable channel.')
}
if (!feed.pathname.endsWith('/')) feed.pathname += '/'
const publisher = env.DREW_WINDOWS_PUBLISHER?.trim()
if (windows && !publisher) throw new Error('Set DREW_WINDOWS_PUBLISHER to the Windows signing certificate publisher.')

run(process.execPath, [env.npm_execpath, 'run', 'security:check'])
run(process.execPath, [env.npm_execpath, 'run', 'typecheck'])
run(process.execPath, [env.npm_execpath, 'run', 'lint'])
run(process.execPath, [env.npm_execpath, 'test'])
run(process.execPath, [env.npm_execpath, 'run', 'test:desktop'])

const policy = join(root, 'out', 'electron', 'main', 'update-policy.json')
writeFileSync(policy, JSON.stringify({
  provider: 'generic', url: feed.href, updaterCacheDirName: 'drew-browser-updater',
  ...(windows ? { publisherName: [publisher] } : {}),
}))
try {
  run(process.execPath, [
    join(root, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js'),
    ...(mac ? ['--mac', 'dmg', 'zip', '--arm64', '--x64'] : ['--win', 'nsis', '--x64', '--config.win.signtoolOptions.publisherName=' + publisher]),
    '--config.forceCodeSigning=true', '--config.directories.output=' + output,
    '--config.publish.provider=generic', '--config.publish.url=' + feed.href, '--publish', 'never',
  ])
} finally { rmSync(policy, { force: true }) }
if (!existsSync(join(output, mac ? 'latest-mac.yml' : 'latest.yml'))) throw new Error('The stable update manifest is missing.')

if (mac) {
  for (const arch of ['arm64', 'x64']) {
    const app = join(output, arch === 'arm64' ? 'mac-arm64' : 'mac', 'Drew.app')
    run('codesign', ['--verify', '--deep', '--strict', app])
    run('xcrun', ['stapler', 'validate', app])
    run('hdiutil', ['verify', join(output, `Drew-${version}-${arch}.dmg`)])
  }
} else {
  const installers = readdirSync(output).filter(path => /^Drew-Setup-.*\.exe$/.test(path))
  if (installers.length !== 1) throw new Error('Expected one Windows installer in the distribution folder.')
  for (const path of [join(output, 'win-unpacked', 'Drew.exe'), join(output, installers[0])]) {
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '$sig = Get-AuthenticodeSignature -LiteralPath $env:DREW_VERIFY_PATH; ' +
      'if ($sig.Status -ne "Valid" -or !$sig.TimeStamperCertificate) { throw "A valid, timestamped signature is required." }'],
    { env: { ...env, DREW_VERIFY_PATH: path } })
  }
}
console.log('Verified release files in ' + output)
