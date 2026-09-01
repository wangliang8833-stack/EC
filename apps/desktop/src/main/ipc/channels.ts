export const IPC_CHANNELS = {
  accountsList: 'accounts:list',
  accountsCreate: 'accounts:create',
  accountsUpdate: 'accounts:update',
  accountsSetCredentials: 'accounts:set-credentials',
  accountsSetEnabled: 'accounts:set-enabled',
  accountsWorkspaceOpen: 'accounts:workspace:open',
  accountsWorkspaceLayout: 'accounts:workspace:layout',
  accountsWorkspaceClose: 'accounts:workspace:close',
  accountsWorkspaceNavigate: 'accounts:workspace:navigate',
  accountsWorkspaceShortcutOpen: 'accounts:workspace:shortcut-open',
  accountsWorkspaceTabActivate: 'accounts:workspace:tab-activate',
  accountsWorkspaceTabClose: 'accounts:workspace:tab-close',
  accountsWorkspaceStateChanged: 'accounts:workspace:state-changed',
  accountsCheckLogin: 'accounts:check-login',
  accountsTestCollection: 'accounts:test-collection',
  accountsCancelCollection: 'accounts:cancel-collection',
  accountsCollectionProgress: 'accounts:collection-progress',
  accountsLoginStatusChanged: 'accounts:login-status-changed',
  jobsList: 'jobs:list',
  jobsCreate: 'jobs:create',
  jobsUpdate: 'jobs:update',
  jobsDelete: 'jobs:delete',
  jobsRun: 'jobs:run',
  jobsCancel: 'jobs:cancel',
  jobsRetry: 'jobs:retry',
  jobsChanged: 'jobs:changed',
  reportsQuery: 'reports:query',
  reportsUpdate: 'reports:update',
  reportsCancelUpdate: 'reports:cancel-update',
  reportsExportCsv: 'reports:export-csv',
  systemHealth: 'system:health',
  systemChooseExportDirectory: 'system:choose-export-directory',
  systemStorageSettingsGet: 'system:storage-settings:get',
  systemStorageDirectoryChoose: 'system:storage-directory:choose',
  systemStorageSettingsUpdate: 'system:storage-settings:update'
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

export const ACCOUNT_LOGIN_AUTOMATION_CHANNELS = {
  credentials: 'account-login-automation:credentials',
  status: 'account-login-automation:status'
} as const
