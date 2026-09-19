import { randomUUID } from 'node:crypto'
import { assertHistoryBackfillRequest, historyDates, isBusinessDate, shanghaiBusinessDate, shiftBusinessDate, type AccountConfig, type CollectionProbeResult, type HistoryBackfillItem, type HistoryBackfillJob, type HistoryBackfillPreview, type HistoryBackfillRequest, type HistoryDayInspection } from '@ecommerce/shared'
import type { AccountRepository } from '../accounts/account-repository.js'
import type { JsonStorageService } from '../storage/json-storage-service.js'
import type { TmallProbeRunOptions } from '../adapters/tmall/tmall-probe-service.js'
import { CollectionCancelledError, CollectionTimeoutError } from '../adapters/tmall/collection-execution.js'
import { selectEffectiveAccounts } from '../reports/data-update-service.js'
import { HistorySourceError } from '../adapters/tmall/tmall-history-store.js'
import type { CollectionCoordinator } from './collection-coordinator.js'

interface HistoryDataStore {
  inspect(account: AccountConfig, date: string): Promise<HistoryDayInspection>
  rebuild(account: AccountConfig, date: string, signal?: AbortSignal, runId?: string): Promise<void>
}
type Collector = (account: AccountConfig, options: TmallProbeRunOptions) => Promise<CollectionProbeResult>
const ACTIVE = new Set(['queued', 'running', 'pausing'])
const MAX_ATTEMPTS = 3

export class HistoryBackfillService {
  private readonly jobs = new Map<string, HistoryBackfillJob>()
  private readonly executions = new Map<string, Promise<void>>()
  private readonly controllers = new Map<string, AbortController>()
  private writes: Promise<void> = Promise.resolve()
  private commands: Promise<unknown> = Promise.resolve()
  private stopped = false
  private storageError: Error | null = null

  constructor(
    private readonly storage: JsonStorageService,
    private readonly accounts: Pick<AccountRepository, 'list' | 'updateLoginStatus'>,
    private readonly data: HistoryDataStore,
    private readonly coordinator: CollectionCoordinator,
    private readonly collect: Collector,
    private readonly changed: (job: HistoryBackfillJob) => void,
    private readonly now: () => Date = () => new Date(),
    private readonly retryDelays: readonly number[] = [15_000, 60_000]
  ) {}

  async start(): Promise<void> {
    for (const path of await this.storage.listChildren('data/backfill-jobs', 'json')) {
      const value: unknown = await this.storage.readJson(path)
      assertStoredJob(value, path)
      const job = value
      for (const item of job.items) if (item.status === 'running') {
        item.status = 'queued'
        item.message = '上次运行中断，继续时先检查已提交数据'
      }
      // Explicit resume avoids silently requesting stores on application startup.
      if (ACTIVE.has(job.status)) job.status = 'paused'
      this.jobs.set(job.jobId, job)
      await this.persist(job)
    }
  }

  list(): HistoryBackfillJob[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(job => structuredClone(job))
  }

  async preview(request: HistoryBackfillRequest): Promise<HistoryBackfillPreview> {
    assertHistoryBackfillRequest(request, shanghaiBusinessDate(this.now()))
    const dates = historyDates(request.dateStart, request.dateEnd)
    const accounts = await this.selectedAccounts(request)
    const items: HistoryBackfillItem[] = []
    for (const date of dates) for (const account of accounts) {
      const inspection = await this.data.inspect(account, date)
      const action = request.mode === 'refresh_selected' ? 'collect' : inspection.state === 'ready' ? 'skip' : inspection.state === 'rebuildable' ? 'rebuild' : 'collect'
      items.push({ ...inspection, key: `tmall/${account.shop_id}/${date}`, shopId: account.shop_id, shopName: account.shop_name,
        accountId: account.account_id, bizDate: date, status: 'queued', action, attempts: 0, runId: null, runIds: [], nextRetryAt: null, errorCode: null, message: inspection.reason, updatedAt: this.timestamp() })
    }
    return { request: structuredClone(request), items, total: items.length, collect: items.filter(item => item.action === 'collect').length, rebuild: items.filter(item => item.action === 'rebuild').length, skip: items.filter(item => item.action === 'skip').length }
  }

