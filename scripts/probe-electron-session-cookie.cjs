const { mkdirSync, writeFileSync } = require('node:fs')
const { resolve } = require('node:path')
const { app, safeStorage, session } = require('electron')

const phase = process.argv.find((argument) => argument.startsWith('--phase='))?.split('=')[1]
const dataArgument = process.argv.find((argument) => argument.startsWith('--data='))?.slice('--data='.length)
const restoreLastSession = process.argv.includes('--restore-last-session')
const vaultModuleArgument = process.argv.find((argument) => argument.startsWith('--vault-module='))?.slice('--vault-module='.length)

if ((phase !== 'write' && phase !== 'read') || !dataArgument) {
  throw new Error('Usage: electron probe-electron-session-cookie.cjs --phase=write|read --data=<path> [--restore-last-session]')
}

const probeRoot = resolve(dataArgument)
mkdirSync(probeRoot, { recursive: true })
app.setPath('userData', probeRoot)
app.setPath('sessionData', probeRoot)
if (restoreLastSession) app.commandLine.appendSwitch('restore-last-session')

async function main() {
  await app.whenReady()
  const probeSession = session.fromPartition('persist:session-cookie-probe')
  const vault = vaultModuleArgument ? createVault(vaultModuleArgument) : undefined

  if (phase === 'write') {
    await probeSession.cookies.set({
      url: 'https://example.com/',
      name: 'codex_session_probe',
      value: 'value-never-printed',
      secure: true,
      httpOnly: true,
      sameSite: 'lax'
    })
    if (vault) await vault.snapshot(probeAccount, probeSession.cookies)
    await probeSession.cookies.flushStore()
    probeSession.flushStorageData()
    writeFileSync(resolve(probeRoot, 'write-result.txt'), 'write_count=1\n', 'utf8')
  } else {
    if (vault) await vault.restore(probeAccount, probeSession.cookies)
    const cookies = await probeSession.cookies.get({
      url: 'https://example.com/',
      name: 'codex_session_probe'
    })
    writeFileSync(resolve(probeRoot, 'read-result.txt'), `read_count=${cookies.length}\n`, 'utf8')
  }

  app.exit(0)
}

function createVault(modulePath) {
  const { SessionCookieVault } = require(resolve(modulePath))
  return new SessionCookieVault(probeRoot, {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (value) => safeStorage.encryptString(value),
    decrypt: (value) => safeStorage.decryptString(value)
  })
}

const probeAccount = {
  account_id: 'acc_session_cookie_probe',
  allowed_hosts: ['example.com']
}

main().catch((error) => {
  writeFileSync(resolve(probeRoot, `${phase}-error.txt`), String(error?.stack ?? error), 'utf8')
  app.exit(1)
})
