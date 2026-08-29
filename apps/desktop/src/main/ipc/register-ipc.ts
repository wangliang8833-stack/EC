import { randomUUID } from 'node:crypto'
import { app, dialog, ipcMain, type BrowserWindow } from 'electron'
import type { DataUpdateRequest, DataUpdateResult, ReportDataset, ReportQuery, ScheduledJobInput, SystemStorageSettings } from '@ecommerce/shared'
import type { AccountRepository } from '../accounts/account-repository.js'
import type { AccountCredentialVault } from '../accounts/account-credential-vault.js'
import type { TmallProbeService } from '../adapters/tmall/tmall-probe-service.js'
import type { BrowserProfileManager } from '../browser/browser-profile-manager.js'
import type { JsonStorageService } from '../storage/json-storage-service.js'
import type { PersistedStorageSettings, StorageSettingsRepository } from '../settings/storage-settings-repository.js'
import { DataUpdateService, selectEffectiveAccounts } from '../reports/data-update-service.js'
import { ScheduledCollectionService } from '../automation/scheduled-collection-service.js'
import { aggregateReports } from '../reports/report-aggregation.js'
import { assertAccountCredentialInput, assertCreateAccountInput, assertDataUpdateRequest, assertReportQuery, assertSafeId, assertStorageDirectoryKind, assertUpdateAccountInput, assertUpdateStorageSettingsInput, assertWorkspaceBounds } from '../security/input-validation.js'
import { IPC_CHANNELS } from './channels.js'

export interface IpcServices {
  accounts: AccountRepository
  credentialVault: AccountCredentialVault
  browserProfiles: BrowserProfileManager
  tmallProbe: TmallProbeService
  storageSettings: StorageSettingsRepository
  storage: JsonStorageService
  dataRoot: string
  environmentDataRoot: string
  developmentLogPath: string
  getMainWindow: () => BrowserWindow | null
}