  create(request: HistoryBackfillRequest): Promise<HistoryBackfillJob> {
    return this.command(async () => {
      this.assertAvailable()
      this.assertNoActive()
      const preview = await this.preview(request)
      this.assertAvailable()
      assertHistoryBackfillRequest(request, shanghaiBusinessDate(this.now()))
      const job: HistoryBackfillJob = { ...preview, schemaVersion: '1.0.0', jobId: `backfill_${randomUUID().replaceAll('-', '')}`, anchorDate: shanghaiBusinessDate(this.now()), timezone: 'Asia/Shanghai', status: 'queued', createdAt: this.timestamp(), updatedAt: this.timestamp(), lastError: null }
      await this.persist(job)
      this.jobs.set(job.jobId, job)
      this.launch(job)
      return structuredClone(job)
    })
  }

  pause(jobId: string): Promise<void> {
    return this.command(async () => {
      const job = this.require(jobId)
      if (!ACTIVE.has(job.status)) return
      job.status = this.executions.has(jobId) ? 'pausing' : 'paused'
      await this.persist(job)
    })
  }

  cancel(jobId: string): Promise<void> {
    return this.command(async () => {
      const job = this.require(jobId)
      if (job.status === 'completed' || job.status === 'completed_with_gaps') return
      job.status = 'cancelled'
      for (const item of job.items) {
        this.controllers.get(`${jobId}/${item.key}`)?.abort()
        if (item.status === 'queued' || item.status === 'need_login') { item.status = 'cancelled'; item.message = '任务已取消' }
      }
      await this.persist(job)
    })
  }

  resume(jobId: string, retryFailed = false): Promise<void> {
    return this.command(async () => {
      this.assertAvailable()
      const job = this.require(jobId)
      if (this.executions.has(jobId)) throw new Error('任务仍在停止或执行，请稍后继续')
      this.assertNoActive()
      const today = shanghaiBusinessDate(this.now())
      for (const item of job.items) {
        if ((item.status === 'succeeded' || item.status === 'skipped') && !(retryFailed && item.coverage.some(field => field.retryable))) continue
        if (item.bizDate < shiftBusinessDate(today, -30) || item.bizDate >= today) {
          item.status = 'failed'; item.errorCode = 'DATE_EXPIRED'; item.message = '日期已超出最近 30 个完整自然日，未发起请求'; continue
        }
        if (item.status === 'failed' && !retryFailed) continue
        if (retryFailed || item.status !== 'queued') item.nextRetryAt = null
        item.status = 'queued'
        item.errorCode = null
        // Explicit retry is a new user-requested attempt budget; restart/resume is not.
        if (retryFailed) item.attempts = 0
      }
      if (!job.items.some(item => item.status === 'queued')) { job.status = this.terminalStatus(job); await this.persist(job); return }
      job.status = 'queued'; job.lastError = null
      await this.persist(job)
      this.launch(job)
    })
  }

  async stop(): Promise<void> {
    this.stopped = true
    for (const job of this.jobs.values()) if (ACTIVE.has(job.status)) job.status = 'pausing'
    for (const controller of this.controllers.values()) controller.abort()
    await this.commands
    await Promise.allSettled([...this.executions.values()])
    await this.writes
  }

  /** Used by shutdown and integration tests; UI receives incremental persisted events. */
  async waitForIdle(): Promise<void> { await Promise.all([...this.executions.values()]); await this.writes }

  private launch(job: HistoryBackfillJob): void {
    const execution = this.execute(job).catch(async error => {
      job.status = 'needs_attention'
      job.lastError = error instanceof Error ? error.message : String(error)
      for (const [key, controller] of this.controllers) if (key.startsWith(`${job.jobId}/`)) controller.abort()
      await this.persist(job).catch(() => this.changed(structuredClone(job)))
    }).finally(() => this.executions.delete(job.jobId))
    this.executions.set(job.jobId, execution)
  }

