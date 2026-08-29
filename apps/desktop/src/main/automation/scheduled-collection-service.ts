import { randomUUID } from 'node:crypto'
import type { AccountConfig, DataUpdateRequest, DataUpdateResult, JobRunRef, JobSummary, ScheduledJobInput } from '@ecommerce/shared'
import type { AccountRepository } from '../accounts/account-repository.js'
import type { JsonStorageService } from '../storage/json-storage-service.js'
import type { DataUpdateOptions } from '../reports/data-update-service.js'

const STORAGE_PATH = 'config/scheduled-collection-tasks.json'
const TICK_INTERVAL_MS = 30_000

interface StoredJobs {
  schema_version: '1.0.0'
  jobs: JobSummary[]
}

type DataUpdateRunner = (request: DataUpdateRequest, options: DataUpdateOptions) => Promise<DataUpdateResult>

export class ScheduledCollectionService {
  private jobs: JobSummary[] = []
  private timer: NodeJS.Timeout | null = null
  private readonly activeRuns = new Map<string, { jobId: string; controller: AbortController }>()

  constructor(
    private readonly storage: JsonStorageService,
    private readonly accounts: Pick<AccountRepository, 'list'>,
    private readonly runUpdate: DataUpdateRunner,
    private readonly onChanged: (jobs: JobSummary[]) => void
  ) {}

  async start(): Promise<void> {
    try {
      this.jobs = (await this.storage.readJson<StoredJobs>(STORAGE_PATH)).jobs.map(refreshDerivedStatus)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.jobs = []
    }
    await this.persist()
    await this.tick()
    this.timer = setInterval(() => void this.tick(), TICK_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const { controller } of this.activeRuns.values()) controller.abort()
    this.activeRuns.clear()
  }

  list(): JobSummary[] {
    return this.jobs.map(refreshDerivedStatus).map(cloneJob)
  }

  async create(input: ScheduledJobInput): Promise<JobSummary> {
    assertScheduledJobInput(input)
    const now = new Date().toISOString()
    const job: JobSummary = {
      ...input,
      jobId: `job_${randomUUID().replaceAll('-', '')}`,
      timezone: 'Asia/Shanghai',
      status: input.enabled ? 'pending' : 'disabled',
      nextRunAt: input.enabled ? nextScheduledRun(input.scheduleTime) : null,
      lastRunAt: null,
      lastCompletedAt: null,
      lastRunId: null,
      lastResult: null,
      lastError: null,
      createdAt: now,
      updatedAt: now
    }
    this.jobs.push(job)
    await this.persist()
    return cloneJob(job)
  }

  async update(jobId: string, input: ScheduledJobInput): Promise<JobSummary> {
    assertScheduledJobInput(input)
    const index = this.requireJobIndex(jobId)
    if (this.jobs[index]!.status === 'running') throw new Error('正在执行的任务不能编辑')
    const previous = this.jobs[index]!
    const updated: JobSummary = {
      ...previous,
      ...input,
      status: input.enabled ? 'pending' : 'disabled',
      nextRunAt: input.enabled ? nextScheduledRun(input.scheduleTime) : null,
      updatedAt: new Date().toISOString()
    }
    this.jobs[index] = updated
    await this.persist()
    return cloneJob(updated)
  }

  async delete(jobId: string): Promise<void> {
    const index = this.requireJobIndex(jobId)
    if (this.jobs[index]!.status === 'running') throw new Error('正在执行的任务不能删除，请先取消')
    this.jobs.splice(index, 1)
    await this.persist()
  }

  async run(jobId: string): Promise<JobRunRef> {
    const job = this.jobs[this.requireJobIndex(jobId)]!
    if (!job.enabled) throw new Error('任务已停用，请先编辑并启用')
    if (job.status === 'running') throw new Error('任务正在执行')
    const runId = `run_${randomUUID().replaceAll('-', '')}`
    const controller = new AbortController()
    this.activeRuns.set(runId, { jobId, controller })
    job.status = 'running'
    job.lastRunId = runId
    job.lastRunAt = new Date().toISOString()
    job.lastError = null
    job.updatedAt = job.lastRunAt
    await this.persist()
    void this.execute(jobId, runId, controller)
    return { runId, status: 'QUEUED' }
  }

  async cancel(runId: string): Promise<void> {
    const active = this.activeRuns.get(runId)
    if (!active) throw new Error('该运行已结束或不存在')
    active.controller.abort()
  }

  async retry(runId: string): Promise<JobRunRef> {
    const job = this.jobs.find((candidate) => candidate.lastRunId === runId)
    if (!job) throw new Error('找不到该运行对应的任务')
    return this.run(job.jobId)
  }

