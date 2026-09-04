export const LOGIN_STATES = [
  'unknown',
  'authenticated',
  'expired',
  'need_human_login',
  'captcha_required',
  'login_failed',
  'locked',
  'disabled'
] as const

export type LoginState = (typeof LOGIN_STATES)[number]

export const JOB_STATUSES = [
  'PENDING',
  'QUEUED',
  'RUNNING',
  'SUCCESS',
  'PARTIAL_SUCCESS',
  'NEED_HUMAN_LOGIN',
  'PAGE_CHANGED',
  'DOWNLOAD_FAILED',
  'DATA_VALIDATION_FAILED',
  'RETRYING',
  'CANCELLED',
  'DEAD_LETTER'
] as const

export type JobStatus = (typeof JOB_STATUSES)[number]

export const QUALITY_STATUSES = [
  'passed',
  'passed_with_warning',
  'partial',
  'failed',
  'quarantined'
] as const

export type QualityStatus = (typeof QUALITY_STATUSES)[number]

export interface AccountConfig {
  schema_version: '1.0.0'
  account_id: string
  platform: string
  shop_id: string
  shop_name: string
  subaccount_name: string
  owner: string
  session_partition: string
  credential_ref: string | null
  login_url: string
  allowed_hosts: string[]
  enabled: boolean
  login_status: LoginState
  last_login_checked_at: string | null
  created_at: string
  updated_at: string
}

export interface ShopConfig {
  schema_version: '1.0.0'
  shop_id: string
  platform: string
  shop_name: string
  owner_id: string
  enabled: boolean
  created_at: string
  updated_at: string
}

export interface RetryPolicy {
  max_attempts: number
  backoff_seconds: number[]
}

export interface JobConfig {
  schema_version: '1.0.0'
  job_id: string
  name: string
  platform: string
  account_ids: string[]
  data_type: string
  schedule: {
    type: 'cron'
    expression: string
    timezone: 'Asia/Shanghai'
    jitter_seconds: number
  }
  date_strategy: string[]
  retry: RetryPolicy
  timeout_seconds: number
  enabled: boolean
}

export interface AccountContext {
  account: AccountConfig
  run_id: string
  data_root: string
}

export interface DateRange {
  start: string
  end: string
}

export interface DataTarget {
  data_type: string
  page_key: string
}

export interface RawCollectionResult {
  schema_version: '1.0.0'
  record_type: 'raw_collection'
  run_id: string
  platform: string
  shop_id: string
  account_id: string
  data_type: string
  data_date: string
  collection_method: 'network_response' | 'download' | 'dom' | 'ocr' | 'fixture'
  adapter_version: string
  source: Record<string, unknown>
  collected_at: string
  payload: Record<string, unknown>
  validation: {
    status: QualityStatus
    warnings: string[]
  }
  integrity: {
    sha256: string | null
    previous_run_id: string | null
  }
}

export interface ValidationResult {
  valid: boolean
  warnings: string[]
  errors: string[]
}

export interface CollectionError {
  code: string
  message: string
  failed_step: string
  recoverable: boolean
}

export type RecoveryAction =
  | { type: 'retry'; delay_ms: number }
  | { type: 'need_human_login' }
  | { type: 'abort'; reason: string }

export interface PlatformAdapter {
  readonly platform: string
  readonly version: string
  checkLogin(context: AccountContext): Promise<LoginState>
  navigate(context: AccountContext, target: DataTarget): Promise<void>
  setDateRange(context: AccountContext, range: DateRange): Promise<void>
  collect(context: AccountContext, target: DataTarget): Promise<RawCollectionResult>
  validate(result: RawCollectionResult): Promise<ValidationResult>
  recover(error: CollectionError): Promise<RecoveryAction>
}

export interface AccountSummary {
  accountId: string
  platform: string
  shopId: string
  shopName: string
  subaccountName: string
  owner: string
  enabled: boolean
  loginStatus: LoginState
  lastLoginCheckedAt: string | null
}

export const ACCOUNT_PLATFORMS = ['tmall', 'pinduoduo', 'taobao', 'jd', 'douyin', 'kuaishou', 'wechat_channels', '1688'] as const
export type AccountPlatform = (typeof ACCOUNT_PLATFORMS)[number]

export interface CreateAccountInput {
  platform: AccountPlatform
  shopName: string
  subaccountName: string
  owner: string
  authorizationConfirmed: boolean
}

export interface AccountCredentialInput {
  username: string
  password: string
  authorizationConfirmed: boolean
}

export interface UpdateAccountInput {
  shopName: string
  subaccountName: string
  owner: string
}

export interface AccountLoginCheckResult {
  accountId: string
  status: LoginState
  checkedAt: string
  currentUrl: string | null
}

export interface CollectionProbeResult {
  runId: string
  accountId: string
  status: 'SUCCESS' | 'ALREADY_COLLECTED' | 'NEED_HUMAN_LOGIN'
  pageUrl: string
  pageTitle: string
  tableCount: number
  rowCount: number
  relativePath: string | null
  warning: string | null
  bizDate?: string
  datasetCount?: number
  dashboardRelativePath?: string | null
  normalizedPaths?: string[]
  qualityStatus?: 'complete' | 'partial'
}