  private async execute(job: HistoryBackfillJob): Promise<void> {
    job.status = 'running'
    await this.persist(job)
    const busyShops = new Set<string>()
    const active = new Set<Promise<void>>()
    let executionFailure: unknown
    try {
      while (!this.stopped && job.status === 'running') {
        if (executionFailure) throw executionFailure
        this.assertAvailable()
        const next = job.items.find(item => item.status === 'queued' && !busyShops.has(item.shopId) && (!item.nextRetryAt || Date.parse(item.nextRetryAt) <= this.now().getTime()))
        if (next && active.size < job.request.concurrency) {
          busyShops.add(next.shopId)
          next.status = 'running'
          const work = this.process(job, next).catch(error => { executionFailure = error }).finally(() => { busyShops.delete(next.shopId); active.delete(work) })
          active.add(work)
          continue
        }
        if (active.size) { await Promise.race(active); continue }
        if (!job.items.some(item => item.status === 'queued')) break
        await new Promise(resolve => setTimeout(resolve, 250))
      }
    } finally { await Promise.allSettled(active) }
    if (executionFailure) throw executionFailure
    this.finish(job)
    await this.persist(job)
  }

  private finish(job: HistoryBackfillJob): void {
    if (job.status === 'pausing' || this.stopped) job.status = 'paused'
    else if (job.status !== 'cancelled') job.status = this.terminalStatus(job)
  }

  private async process(job: HistoryBackfillJob, item: HistoryBackfillItem): Promise<void> {
    const controller = new AbortController()
    const controllerKey = `${job.jobId}/${item.key}`
    this.controllers.set(controllerKey, controller)
    try {
      await this.persist(job)
      await this.coordinator.run([`shop:tmall/${item.shopId}`, `account:${item.accountId}`], async () => {
        if (job.status !== 'running') { item.status = job.status === 'cancelled' ? 'cancelled' : 'queued'; return }
        const account = (await this.accounts.list()).find(value => value.account_id === item.accountId && value.shop_id === item.shopId && value.platform === 'tmall' && value.enabled)
        if (!account) { item.status = 'failed'; item.errorCode = 'ACCOUNT_UNAVAILABLE'; item.message = '执行账号已停用或不存在'; return }
        const inspection = await this.data.inspect(account, item.bizDate)
        Object.assign(item, inspection)
        // A crash may happen after report commit but before saving item status.
        const recovering = item.attempts > 0 && item.message.includes('上次运行中断') && !!inspection.committedRunId && item.runIds.includes(inspection.committedRunId)
        if (inspection.state === 'ready' && (job.request.mode === 'missing_only' || recovering)) {
          item.status = 'skipped'; item.action = 'skip'; item.message = '有效数据已存在，未重复采集'; return
        }
        if (inspection.state === 'rebuildable' && job.request.mode === 'missing_only') {
          item.action = 'rebuild'
          const runId = this.assignRun(item)
          await this.persist(job)
          await this.data.rebuild(account, item.bizDate, controller.signal, runId)
          Object.assign(item, await this.data.inspect(account, item.bizDate))
          item.status = 'succeeded'; item.message = '已从本地 Raw 重建；覆盖情况见明细'; return
        }
        if (item.attempts >= MAX_ATTEMPTS) { item.status = 'failed'; item.errorCode = 'RETRY_EXHAUSTED'; item.message = '已达到自动重试上限，请处理原因后手动重试'; return }
        item.action = 'collect'; item.attempts += 1
        const runId = this.assignRun(item)
        item.message = `正在采集 ${item.bizDate}（第 ${item.attempts} 次）`
        await this.persist(job)
        const result = await this.collect(account, { bizDate: item.bizDate, runId, background: true, forceRefresh: true, historyBackfill: true, signal: controller.signal,
          onProgress: async progress => { item.message = progress.message; await this.persist(job) } })
        if (result.status === 'NEED_HUMAN_LOGIN') {
          await this.accounts.updateLoginStatus(account.account_id, 'need_human_login', this.timestamp())
          for (const sibling of job.items.filter(value => value.shopId === item.shopId && (value.status === 'queued' || value === item))) {
            sibling.status = 'need_login'; sibling.errorCode = 'NEED_LOGIN'; sibling.message = '登录失效，该店铺剩余日期等待登录后继续'
          }
          return
        }
        Object.assign(item, await this.data.inspect(account, item.bizDate))
        if (item.state === 'retryable_partial' && item.attempts < MAX_ATTEMPTS) { this.retry(item, 'PARTIAL_RESPONSE', '已保存有效日报，部分接口缺口将在退避后重试'); return }
        if (item.state === 'missing' || item.state === 'invalid') { item.status = 'failed'; item.errorCode = 'SOURCE_INVALID'; item.message = item.reason; return }
        item.status = 'succeeded'; item.message = '该日已采集，字段覆盖见明细'
      }, controller.signal, 0)
    } catch (error) {
      if (error instanceof CollectionCancelledError || controller.signal.aborted) {
        item.status = this.stopped ? 'queued' : 'cancelled'; item.message = this.stopped ? '上次运行中断，继续时先检查已提交数据' : '采集已取消'
      } else {
        const message = error instanceof Error ? error.message : String(error)
        const retryable = error instanceof CollectionTimeoutError || (error instanceof HistorySourceError && error.retryable) || /ECONNRESET|ETIMEDOUT|网络|FETCH_TIMEOUT|FETCH_FAILED|429|503|502/i.test(message)
        if (retryable && item.attempts > 0 && item.attempts < MAX_ATTEMPTS && job.status === 'running') this.retry(item, 'TRANSIENT_ERROR', message)
        else { item.status = 'failed'; item.errorCode = 'COLLECTION_FAILED'; item.message = message }
      }
    } finally {
      this.controllers.delete(controllerKey)
      item.updatedAt = this.timestamp()
      await this.persist(job)
    }
  }

