import { contextBridge, ipcRenderer } from 'electron'
import type { CsvExportRequest, DataUpdateRequest, DesktopApi, ReportQuery } from '@ecommerce/shared'
import { IPC_CHANNELS } from '../main/ipc/channels.js'

const desktopApi: DesktopApi = {
  accounts: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.accountsList),
    create: (input) => ipcRenderer.invoke(IPC_CHANNELS.accountsCreate, input),
    update: (accountId, input) => ipcRenderer.invoke(IPC_CHANNELS.accountsUpdate, accountId, input),
    setCredentials: (accountId, input) => ipcRenderer.invoke(IPC_CHANNELS.accountsSetCredentials, accountId, input),
    setEnabled: (accountId, enabled) => ipcRenderer.invoke(IPC_CHANNELS.accountsSetEnabled, accountId, enabled),
    openWorkspace: (accountId, bounds, leaseId) => ipcRenderer.invoke(IPC_CHANNELS.accountsWorkspaceOpen, accountId, bounds, leaseId),
    layoutWorkspace: (leaseId, bounds) => ipcRenderer.invoke(IPC_CHANNELS.accountsWorkspaceLayout, leaseId, bounds),
    closeWorkspace: (leaseId) => ipcRenderer.invoke(IPC_CHANNELS.accountsWorkspaceClose, leaseId),
    navigateWorkspace: (leaseId, action) => ipcRenderer.invoke(IPC_CHANNELS.accountsWorkspaceNavigate, leaseId, action),
    activateWorkspaceTab: (leaseId, tabId) => ipcRenderer.invoke(IPC_CHANNELS.accountsWorkspaceTabActivate, leaseId, tabId),
    closeWorkspaceTab: (leaseId, tabId) => ipcRenderer.invoke(IPC_CHANNELS.accountsWorkspaceTabClose, leaseId, tabId),
    checkLogin: (accountId) => ipcRenderer.invoke(IPC_CHANNELS.accountsCheckLogin, accountId),
    testCollection: (accountId) => ipcRenderer.invoke(IPC_CHANNELS.accountsTestCollection, accountId),
    cancelCollection: (accountId) => ipcRenderer.invoke(IPC_CHANNELS.accountsCancelCollection, accountId),
    onLoginStatusChanged: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, account: Parameters<typeof listener>[0]) => listener(account)
      ipcRenderer.on(IPC_CHANNELS.accountsLoginStatusChanged, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.accountsLoginStatusChanged, handler)
    },
    onWorkspaceStateChanged: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, state: Parameters<typeof listener>[0]) => listener(state)
      ipcRenderer.on(IPC_CHANNELS.accountsWorkspaceStateChanged, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.accountsWorkspaceStateChanged, handler)
    },
    onCollectionProgress: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, progress: Parameters<typeof listener>[0]) => listener(progress)
      ipcRenderer.on(IPC_CHANNELS.accountsCollectionProgress, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.accountsCollectionProgress, handler)
    }
  },
  jobs: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.jobsList),
    create: (input) => ipcRenderer.invoke(IPC_CHANNELS.jobsCreate, input),
    update: (jobId, input) => ipcRenderer.invoke(IPC_CHANNELS.jobsUpdate, jobId, input),
    delete: (jobId) => ipcRenderer.invoke(IPC_CHANNELS.jobsDelete, jobId),
    run: (jobId) => ipcRenderer.invoke(IPC_CHANNELS.jobsRun, jobId),
    cancel: (runId) => ipcRenderer.invoke(IPC_CHANNELS.jobsCancel, runId),
    retry: (runId) => ipcRenderer.invoke(IPC_CHANNELS.jobsRetry, runId),
    onChanged: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, jobs: Parameters<typeof listener>[0]) => listener(jobs)
      ipcRenderer.on(IPC_CHANNELS.jobsChanged, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.jobsChanged, handler)
    }
  },
  reports: {
    query: (input: ReportQuery) => ipcRenderer.invoke(IPC_CHANNELS.reportsQuery, input),
    update: (input: DataUpdateRequest) => ipcRenderer.invoke(IPC_CHANNELS.reportsUpdate, input),
    cancelUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.reportsCancelUpdate),
    exportCsv: (input: CsvExportRequest) => ipcRenderer.invoke(IPC_CHANNELS.reportsExportCsv, input)
  },
  system: {
    getHealth: () => ipcRenderer.invoke(IPC_CHANNELS.systemHealth),
    chooseExportDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.systemChooseExportDirectory),
    getStorageSettings: () => ipcRenderer.invoke(IPC_CHANNELS.systemStorageSettingsGet),
    chooseStorageDirectory: (kind) => ipcRenderer.invoke(IPC_CHANNELS.systemStorageDirectoryChoose, kind),
    updateStorageSettings: (input) => ipcRenderer.invoke(IPC_CHANNELS.systemStorageSettingsUpdate, input)
  }
}

contextBridge.exposeInMainWorld('desktopApi', desktopApi)
