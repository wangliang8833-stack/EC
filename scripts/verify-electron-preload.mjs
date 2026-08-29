import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const desktopRoot = resolve('apps/desktop')
const mainBundlePath = resolve(desktopRoot, 'out/main/index.js')
const preloadBundlePath = resolve(desktopRoot, 'out/preload/index.cjs')
const accountLoginPreloadPath = resolve(desktopRoot, 'out/preload/account-login.cjs')

if (!existsSync(mainBundlePath) || !existsSync(preloadBundlePath) || !existsSync(accountLoginPreloadPath)) {
  throw new Error('Electron build artifacts are missing; run the desktop build first.')
}

const mainBundle = readFileSync(mainBundlePath, 'utf8')
const preloadBundle = readFileSync(preloadBundlePath, 'utf8')
const accountLoginPreload = readFileSync(accountLoginPreloadPath, 'utf8')

if (!mainBundle.includes('../preload/index.cjs')) {
  throw new Error('The main process does not reference the sandbox-compatible CommonJS preload bundle.')
}

if (!preloadBundle.includes('require("electron")') || /require\(["']\.\//.test(preloadBundle)) {
  throw new Error('The preload bundle is not CommonJS and cannot run in the sandboxed renderer.')
}

if (!mainBundle.includes('../preload/account-login.cjs')) {
  throw new Error('The account workspace does not reference its sandbox-compatible login preload bundle.')
}

if (!mainBundle.includes('nodeIntegrationInSubFrames: true')) {
  throw new Error('The account login preload must run inside isolated login subframes.')
}

if (!accountLoginPreload.includes('require("electron")') || /require\(["']\.\//.test(accountLoginPreload)) {
  throw new Error('The account login preload must be a self-contained sandbox-compatible CommonJS bundle.')
}

for (const channel of ['accounts:workspace:navigate', 'accounts:workspace:tab-activate', 'accounts:workspace:tab-close', 'accounts:workspace:state-changed']) {
  if (!mainBundle.includes(channel) || !preloadBundle.includes(channel)) {
    throw new Error(`The account tab browser contract is incomplete for ${channel}.`)
  }
}

if (mainBundle.includes('.relaunch(')) {
  throw new Error('The application must not automatically relaunch after a storage directory change.')
}

console.log('Electron build contracts verified: sandboxed CommonJS preload and user-controlled restart.')