  private retry(item: HistoryBackfillItem, code: string, message: string): void {
    item.status = 'queued'; item.errorCode = code; item.message = message
    item.nextRetryAt = new Date(this.now().getTime() + (this.retryDelays[item.attempts - 1] ?? 60_000)).toISOString()
  }
  private assignRun(item: HistoryBackfillItem): string {
    const runId = `run_${randomUUID().replaceAll('-', '')}`
    item.runId = runId; item.runIds.push(runId); item.nextRetryAt = null; item.errorCode = null
    return runId
  }
  private terminalStatus(job: HistoryBackfillJob): HistoryBackfillJob['status'] {
    if (job.items.some(item => item.status === 'failed' || item.status === 'need_login' || item.status === 'queued' || item.status === 'cancelled')) return 'needs_attention'
    return job.items.some(item => item.coverage.some(field => field.status !== 'available')) ? 'completed_with_gaps' : 'completed'
  }
  private async selectedAccounts(request: HistoryBackfillRequest): Promise<AccountConfig[]> {
    const selected = selectEffectiveAccounts(await this.accounts.list()).filter(account => request.shopIds.includes(account.shop_id))
    const missing = request.shopIds.filter(id => !selected.some(account => account.shop_id === id))
    if (missing.length) throw new Error(`以下店铺未启用或不支持历史补采：${missing.join('、')}`)
    return selected
  }
  private require(id: string): HistoryBackfillJob {
    const job = this.jobs.get(id)
    if (!job) throw new Error('找不到该历史补采任务')
    return job
  }
  private assertNoActive(): void { if ([...this.jobs.values()].some(job => ACTIVE.has(job.status)) || this.executions.size) throw new Error('已有历史补采任务运行中，请先暂停或等待完成') }
  private assertAvailable(): void { if (this.storageError) throw this.storageError; if (this.stopped) throw new Error('程序正在退出') }
  private timestamp(): string { return this.now().toISOString() }
  private persist(job: HistoryBackfillJob): Promise<void> {
    job.updatedAt = this.timestamp()
    const snapshot = structuredClone(job)
    const write = this.writes.then(async () => {
      if (this.storageError) throw this.storageError
      await this.storage.writeJson(`data/backfill-jobs/${job.jobId}.json`, snapshot)
      this.changed(snapshot)
    })
    this.writes = write.catch(error => {
      this.storageError ??= new Error(`补采任务保存失败，已停止执行：${error instanceof Error ? error.message : String(error)}`)
      for (const controller of this.controllers.values()) controller.abort()
    })
    return write
  }
  private command<T>(operation: () => Promise<T>): Promise<T> {
    const work = this.commands.then(operation)
    this.commands = work.catch(() => undefined)
    return work
  }
}