export function registerIpcHandlers(services: IpcServices): () => void {
  const activeCollections = new Map<string, AbortController>()
  const dataUpdate = new DataUpdateService(services.accounts, services.tmallProbe)
  let activeDataUpdate: AbortController | null = null
  const publishCollectionProgress = (progress: import('@ecommerce/shared').CollectionProgress): void => {
    const window = services.getMainWindow()
    if (window && !window.isDestroyed()) window.webContents.send(IPC_CHANNELS.accountsCollectionProgress, progress)
  }
  const runDataUpdate = async (request: DataUpdateRequest, options: import('../reports/data-update-service.js').DataUpdateOptions = {}): Promise<DataUpdateResult> => {
    if (activeDataUpdate || activeCollections.size > 0) throw new Error('已有数据采集任务正在执行，请等待完成或先取消任务。')
    const controller = new AbortController()
    const abortFromCaller = (): void => controller.abort()
    options.signal?.addEventListener('abort', abortFromCaller, { once: true })
    activeDataUpdate = controller
    try {
      return await dataUpdate.run(request, { ...options, signal: controller.signal, onProgress: options.onProgress ?? publishCollectionProgress })
    } finally {
      options.signal?.removeEventListener('abort', abortFromCaller)
      if (activeDataUpdate === controller) activeDataUpdate = null
    }
  }
  const scheduledJobs = new ScheduledCollectionService(
    services.storage,
    services.accounts,
    runDataUpdate,
    (jobs) => {
      const window = services.getMainWindow()
      if (window && !window.isDestroyed()) window.webContents.send(IPC_CHANNELS.jobsChanged, jobs)
    }
  )
  const scheduledJobsReady = scheduledJobs.start()
  ipcMain.handle(IPC_CHANNELS.accountsList, () => services.accounts.summaries())
  ipcMain.handle(IPC_CHANNELS.accountsCreate, async (_event, input: unknown) => {
    assertCreateAccountInput(input)
    return services.accounts.toSummary(await services.accounts.create(input))
  })
  ipcMain.handle(IPC_CHANNELS.accountsUpdate, async (_event, accountId: unknown, input: unknown) => {
    assertSafeId(accountId, 'accountId')
    assertUpdateAccountInput(input)
    return services.accounts.toSummary(await services.accounts.updateProfile(accountId, input))
  })
  ipcMain.handle(IPC_CHANNELS.accountsSetCredentials, async (_event, accountId: unknown, input: unknown) => {
    assertSafeId(accountId, 'accountId')
    assertAccountCredentialInput(input)
    await services.accounts.get(accountId)
    const credentialRef = await services.credentialVault.save(accountId, { username: input.username, password: input.password })
    const updated = await services.accounts.updateCredentialRef(accountId, credentialRef)
    await services.browserProfiles.refreshCredentials(updated)
    return services.accounts.toSummary(updated)
  })
  ipcMain.handle(IPC_CHANNELS.accountsSetEnabled, async (_event, accountId: unknown, enabled: unknown) => {
    assertSafeId(accountId, 'accountId')
    if (typeof enabled !== 'boolean') throw new TypeError('enabled must be a boolean')
    const updated = await services.accounts.updateEnabled(accountId, enabled)
    if (!enabled) await services.browserProfiles.closeAccount(accountId)
    return services.accounts.toSummary(updated)
  })
  ipcMain.handle(IPC_CHANNELS.accountsWorkspaceOpen, async (_event, accountId: unknown, bounds: unknown, leaseId: unknown) => {
    assertSafeId(accountId, 'accountId')
    assertSafeId(leaseId, 'leaseId')
    assertWorkspaceBounds(bounds)
    const window = services.getMainWindow()
    if (!window || window.isDestroyed()) throw new Error('Main workspace window is unavailable')
    assertBoundsFitWindow(bounds, window)
    const account = await services.accounts.get(accountId)
    const opened = await services.browserProfiles.openWorkspace(account, window, bounds, leaseId)
    if (!opened) return null
    const inspection = services.browserProfiles.inspectLogin(account)
    await services.accounts.updateLoginStatus(accountId, inspection.status, new Date().toISOString())
    return opened
  })
  ipcMain.handle(IPC_CHANNELS.accountsWorkspaceLayout, (_event, leaseId: unknown, bounds: unknown) => {
    assertSafeId(leaseId, 'leaseId')
    assertWorkspaceBounds(bounds)
    const window = services.getMainWindow()
    if (!window || window.isDestroyed()) throw new Error('Main workspace window is unavailable')
    assertBoundsFitWindow(bounds, window)
    services.browserProfiles.layoutWorkspace(leaseId, bounds)
  })
  ipcMain.handle(IPC_CHANNELS.accountsWorkspaceClose, async (_event, leaseId: unknown) => {
    if (leaseId !== undefined) assertSafeId(leaseId, 'leaseId')
    await services.browserProfiles.closeWorkspace(leaseId)
  })
  ipcMain.handle(IPC_CHANNELS.accountsWorkspaceNavigate, (_event, leaseId: unknown, action: unknown) => {
    assertSafeId(leaseId, 'leaseId')
    if (action !== 'back' && action !== 'forward' && action !== 'reload') throw new TypeError('Unsupported workspace navigation action')
    return services.browserProfiles.navigateWorkspace(leaseId, action)
  })
  ipcMain.handle(IPC_CHANNELS.accountsWorkspaceTabActivate, (_event, leaseId: unknown, tabId: unknown) => {
    assertSafeId(leaseId, 'leaseId')
    assertSafeId(tabId, 'tabId')
    return services.browserProfiles.activateWorkspaceTab(leaseId, tabId)
  })
  ipcMain.handle(IPC_CHANNELS.accountsWorkspaceTabClose, (_event, leaseId: unknown, tabId: unknown) => {
    assertSafeId(leaseId, 'leaseId')
    assertSafeId(tabId, 'tabId')
    return services.browserProfiles.closeWorkspaceTab(leaseId, tabId)
  })
  ipcMain.handle(IPC_CHANNELS.accountsCheckLogin, async (_event, accountId: unknown) => {
    assertSafeId(accountId, 'accountId')
    const account = await services.accounts.get(accountId)
    const inspection = services.browserProfiles.inspectLogin(account)
    const checkedAt = new Date().toISOString()
    await services.accounts.updateLoginStatus(accountId, inspection.status, checkedAt)
    return { accountId, status: inspection.status, checkedAt, currentUrl: inspection.currentUrl }
  })
  ipcMain.handle(IPC_CHANNELS.accountsTestCollection, async (_event, accountId: unknown) => {
    assertSafeId(accountId, 'accountId')
    if (activeDataUpdate) throw new Error('所有店铺数据正在统一更新，请等待完成或先取消更新。')
    if (activeCollections.has(accountId)) throw new Error('该账号已有采集任务正在执行，请等待完成或先取消任务。')
    const account = await services.accounts.get(accountId)
    const controller = new AbortController()
    activeCollections.set(accountId, controller)
    try {
      const result = await services.tmallProbe.run(account, {
        signal: controller.signal,
        onProgress: (progress) => {
          const window = services.getMainWindow()
          if (window && !window.isDestroyed()) window.webContents.send(IPC_CHANNELS.accountsCollectionProgress, progress)
        }
      })
      if (result.status === 'NEED_HUMAN_LOGIN') {
        await services.accounts.updateLoginStatus(accountId, 'need_human_login', new Date().toISOString())
      }
      return result
    } finally {
      if (activeCollections.get(accountId) === controller) activeCollections.delete(accountId)
    }
  })
  ipcMain.handle(IPC_CHANNELS.accountsCancelCollection, (_event, accountId: unknown) => {
    assertSafeId(accountId, 'accountId')
    activeCollections.get(accountId)?.abort()
    services.browserProfiles.cancelDailyCollection(accountId)
  })

  ipcMain.handle(IPC_CHANNELS.jobsList, async () => { await scheduledJobsReady; return scheduledJobs.list() })
  ipcMain.handle(IPC_CHANNELS.jobsCreate, async (_event, input: unknown) => {
    await scheduledJobsReady
    return scheduledJobs.create(input as ScheduledJobInput)
  })
  ipcMain.handle(IPC_CHANNELS.jobsUpdate, async (_event, jobId: unknown, input: unknown) => {
    assertSafeId(jobId, 'jobId')
    await scheduledJobsReady
    return scheduledJobs.update(jobId, input as ScheduledJobInput)
  })
  ipcMain.handle(IPC_CHANNELS.jobsDelete, async (_event, jobId: unknown) => {
    assertSafeId(jobId, 'jobId')
    await scheduledJobsReady
    return scheduledJobs.delete(jobId)
  })
  ipcMain.handle(IPC_CHANNELS.jobsRun, async (_event, jobId: unknown) => {
    assertSafeId(jobId, 'jobId')
    await scheduledJobsReady
    return scheduledJobs.run(jobId)
  })
  ipcMain.handle(IPC_CHANNELS.jobsCancel, async (_event, runId: unknown) => {
    assertSafeId(runId, 'runId')
    await scheduledJobsReady
    return scheduledJobs.cancel(runId)
  })
  ipcMain.handle(IPC_CHANNELS.jobsRetry, async (_event, runId: unknown) => {
    assertSafeId(runId, 'runId')
    await scheduledJobsReady
    return scheduledJobs.retry(runId)
  })

  ipcMain.handle(IPC_CHANNELS.reportsQuery, async (_event, input: unknown): Promise<ReportDataset> => {
    assertReportQuery(input)
    const query: ReportQuery = input
    if (query.shopIds.length > 0 && query.platforms.includes('tmall')) {
      const requestedShopIds = new Set(query.shopIds)
      const accounts = selectEffectiveAccounts(await services.accounts.list()).filter(({ shop_id }) => requestedShopIds.has(shop_id))
      const reports: ReportDataset[] = []
      for (const account of accounts) {
        const report = await services.tmallProbe.getCompletedReport(account, query.dateEnd)
        if (report) reports.push(report)
      }
      const aggregate = aggregateReports(query, new Set(query.shopIds).size, reports)
      if (aggregate) return aggregate
    }
    return emptyReport(query)
  })
  ipcMain.handle(IPC_CHANNELS.reportsUpdate, async (_event, input: unknown): Promise<DataUpdateResult> => {
    assertDataUpdateRequest(input)
    return runDataUpdate(input)
  })
  ipcMain.handle(IPC_CHANNELS.reportsCancelUpdate, () => {
    activeDataUpdate?.abort()
  })
  ipcMain.handle(IPC_CHANNELS.reportsExportCsv, () => {
    throw new Error('CSV export is not implemented yet')
  })

  ipcMain.handle(IPC_CHANNELS.systemHealth, () => ({
    status: 'ok' as const,
    version: app.getVersion(),
    dataRoot: services.dataRoot,
    developmentLogPath: services.developmentLogPath,
    timestamp: new Date().toISOString()
  }))
  ipcMain.handle(IPC_CHANNELS.systemChooseExportDirectory, async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle(IPC_CHANNELS.systemStorageSettingsGet, () => {
    return toStorageSettingsResponse(services.storageSettings.loadSync(), services)
  })
  ipcMain.handle(IPC_CHANNELS.systemStorageDirectoryChoose, async (_event, kind: unknown) => {
    assertStorageDirectoryKind(kind)
    const settings = services.storageSettings.loadSync()
    const defaultPath = kind === 'local_data' ? settings.local_data_directory : settings.environment_data_directory
    const result = await dialog.showOpenDialog({
      title: kind === 'local_data' ? '选择本地业务数据存储目录' : '选择程序环境数据存储目录',
      defaultPath,
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle(IPC_CHANNELS.systemStorageSettingsUpdate, async (_event, input: unknown) => {
    assertUpdateStorageSettingsInput(input)
    return toStorageSettingsResponse(await services.storageSettings.save(input), services)
  })

  return () => {
    scheduledJobs.stop()
    activeDataUpdate?.abort()
    activeDataUpdate = null
    for (const controller of activeCollections.values()) controller.abort()
    activeCollections.clear()
    for (const channel of Object.values(IPC_CHANNELS)) ipcMain.removeHandler(channel)
  }
}

function emptyReport(query: ReportQuery): ReportDataset {
  const generatedAt = new Date().toISOString()
  return {
    schema_version: '1.0.0', report_type: query.reportType, dataset_id: `rpt_${randomUUID().replaceAll('-', '')}`, filters: query,
    meta: { shop_name: '', date_range: `${query.dateStart}—${query.dateEnd}`, updated_at: generatedAt, biz_date: query.dateEnd, data_status: 'empty', collection_status: 'not_collected' },
    summary: {}, trend: [], shop_rows: [], sections: { channels: [], keywords: [], campaigns: [], alerts: [], service: [] },
    quality: { complete_shop_count: 0, missing_shop_count: query.shopIds.length, warning_count: 1, status: 'empty', dataset_count: 0, warnings: ['尚未生成该日期的报表数据集。'] },
    source_paths: [], generated_at: generatedAt
  }
}

function toStorageSettingsResponse(settings: PersistedStorageSettings, services: IpcServices): SystemStorageSettings {
  return {
    localDataDirectory: settings.local_data_directory,
    environmentDataDirectory: settings.environment_data_directory,
    activeLocalDataDirectory: services.dataRoot,
    activeEnvironmentDataDirectory: services.environmentDataRoot,
    restartRequired:
      !samePath(settings.local_data_directory, services.dataRoot) ||
      !samePath(settings.environment_data_directory, services.environmentDataRoot),
    updatedAt: settings.updated_at,
    remoteStorageStatus: 'not_implemented',
    remoteServerStatus: 'not_implemented'
  }
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}

function assertBoundsFitWindow(bounds: { x: number; y: number; width: number; height: number }, window: BrowserWindow): void {
  const size = window.getContentSize()
  const windowWidth = size[0] ?? 0
  const windowHeight = size[1] ?? 0
  if (bounds.x + bounds.width > windowWidth + 1 || bounds.y + bounds.height > windowHeight + 1) {
    throw new TypeError(`workspace bounds exceed the main window: ${bounds.x},${bounds.y},${bounds.width},${bounds.height} within ${windowWidth}x${windowHeight}`)
  }
}