export type CollectionProgressStage =
  | 'precheck'
  | 'navigating'
  | 'capturing'
  | 'persisting_raw'
  | 'normalizing'
  | 'persisting_report'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface CollectionProgress {
  runId: string
  accountId: string
  bizDate: string
  stage: CollectionProgressStage
  pageIndex: number | null
  pageCount: number
  pageKey: string | null
  message: string
  elapsedMs: number
  updatedAt: string
}

export type ScheduledJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'disabled'
export type JobDateStrategy = 'today' | 'yesterday'

export interface ScheduledJobInput {
  name: string
  scheduleTime: string
  platforms: string[]
  dateStrategy: JobDateStrategy
  concurrency: number
  batchIntervalMinutes: number
  enabled: boolean
}

export interface JobSummary extends ScheduledJobInput {
  jobId: string
  timezone: 'Asia/Shanghai'
  status: ScheduledJobStatus
  nextRunAt: string | null
  lastRunAt: string | null
  lastCompletedAt: string | null
  lastRunId: string | null
  lastResult: DataUpdateResult | null
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export interface JobRunRef {
  runId: string
  status: JobStatus
}

export interface ReportQuery {
  reportType: string
  dateStart: string
  dateEnd: string
  platforms: string[]
  shopIds: string[]
  ownerIds: string[]
}

export interface DataUpdateRequest {
  bizDate: string
  platforms: string[]
  shopIds: string[]
  forceRefresh?: boolean
}

export type DataUpdateShopStatus = 'SUCCESS' | 'ALREADY_COLLECTED' | 'NEED_HUMAN_LOGIN' | 'FAILED'

export interface DataUpdateShopResult {
  accountId: string
  shopId: string
  shopName: string
  platform: string
  status: DataUpdateShopStatus
  warning: string | null
}

export interface DataUpdateResult {
  bizDate: string
  timezone: 'Asia/Shanghai'
  startedAt: string
  completedAt: string
  total: number
  updated: number
  skipped: number
  needLogin: number
  failed: number
  shops: DataUpdateShopResult[]
}

export interface ReportDataset {
  schema_version: '1.0.0'
  report_type: string
  dataset_id: string
  filters: ReportQuery
  meta: {
    shop_name: string
    date_range: string
    updated_at: string
    biz_date: string
    data_status: 'real' | 'empty'
    collection_status: 'completed' | 'not_collected'
    normalizer_version?: string
    data_finality?: 'realtime' | 'final'
    source_validation?: {
      status: 'passed' | 'partial'
      validated_at: string
      critical_endpoint_count: number
      warning_count: number
    }
  }
  summary: Record<string, string | number | null>
  trend: Array<Record<string, string | number | null>>
  shop_rows: Array<Record<string, string | number | null>>
  sections: {
    channels: Array<Record<string, string | number | null>>
    keywords: Array<Record<string, string | number | null>>
    campaigns: Array<Record<string, string | number | null>>
    alerts: Array<Record<string, string | number | null>>
    service: Array<Record<string, string | number | null>>
    shop_overview?: Array<Record<string, string | number | null>>
    promotion_accounts?: Array<Record<string, string | number | null>>
    promotion_campaigns?: Array<Record<string, string | number | null>>
    promotion_items?: Array<Record<string, string | number | null>>
    promotion_keywords?: Array<Record<string, string | number | null>>
    promotion_crowds?: Array<Record<string, string | number | null>>
    promotion_creatives?: Array<Record<string, string | number | null>>
    promotion_regions?: Array<Record<string, string | number | null>>
    promotion_hourly?: Array<Record<string, string | number | null>>
  }
  quality: {
    complete_shop_count: number
    missing_shop_count: number
    warning_count: number
    status: 'complete' | 'partial' | 'empty'
    dataset_count: number
    warnings: string[]
  }
  source_paths: string[]
  generated_at: string
}

export interface CsvExportRequest {
  query: ReportQuery
  destinationDirectory?: string
}

export interface ExportResult {
  filePath: string
  rowCount: number
  sha256: string
}

export interface SystemHealth {
  status: 'ok' | 'degraded'
  version: string
  dataRoot: string
  developmentLogPath: string
  timestamp: string
}

export type StorageDirectoryKind = 'local_data' | 'environment_data'

export interface SystemStorageSettings {
  localDataDirectory: string
  environmentDataDirectory: string
  activeLocalDataDirectory: string
  activeEnvironmentDataDirectory: string
  restartRequired: boolean
  updatedAt: string | null
  remoteStorageStatus: 'not_implemented'
  remoteServerStatus: 'not_implemented'
}

export type AiProviderCode = 'openai' | 'deepseek' | 'qwen' | 'openai_compatible'
export type AiTaskType = 'product_selection_analysis' | 'ecommerce_operation_strategy' | 'analytics_explanation' | 'analytics_question_planning'

export interface AiModelSettings {
  provider: AiProviderCode
  baseUrl: string
  models: string[]
  defaultModel: string | null
  apiKeyConfigured: boolean
  updatedAt: string | null
}

export interface UpdateAiModelSettingsInput {
  provider: AiProviderCode
  baseUrl: string
  models: string[]
  defaultModel: string
  apiKey?: string
}

export interface AiConnectionTestResult {
  connected: boolean
  model: string
  message: string
  checkedAt: string
}

export interface AiGenerateRequest {
  task: AiTaskType
  model: string
  systemPrompt: string
  input: Record<string, unknown>
}

export interface AiGenerateResult {
  requestId: string
  task: AiTaskType
  provider: AiProviderCode
  model: string
  output: Record<string, unknown>
  generatedAt: string
  durationMs: number
}

export type AiDecisionModule = 'selection' | 'operations'

export interface AiDecisionInput {
  module: AiDecisionModule
  entityId: string
  action: 'ADD_TO_POOL' | 'WATCH' | 'REJECT' | 'SUBMIT_FOR_APPROVAL' | 'APPROVE' | 'DECLINE'
  summary: string
  payload: Record<string, unknown>
}

export interface AiDecisionRecord extends AiDecisionInput {
  decisionId: string
  createdAt: string
}

export interface UpdateStorageSettingsInput {
  localDataDirectory: string
  environmentDataDirectory: string
}

export interface WorkspaceBounds {
  x: number
  y: number
  width: number
  height: number
}

export type WorkspaceNavigationAction = 'back' | 'forward' | 'reload'
export type TmallWorkspaceShortcut = 'sycm' | 'wanxiang' | 'seller' | 'dmp'

export interface WorkspaceTabSummary {
  tabId: string
  title: string
  active: boolean
  canGoBack: boolean
  canGoForward: boolean
  loading: boolean
  closable: boolean
}

export interface WorkspaceBrowserState {
  leaseId: string
  accountId: string
  revision: number
  activeTabId: string
  tabs: WorkspaceTabSummary[]
}

export interface DesktopApi {
  accounts: {
    list(): Promise<AccountSummary[]>
    create(input: CreateAccountInput): Promise<AccountSummary>
    update(accountId: string, input: UpdateAccountInput): Promise<AccountSummary>
    setCredentials(accountId: string, input: AccountCredentialInput): Promise<AccountSummary>
    setEnabled(accountId: string, enabled: boolean): Promise<AccountSummary>
    openWorkspace(accountId: string, bounds: WorkspaceBounds, leaseId: string): Promise<WorkspaceBrowserState | null>
    layoutWorkspace(leaseId: string, bounds: WorkspaceBounds): Promise<void>
    closeWorkspace(leaseId?: string): Promise<void>
    navigateWorkspace(leaseId: string, action: WorkspaceNavigationAction): Promise<WorkspaceBrowserState>
    openWorkspaceShortcut(leaseId: string, shortcut: TmallWorkspaceShortcut): Promise<WorkspaceBrowserState>
    activateWorkspaceTab(leaseId: string, tabId: string): Promise<WorkspaceBrowserState>
    closeWorkspaceTab(leaseId: string, tabId: string): Promise<WorkspaceBrowserState>
    checkLogin(accountId: string): Promise<AccountLoginCheckResult>
    testCollection(accountId: string): Promise<CollectionProbeResult>
    cancelCollection(accountId: string): Promise<void>
    onLoginStatusChanged(listener: (account: AccountSummary) => void): () => void
    onWorkspaceStateChanged(listener: (state: WorkspaceBrowserState) => void): () => void
    onCollectionProgress(listener: (progress: CollectionProgress) => void): () => void
  }
  jobs: {
    list(): Promise<JobSummary[]>
    create(input: ScheduledJobInput): Promise<JobSummary>
    update(jobId: string, input: ScheduledJobInput): Promise<JobSummary>
    delete(jobId: string): Promise<void>
    run(jobId: string): Promise<JobRunRef>
    cancel(runId: string): Promise<void>
    retry(runId: string): Promise<JobRunRef>
    onChanged(listener: (jobs: JobSummary[]) => void): () => void
  }
  reports: {
    query(input: ReportQuery): Promise<ReportDataset>
    update(input: DataUpdateRequest): Promise<DataUpdateResult>
    cancelUpdate(): Promise<void>
    exportCsv(input: CsvExportRequest): Promise<ExportResult>
  }
  ai: {
    getSettings(): Promise<AiModelSettings>
    updateSettings(input: UpdateAiModelSettingsInput): Promise<AiModelSettings>
    testConnection(model?: string): Promise<AiConnectionTestResult>
    generate(input: AiGenerateRequest): Promise<AiGenerateResult>
    listDecisions(module: AiDecisionModule): Promise<AiDecisionRecord[]>
    saveDecision(input: AiDecisionInput): Promise<AiDecisionRecord>
  }
  system: {
    getHealth(): Promise<SystemHealth>
    chooseExportDirectory(): Promise<string | null>
    getStorageSettings(): Promise<SystemStorageSettings>
    chooseStorageDirectory(kind: StorageDirectoryKind): Promise<string | null>
    updateStorageSettings(input: UpdateStorageSettingsInput): Promise<SystemStorageSettings>
  }
}
