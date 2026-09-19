import { mkdirSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { app, BrowserWindow, Menu, safeStorage, shell } from 'electron'
import type { WorkspaceBrowserState } from '@ecommerce/shared'
import pino from 'pino'
import { AccountCredentialVault } from './accounts/account-credential-vault.js'
import { AccountRepository } from './accounts/account-repository.js'
import { TmallProbeService } from './adapters/tmall/tmall-probe-service.js'
import { BrowserProfileManager } from './browser/browser-profile-manager.js'
import { SessionCookieVault } from './browser/session-cookie-vault.js'
import { registerIpcHandlers } from './ipc/register-ipc.js'
import { IPC_CHANNELS } from './ipc/channels.js'
import { StorageSettingsRepository, type PersistedStorageSettings } from './settings/storage-settings-repository.js'
import { JsonStorageService } from './storage/json-storage-service.js'
import { AiModelSettingsRepository } from './ai/ai-model-settings-repository.js'
import { LlmProvider } from './ai/llm-provider.js'
import { AiDecisionRepository } from './ai/ai-decision-repository.js'

// Honor an explicit Chromium profile argument before resolving settings/locks (also used by isolated package verification).
const explicitUserData = app.commandLine.getSwitchValue('user-data-dir')
if (explicitUserData) {
  if (!isAbsolute(explicitUserData)) throw new TypeError('user-data-dir must be absolute')
  mkdirSync(explicitUserData, { recursive: true })
  app.setPath('userData', explicitUserData)
}
const primaryInstance = app.requestSingleInstanceLock()
if (!primaryInstance) app.quit()

const loggerOptions: pino.LoggerOptions = {
  level: process.env['LOG_LEVEL'] ?? 'info',
  redact: {
    paths: ['password', 'token', 'cookie', 'authorization', '*.password', '*.token', '*.cookie', '*.authorization', '*.credentials'],
    censor: '[REDACTED]'
  }
}
let logger = pino(loggerOptions)

let disposeIpc: (() => Promise<void>) | undefined
let browserProfiles: BrowserProfileManager | undefined
let mainWindow: BrowserWindow | null = null
let quitFlushInProgress = false
let quitFlushCompleted = false
const storageSettings = new StorageSettingsRepository(app.getPath('userData'))
let startupStorageSettings: PersistedStorageSettings
try {
  startupStorageSettings = storageSettings.loadSync()
} catch (error) {
  logger.error({ err: error }, 'invalid storage settings; using defaults for this launch')
  startupStorageSettings = storageSettings.defaults()
}
app.setPath('sessionData', startupStorageSettings.environment_data_directory)
const developmentLogPath = join(startupStorageSettings.local_data_directory, 'logs', 'development', 'application.jsonl')
try {
  mkdirSync(join(startupStorageSettings.local_data_directory, 'logs', 'development'), { recursive: true })
  logger = pino(loggerOptions, pino.multistream([
    { stream: process.stdout },
    { stream: pino.destination({ dest: developmentLogPath, sync: false }) }
  ]))
} catch (error) {
  logger.error({ err: error, developmentLogPath }, 'failed to initialize development file log; console logging remains active')
}

async function createMainWindow(): Promise<BrowserWindow> {
  const windowIcon = app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(__dirname, '../../resources/icon.png')
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    title: '电商多店铺数据管理平台',
    icon: windowIcon,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay: process.platform === 'win32'
      ? { color: '#29253b', symbolColor: '#dfe8f6', height: 58 }
      : false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  })
  window.setMenuBarVisibility(false)
  mainWindow = window

  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    logger.error({ err: error, preloadPath }, 'preload script failed')
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.once('ready-to-show', () => window.show())
  window.once('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  const rendererUrl = process.env['ELECTRON_RENDERER_URL']
  if (rendererUrl) await window.loadURL(rendererUrl)
  else await window.loadFile(join(__dirname, '../renderer/index.html'))
  return window
}

async function bootstrap(): Promise<void> {
  app.setAppUserModelId('com.company.ecommerce-data-platform')
  Menu.setApplicationMenu(null)
  const dataRoot = startupStorageSettings.local_data_directory
  const storage = new JsonStorageService(dataRoot)
  await storage.initialize()
  const accounts = new AccountRepository(dataRoot, storage)
  const credentialEncryption = {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (value: string) => safeStorage.encryptString(value),
    decrypt: (value: Buffer) => safeStorage.decryptString(value)
  }
  const credentialVault = new AccountCredentialVault(app.getPath('sessionData'), credentialEncryption)
  const aiSettings = new AiModelSettingsRepository(storage, app.getPath('sessionData'), credentialEncryption)
  const llm = new LlmProvider(aiSettings, storage, logger.child({ component: 'llm-provider' }))
  const aiDecisions = new AiDecisionRepository(storage)
  const sessionCookieVault = new SessionCookieVault(app.getPath('sessionData'), {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (value) => safeStorage.encryptString(value),
    decrypt: (value) => safeStorage.decryptString(value)
  })
  const statusUpdates = new Map<string, Promise<void>>()
  const publishLoginStatus = (accountId: string, status: import('@ecommerce/shared').LoginState): Promise<void> => {
    const previous = statusUpdates.get(accountId) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(async () => {
      const updated = await accounts.updateLoginStatus(accountId, status, new Date().toISOString())
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.accountsLoginStatusChanged, accounts.toSummary(updated))
      }
    })
    statusUpdates.set(accountId, current)
    return current.finally(() => {
      if (statusUpdates.get(accountId) === current) statusUpdates.delete(accountId)
    })
  }
  const publishWorkspaceState = (state: WorkspaceBrowserState): void => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.accountsWorkspaceStateChanged, state)
    }
  }
  browserProfiles = new BrowserProfileManager(dataRoot, sessionCookieVault, credentialVault, publishLoginStatus, publishWorkspaceState)
  const tmallProbe = new TmallProbeService(browserProfiles, storage, logger.child({ component: 'tmall-collection' }))
  disposeIpc = registerIpcHandlers({
    accounts,
    credentialVault,
    browserProfiles,
    tmallProbe,
    storageSettings,
    storage,
    aiSettings,
    llm,
    aiDecisions,
    dataRoot,
    environmentDataRoot: app.getPath('sessionData'),
    developmentLogPath,
    getMainWindow: () => mainWindow
  })
  await createMainWindow()
  logger.info({ dataRoot, developmentLogPath }, 'application started')
}

if (primaryInstance) app.whenReady().then(bootstrap).catch((error: unknown) => {
  logger.fatal({ err: error }, 'application bootstrap failed')
  app.quit()
})

app.on('activate', () => {
  if (primaryInstance && BrowserWindow.getAllWindows().length === 0) void createMainWindow()
})

app.on('second-instance', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', (event) => {
  if (quitFlushCompleted) return
  event.preventDefault()
  if (quitFlushInProgress) return
  quitFlushInProgress = true
  void (disposeIpc?.() ?? Promise.resolve())
    .then(() => browserProfiles?.closeAll())
    .catch((error: unknown) => logger.error({ err: error }, 'failed to flush account sessions before quit'))
    .finally(() => {
      quitFlushCompleted = true
      app.quit()
    })
})