function assertStoredJob(value: unknown, path: string): asserts value is HistoryBackfillJob {
  if (!value || typeof value !== 'object') throw new Error(`历史补采记录损坏：${path}`)
  const job = value as HistoryBackfillJob
  if (job.schemaVersion !== '1.0.0' || !/^backfill_[a-f0-9]{32}$/.test(job.jobId) || path !== `data/backfill-jobs/${job.jobId}.json` || !isBusinessDate(job.anchorDate) || !timestamp(job.createdAt) || !timestamp(job.updatedAt) || job.timezone !== 'Asia/Shanghai' || (job.lastError !== null && typeof job.lastError !== 'string')) throw new Error(`历史补采记录标识无效：${path}`)
  assertHistoryBackfillRequest(job.request, job.anchorDate)
  const dates = new Set(historyDates(job.request.dateStart, job.request.dateEnd))
  if (!['queued', 'running', 'pausing', 'paused', 'needs_attention', 'completed', 'completed_with_gaps', 'cancelled'].includes(job.status) || !Array.isArray(job.items) || job.items.length !== dates.size * job.request.shopIds.length || new Set(job.items.map(item => item.key)).size !== job.items.length) throw new Error(`历史补采任务结构损坏：${path}`)
  for (const item of job.items) {
    if (!item || !job.request.shopIds.includes(item.shopId) || !dates.has(item.bizDate) || item.key !== `tmall/${item.shopId}/${item.bizDate}` || !/^[A-Za-z0-9_-]{3,128}$/.test(item.accountId) || !Number.isInteger(item.attempts) || item.attempts < 0 || item.attempts > MAX_ATTEMPTS || !Array.isArray(item.runIds) || item.runIds.some(id => typeof id !== 'string' || !/^run_[A-Za-z0-9_-]{1,128}$/.test(id)) || !Array.isArray(item.coverage) || !['queued', 'running', 'succeeded', 'skipped', 'need_login', 'failed', 'cancelled'].includes(item.status)) throw new Error(`历史补采子任务损坏：${path}`)
    if (!timestamp(item.updatedAt) || (item.nextRetryAt !== null && !timestamp(item.nextRetryAt)) || typeof item.message !== 'string' || typeof item.reason !== 'string' || typeof item.shopName !== 'string' || (item.errorCode !== null && typeof item.errorCode !== 'string') || (item.runId !== null && !item.runIds.includes(item.runId)) || !['collect', 'rebuild', 'skip'].includes(item.action) || !['ready', 'rebuildable', 'missing', 'retryable_partial', 'invalid'].includes(item.state)) throw new Error(`历史补采子任务字段无效：${path}`)
    if (item.coverage.some(field => !field || typeof field.key !== 'string' || typeof field.label !== 'string' || typeof field.reason !== 'string' || typeof field.retryable !== 'boolean' || !['available', 'partial', 'missing', 'unsupported', 'permission_denied'].includes(field.status))) throw new Error(`历史补采覆盖字段无效：${path}`)
  }
  if (job.total !== job.items.length || [job.collect, job.rebuild, job.skip].some(count => !Number.isInteger(count) || count < 0) || job.collect + job.rebuild + job.skip !== job.total) throw new Error(`历史补采计数无效：${path}`)
}

function timestamp(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)) }