  private async execute(jobId: string, runId: string, controller: AbortController): Promise<void> {
    const job = this.jobs.find((candidate) => candidate.jobId === jobId)
    if (!job) return
    try {
      const accounts = effectiveAccounts(await this.accounts.list(), job.platforms)
      if (accounts.length === 0) throw new Error('所选平台没有已启用店铺')
      const result = await this.runUpdate({
        bizDate: businessDate(job.dateStrategy),
        platforms: [...new Set(accounts.map(({ platform }) => platform))],
        shopIds: [...new Set(accounts.map(({ shop_id }) => shop_id))]
      }, {
        signal: controller.signal,
        concurrency: job.concurrency,
        batchIntervalMs: job.batchIntervalMinutes * 60_000
      })
      if (result.total === 0) throw new Error('所选平台暂未接入可执行的数据采集适配器')
      job.status = result.failed > 0 || result.needLogin > 0 ? 'failed' : 'completed'
      job.lastResult = result
      job.lastError = result.failed > 0 || result.needLogin > 0
        ? `失败 ${result.failed} 家，待登录 ${result.needLogin} 家`
        : null
    } catch (error) {
      job.status = 'failed'
      job.lastError = controller.signal.aborted ? '任务已取消' : errorMessage(error)
    } finally {
      this.activeRuns.delete(runId)
      const completedAt = new Date().toISOString()
      job.lastCompletedAt = completedAt
      job.nextRunAt = job.enabled ? nextScheduledRun(job.scheduleTime, completedAt) : null
      job.updatedAt = completedAt
      await this.persist()
    }
  }

  private async tick(): Promise<void> {
    const now = Date.now()
    for (const job of this.jobs) {
      if (!job.enabled || job.status === 'running' || !job.nextRunAt) continue
      if (Date.parse(job.nextRunAt) <= now) {
        await this.run(job.jobId)
        return
      }
    }
  }

  private requireJobIndex(jobId: string): number {
    const index = this.jobs.findIndex((job) => job.jobId === jobId)
    if (index < 0) throw new Error(`采集任务不存在：${jobId}`)
    return index
  }

  private async persist(): Promise<void> {
    await this.storage.writeJson(STORAGE_PATH, { schema_version: '1.0.0', jobs: this.jobs } satisfies StoredJobs)
    this.onChanged(this.list())
  }
}

export function assertScheduledJobInput(value: unknown): asserts value is ScheduledJobInput {
  if (!value || typeof value !== 'object') throw new TypeError('任务配置必须是对象')
  const input = value as Partial<ScheduledJobInput>
  if (typeof input.name !== 'string' || input.name.trim().length < 1 || input.name.length > 100) throw new TypeError('任务名称长度必须为 1—100')
  if (typeof input.scheduleTime !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.scheduleTime)) throw new TypeError('执行时间必须使用 HH:mm')
  if (!Array.isArray(input.platforms) || input.platforms.length < 1 || input.platforms.some((item) => typeof item !== 'string' || !/^[a-z][a-z0-9_-]{1,31}$/.test(item))) throw new TypeError('至少选择一个有效平台')
  if (input.dateStrategy !== 'today' && input.dateStrategy !== 'yesterday') throw new TypeError('数据日期策略无效')
  if (!Number.isInteger(input.concurrency) || input.concurrency! < 1 || input.concurrency! > 10) throw new TypeError('并行店铺数必须为 1—10')
  if (!Number.isInteger(input.batchIntervalMinutes) || input.batchIntervalMinutes! < 0 || input.batchIntervalMinutes! > 1440) throw new TypeError('批次间隔必须为 0—1440 分钟')
  if (typeof input.enabled !== 'boolean') throw new TypeError('启用状态必须为布尔值')
}

function effectiveAccounts(accounts: AccountConfig[], platforms: string[]): AccountConfig[] {
  const selectedPlatforms = new Set(platforms)
  const allPlatforms = selectedPlatforms.has('all')
  const unique = new Map<string, AccountConfig>()
  for (const account of accounts.filter(({ enabled, platform }) => enabled && platform === 'tmall' && (allPlatforms || selectedPlatforms.has(platform)))) {
    const key = `${account.platform}/${account.shop_id}`
    const current = unique.get(key)
    if (!current || (current.login_status !== 'authenticated' && account.login_status === 'authenticated')) unique.set(key, account)
  }
  return [...unique.values()]
}

function refreshDerivedStatus(job: JobSummary): JobSummary {
  if (!job.enabled && job.status !== 'running') return { ...job, status: 'disabled', nextRunAt: null }
  return job
}

function cloneJob(job: JobSummary): JobSummary {
  return structuredClone(job)
}

function businessDate(strategy: ScheduledJobInput['dateStrategy'], now = new Date()): string {
  const today = shanghaiDate(now)
  if (strategy === 'today') return today
  const [year, month, day] = today.split('-').map(Number) as [number, number, number]
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10)
}

function nextScheduledRun(scheduleTime: string, after = new Date().toISOString()): string {
  const today = shanghaiDate(new Date(after))
  let candidate = new Date(`${today}T${scheduleTime}:00+08:00`)
  if (candidate.getTime() <= Date.parse(after)) {
    const [year, month, day] = today.split('-').map(Number) as [number, number, number]
    const tomorrow = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10)
    candidate = new Date(`${tomorrow}T${scheduleTime}:00+08:00`)
  }
  return candidate.toISOString()
}

function shanghaiDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const value = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${value.year}-${value.month}-${value.day}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
