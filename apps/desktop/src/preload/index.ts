import { contextBridge, ipcRenderer } from 'electron'
import type { AiDecisionInput, AiDecisionModule, AiGenerateRequest, CsvExportRequest, DataUpdateRequest, DesktopApi, ReportQuery, UpdateAiModelSettingsInput } from '@ecommerce/shared'
import { IPC_CHANNELS } from '../main/ipc/channels.js'

const desktopApi: DesktopApi = {
  history: {
    preview: input => ipcRenderer.invoke(IPC_CHANNELS.historyPreview, input),
    create: input => ipcRenderer.invoke(IPC_CHANNELS.historyCreate, input),
    list: () => ipcRenderer.invoke(IPC_CHANNELS.historyList),
    pause: jobId => ipcRenderer.invoke(IPC_CHANNELS.historyPause, jobId),
    resume: jobId => ipcRenderer.invoke(IPC_CHANNELS.historyResume, jobId),
    cancel: jobId => ipcRenderer.invoke(IPC_CHANNELS.historyCancel, jobId),
    retryFailed: jobId => ipcRenderer.invoke(IPC_CHANNELS.historyRetry, jobId),
    onChanged: listener => {
      const handler = (_event: Electron.IpcRendererEvent, job: Parameters<typeof listener>[0]) => listener(job)
      ipcRenderer.on(IPC_CHANNELS.historyChanged, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.historyChanged, handler)
    }
  },
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
    openWorkspaceShortcut: (leaseId, shortcut) => ipcRenderer.invoke(IPC_CHANNELS.accountsWorkspaceShortcutOpen, leaseId, shortcut),
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
  ai: {
    getSettings: () => ipcRenderer.invoke(IPC_CHANNELS.aiSettingsGet),
    updateSettings: (input: UpdateAiModelSettingsInput) => ipcRenderer.invoke(IPC_CHANNELS.aiSettingsUpdate, input),
    testConnection: (model?: string) => ipcRenderer.invoke(IPC_CHANNELS.aiConnectionTest, model),
    generate: (input: AiGenerateRequest) => ipcRenderer.invoke(IPC_CHANNELS.aiGenerate, input),
    listDecisions: (module: AiDecisionModule) => ipcRenderer.invoke(IPC_CHANNELS.aiDecisionsList, module),
    saveDecision: (input: AiDecisionInput) => ipcRenderer.invoke(IPC_CHANNELS.aiDecisionSave, input)
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
