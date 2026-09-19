import { randomUUID } from 'node:crypto'
import type { AccountConfig, CollectionProbeResult, CollectionProgress, CollectionProgressStage, ReportDataset } from '@ecommerce/shared'
import type { BrowserProfileManager, TmallCapturedPage, TmallDailySnapshot } from '../../browser/browser-profile-manager.js'
import type { JsonStorageService } from '../../storage/json-storage-service.js'
import { CollectionCancelledError, runBoundedOperation } from './collection-execution.js'
import { normalizeTmallDaily, TMALL_NORMALIZER_VERSION } from './tmall-daily-normalizer.js'
import { validateTmallPage, validateTmallSnapshot, type TmallSourceValidation } from './tmall-source-validation.js'
import { isBusinessDate } from '@ecommerce/shared'
import { assertSafeId } from '../../security/input-validation.js'
import { filterHistorySnapshot, TmallHistoryStore } from './tmall-history-store.js'

const DAILY_WARNING = '已采集生意参谋所选日期的经营、成功退款汇总与 Top 数据；订单/退款明细、广告计划明细和结算数据尚未接入，数据质量标记为部分完整。'
const TOTAL_COLLECTION_TIMEOUT_MS = 180_000

export interface TmallProbeRunOptions {
  runId?: string
  bizDate?: string
  background?: boolean
  forceRefresh?: boolean
  historyBackfill?: boolean
  signal?: AbortSignal | undefined
  onProgress?: (progress: CollectionProgress) => void | Promise<void>
}

export interface CollectionLogger {
  info(fields: Record<string, unknown>, message: string): void
  warn(fields: Record<string, unknown>, message: string): void
  error(fields: Record<string, unknown>, message: string): void
}

interface StoredRawEnvelope {
  account_id: string
  shop_id: string
  data_type: string
  data_date: string
  collected_at: string
  source?: { page_url?: string; page_title?: string }
  payload: Record<string, unknown>
}

const silentLogger: CollectionLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined
}

export class TmallProbeService {
  constructor(
    private readonly browserProfiles: BrowserProfileManager,
    private readonly storage: JsonStorageService,
    private readonly logger: CollectionLogger = silentLogger
  ) {}

  async getCompletedReport(account: AccountConfig, bizDate: string): Promise<ReportDataset | null> {
    if (account.platform !== 'tmall') return null
    if (!isBusinessDate(bizDate)) throw new TypeError('bizDate must use a valid YYYY-MM-DD')
    const reportPath = ['data/report-datasets', 'tmall', account.shop_id, `${bizDate}.json`].join('/')
    return await this.readCompletedReport(reportPath, account, bizDate)
  }

  async run(account: AccountConfig, options: TmallProbeRunOptions = {}): Promise<CollectionProbeResult> {
    if (account.platform !== 'tmall') throw new Error('天猫数据更新只能用于天猫账号')
    const bizDate = options.bizDate ?? shanghaiYesterday()
    if (!isBusinessDate(bizDate)) throw new TypeError('bizDate must use a valid YYYY-MM-DD')
    const today = shanghaiToday()
    if (bizDate > today) throw new RangeError(`不能采集未来日期 ${bizDate}`)
    const refreshableToday = bizDate === today
    const runId = options.runId ?? `run_${randomUUID().replaceAll('-', '')}`
    assertSafeId(runId, 'runId')
    let acceptingPages = true
    const checkActive = (): void => { if (!acceptingPages || options.signal?.aborted) throw new CollectionCancelledError('collection') }
    const startedAt = Date.now()
    const progressHistory: CollectionProgress[] = []
    const manifestPath = ['data/runs', 'tmall', account.shop_id, account.account_id, bizDate, `${runId}.json`].join('/')
    const emitProgress = async (
      stage: CollectionProgressStage,
      message: string,
      pageIndex: number | null = null,
      pageKey: string | null = null
    ): Promise<void> => {
      const progress: CollectionProgress = {
        runId,
        accountId: account.account_id,
        bizDate,
        stage,
        pageIndex,
        pageCount: 5,
        pageKey,
        message,
        elapsedMs: Date.now() - startedAt,
        updatedAt: new Date().toISOString()
      }
      progressHistory.push(progress)
      const terminalStatus = stage === 'completed' ? 'completed' : stage === 'failed' ? 'failed' : stage === 'cancelled' ? 'cancelled' : 'running'
      await this.storage.writeJson(manifestPath, {
        schema_version: '1.0.0', record_type: 'collection_run', run_id: runId, platform: 'tmall', shop_id: account.shop_id,
        account_id: account.account_id, biz_date: bizDate, timezone: 'Asia/Shanghai', status: terminalStatus,
        started_at: progressHistory[0]?.updatedAt ?? progress.updatedAt, updated_at: progress.updatedAt, progress: progressHistory
      })
      this.logger.info({ event: 'collection_progress', ...progress }, message)
      await options.onProgress?.(progress)
    }

    await emitProgress('precheck', `校验目标日期 ${bizDate} 的完成标记`)
    const reportPath = ['data/report-datasets', 'tmall', account.shop_id, `${bizDate}.json`].join('/')
    const existing = refreshableToday || options.forceRefresh ? null : await this.readCompletedReport(reportPath, account, bizDate)
    if (existing?.meta.data_finality === 'final') {
      await emitProgress('completed', `目标日期 ${bizDate} 已完整采集，本次未重复执行`)
      return alreadyCollected(account, bizDate, reportPath, existing, runId)
    }

    const [year = '', month = '', day = ''] = bizDate.split('-')
    const rawPaths: string[] = []
    const persistedPageKeys = new Set<TmallCapturedPage['key']>()
    const persistRawPage = async (page: TmallCapturedPage, index: number, capturedAt: string): Promise<void> => {
      checkActive()
      if (persistedPageKeys.has(page.key)) return
      await emitProgress('persisting_raw', `正在保存第 ${index + 1}/5 个页面的 Raw 数据：${pageLabel(page.key)}`, index + 1, page.key)
      const path = ['data/raw', 'tmall', account.shop_id, account.account_id, page.key, year, month, day, `${runId}.json`].join('/')
      const partialSnapshot: TmallDailySnapshot = { bizDate, capturedAt, pages: [page] }
      const persisted = await this.storage.writeJson(path, rawEnvelope(account, partialSnapshot, page, runId))
      rawPaths.push(persisted.relativePath)
      persistedPageKeys.add(page.key)
    }
    try {
      let snapshot = await runBoundedOperation(
        () => (options.background ? this.browserProfiles.collectTmallDailyBackground(account, bizDate, {
          signal: options.signal,
          onProgress: async (phase, pageKey, index) => {
            if (phase === 'navigating') await emitProgress('navigating', `正在打开第 ${index + 1}/5 个页面：${pageLabel(pageKey)}`, index + 1, pageKey)
            if (phase === 'capturing') await emitProgress('capturing', `正在抓取第 ${index + 1}/5 个页面：${pageLabel(pageKey)}`, index + 1, pageKey)
          },
          onPageCaptured: async (page, index, _total, capturedAt) => {
            await persistRawPage(page, index, capturedAt)
          }
        }) : this.browserProfiles.collectTmallDaily(account, bizDate, {
          signal: options.signal,
          onProgress: async (phase, pageKey, index) => {
            if (phase === 'navigating') await emitProgress('navigating', `正在打开第 ${index + 1}/5 个页面：${pageLabel(pageKey)}`, index + 1, pageKey)
            if (phase === 'capturing') await emitProgress('capturing', `正在抓取第 ${index + 1}/5 个页面：${pageLabel(pageKey)}`, index + 1, pageKey)
          },
          onPageCaptured: async (page, index, _total, capturedAt) => {
            await persistRawPage(page, index, capturedAt)
          }
        })),
        {
          phase: 'collection', timeoutMs: TOTAL_COLLECTION_TIMEOUT_MS, signal: options.signal,
          onStop: () => { acceptingPages = false; this.browserProfiles.cancelDailyCollection(account.account_id) }
        }
      )
      if (!snapshot) {
        await emitProgress('failed', '页面跳转后登录状态失效，需要重新登录')
        return needLogin(account, runId, bizDate)
      }
      for (const [index, page] of snapshot.pages.entries()) await persistRawPage(page, index, snapshot.capturedAt)
      checkActive()
      if (snapshot.bizDate !== bizDate) throw new Error('采集结果业务日期与目标日期不一致')
      if (options.historyBackfill) snapshot = filterHistorySnapshot(snapshot)

      await emitProgress('normalizing', '正在校验并标准化已抓取的数据')
      const sourceValidation = validateTmallSnapshot(snapshot, options.historyBackfill === true)
      if (sourceValidation.loginRequired) {
        const warning = sourceValidation.warnings.join('；')
        await emitProgress('failed', warning)
        this.logger.warn({ event: 'collection_source_rejected', runId, accountId: account.account_id, bizDate, reason: 'login_required' }, warning)
        return needLogin(account, runId, bizDate, warning)
      }
      if (sourceValidation.status === 'failed') throw new Error(sourceValidation.warnings.join('；'))
      const normalized = normalizeTmallDaily(snapshot, account)
      attachSourceValidation(normalized.report, sourceValidation)
      await emitProgress('persisting_report', '正在原子写入聚合数据和最终报表')
      checkActive()
      await new TmallHistoryStore(this.storage).commit(account, normalized, rawPaths, runId, options.signal, options.historyBackfill === true)
      const normalizedPaths = normalized.report.source_paths.filter(path => path.includes('/normalized/'))
      const itemCount = normalized.datasets.find((dataset) => dataset.dataset === 'item_daily')?.rows.length ?? 0
      await emitProgress('completed', `目标日期 ${bizDate} 的数据更新完成`)

      return {
        runId,
        accountId: account.account_id,
        status: 'SUCCESS',
        pageUrl: snapshot.pages.at(-1)?.sourceUrl ?? '',
        pageTitle: '天猫经营数据',
        tableCount: normalized.datasets.length,
        rowCount: itemCount,
        relativePath: reportPath,
        warning: DAILY_WARNING,
        bizDate,
        datasetCount: normalized.datasets.length,
        dashboardRelativePath: reportPath,
        normalizedPaths,
        qualityStatus: 'partial'
      }
    } catch (error) {
      acceptingPages = false
      const cancelled = error instanceof CollectionCancelledError
      await emitProgress(cancelled ? 'cancelled' : 'failed', cancelled ? '用户已取消采集任务' : collectionErrorMessage(error)).catch(() => undefined)
      const fields = { event: 'collection_terminal', runId, accountId: account.account_id, bizDate, elapsedMs: Date.now() - startedAt, err: error }
      if (cancelled) this.logger.warn(fields, 'collection cancelled')
      else this.logger.error(fields, 'collection failed')
      throw error
    }
  }

  private async readCompletedReport(relativePath: string, account: AccountConfig, bizDate: string): Promise<ReportDataset | null> {
    try {
      const report = await this.storage.readJson<ReportDataset>(relativePath)
      if (!isCompletedReport(report, account, bizDate)) return null
      const snapshot = await this.readStoredRawSnapshot(report, account, bizDate)
      if (!snapshot) return null
      const sourceValidation = validateTmallSnapshot(snapshot)
      if (sourceValidation.status === 'failed') {
        this.logger.warn({
          event: 'cached_report_rejected', accountId: account.account_id, shopId: account.shop_id, bizDate,
          reason: sourceValidation.loginRequired ? 'login_required' : 'source_validation_failed'
        }, sourceValidation.warnings.join('；'))
        return null
      }
      const normalizedPathCount = report.source_paths.filter((path) => path.includes('/normalized/')).length
      if (report.meta.normalizer_version === TMALL_NORMALIZER_VERSION && report.quality.dataset_count >= 7 && normalizedPathCount >= 7) return report
      return await this.rebuildLegacyReport(relativePath, report, account, bizDate, snapshot, sourceValidation)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return null
      throw error
    }
  }

  private async rebuildLegacyReport(relativePath: string, legacyReport: ReportDataset, account: AccountConfig, bizDate: string, existingSnapshot?: TmallDailySnapshot, existingValidation?: TmallSourceValidation): Promise<ReportDataset> {
    const snapshot = existingSnapshot ?? await this.readStoredRawSnapshot(legacyReport, account, bizDate)
    if (!snapshot) throw new Error(`无法从 Raw 重建 ${bizDate} 报表：需要 5 个有效页面`)
    const sourceValidation = existingValidation ?? validateTmallSnapshot(snapshot)
    if (sourceValidation.status === 'failed') throw new Error(sourceValidation.warnings.join('；'))
    const rawPaths = legacyReport.source_paths.filter((path) => path.includes('/raw/'))
    const normalized = normalizeTmallDaily(snapshot, account)
    attachSourceValidation(normalized.report, sourceValidation)
    await new TmallHistoryStore(this.storage).commit(account, normalized, rawPaths, `run_${randomUUID().replaceAll('-', '')}`)
    this.logger.info({
      event: 'report_repaired', accountId: account.account_id, shopId: account.shop_id, bizDate,
      fromNormalizerVersion: legacyReport.meta.normalizer_version ?? 'legacy', toNormalizerVersion: TMALL_NORMALIZER_VERSION,
      oldPayAmt: legacyReport.summary['pay_amt'], newPayAmt: normalized.report.summary['pay_amt']
    }, 'legacy Tmall report rebuilt from existing Raw files')
    return normalized.report
  }

  private async readStoredRawSnapshot(report: ReportDataset, account: AccountConfig, bizDate: string): Promise<TmallDailySnapshot | null> {
    const rawPaths = report.source_paths.filter((path) => path.includes('/raw/'))
    const pages: TmallCapturedPage[] = []
    let capturedAt = ''
    for (const rawPath of rawPaths) {
      const raw = await this.storage.readJson<StoredRawEnvelope>(rawPath)
      const pageKey = pageKeyFromDataType(raw.data_type)
      if (!pageKey || !rawPath.startsWith(`data/raw/tmall/${account.shop_id}/`) || raw.shop_id !== account.shop_id || raw.data_date !== bizDate || !isRecord(raw.payload)) continue
      pages.push({
        key: pageKey,
        sourcePage: raw.source?.page_title ?? pageLabel(pageKey),
        sourceUrl: raw.source?.page_url ?? '',
        endpoints: raw.payload
      })
      if (raw.collected_at > capturedAt) capturedAt = raw.collected_at
    }
    const uniquePages = new Map(pages.map((page) => [page.key, page]))
    if (uniquePages.size !== 5) return null
    return { bizDate, capturedAt: capturedAt || report.generated_at, pages: [...uniquePages.values()] }
  }
}

function rawEnvelope(account: AccountConfig, snapshot: TmallDailySnapshot, page: TmallCapturedPage, runId: string): Record<string, unknown> {
  const sourceValidation = validateTmallPage(page)
  const validationWarnings = [...sourceValidation.warnings, DAILY_WARNING, 'Raw 网络响应已移除凭据、Cookie、Token、授权头及跟踪标识。']
  return {
    schema_version: '1.0.0', record_type: 'raw_collection', run_id: runId, platform: 'tmall', shop_id: account.shop_id,
    account_id: account.account_id, data_type: `${page.key}_daily`, data_date: snapshot.bizDate, timezone: 'Asia/Shanghai',
    collection_method: 'network_json', adapter_version: '0.3.0', source: { page_url: sanitizeUrl(page.sourceUrl), page_title: page.sourcePage },
    collected_at: snapshot.capturedAt, payload: sanitizeRaw(page.endpoints),
    validation: { status: sourceValidation.status === 'failed' ? 'failed' : validationWarnings.length > 0 ? 'passed_with_warning' : 'passed', warnings: validationWarnings },
    integrity: { sha256: null, previous_run_id: null }
  }
}

function sanitizeRaw(value: unknown, key = ''): unknown {
  if (/password|passwd|cookie|token|authorization|credential|session|trace.?id/i.test(key)) return '[REDACTED]'
  if (Array.isArray(value)) return value.map((entry) => sanitizeRaw(entry))
  if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, sanitizeRaw(entryValue, entryKey)]))
  if (typeof value === 'string' && /^https?:\/\//i.test(value)) return sanitizeUrl(value)
  return value
}

export function shanghaiYesterday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now.getTime() - 86_400_000))
}

export function shanghaiToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

function isCompletedReport(report: ReportDataset, account: AccountConfig, bizDate: string): boolean {
  return report.meta?.data_status === 'real'
    && (report.meta.collection_status === 'completed' || !('collection_status' in report.meta))
    && report.meta.biz_date === bizDate
    && report.filters?.dateStart === bizDate
    && report.filters.dateEnd === bizDate
    && report.filters.platforms.includes('tmall')
    && report.filters.shopIds.includes(account.shop_id)
    && report.quality?.dataset_count >= 6
    && Array.isArray(report.source_paths)
    && report.source_paths.filter((path) => path.includes('/raw/')).length >= 5
    && report.source_paths.filter((path) => path.includes('/normalized/')).length >= 6
}

function alreadyCollected(account: AccountConfig, bizDate: string, reportPath: string, report: ReportDataset, runId: string): CollectionProbeResult {
  const coverage = report.quality.status === 'complete' ? '完整' : '部分完整'
  return {
    runId, accountId: account.account_id, status: 'ALREADY_COLLECTED', pageUrl: '', pageTitle: '天猫经营数据',
    tableCount: report.quality.dataset_count, rowCount: report.shop_rows.length, relativePath: reportPath,
    warning: `数据更新任务已经完成：目标日期 ${bizDate}（Asia/Shanghai），数据覆盖状态为“${coverage}”。本次未重复执行。`,
    bizDate, datasetCount: report.quality.dataset_count, dashboardRelativePath: reportPath, normalizedPaths: report.source_paths.filter((path) => path.includes('/normalized/')),
    qualityStatus: report.quality.status === 'complete' ? 'complete' : 'partial'
  }
}

function sanitizeUrl(value: string): string {
  try { const url = new URL(value); return `${url.origin}${url.pathname}` } catch { return value.split(/[?#]/u, 1)[0] ?? '' }
}

function needLogin(account: AccountConfig, runId: string, bizDate: string, warning = '未检测到已登录的天猫工作台，请先打开独立环境并完成人工登录。'): CollectionProbeResult {
  return {
    runId, accountId: account.account_id, status: 'NEED_HUMAN_LOGIN', pageUrl: '', pageTitle: '', tableCount: 0, rowCount: 0,
    relativePath: null, warning, bizDate,
    datasetCount: 0, dashboardRelativePath: null, normalizedPaths: [], qualityStatus: 'partial'
  }
}

function attachSourceValidation(report: ReportDataset, validation: TmallSourceValidation): void {
  if (validation.status === 'failed') throw new Error('不能把来源校验失败的数据标记为正式报表')
  report.meta.source_validation = {
    status: validation.status,
    validated_at: new Date().toISOString(),
    critical_endpoint_count: validation.criticalEndpointCount,
    warning_count: validation.warningCount
  }
  if (validation.warnings.length > 0) {
    report.quality.warnings = [...new Set([...validation.warnings, ...report.quality.warnings])]
    report.quality.warning_count = report.quality.warnings.length
  }
}

function pageLabel(pageKey: TmallCapturedPage['key']): string {
  return ({ store: '首页概览', trade: '交易数据', flow: '流量数据', item: '商品排行', service: '服务数据' })[pageKey]
}

function pageKeyFromDataType(dataType: string): TmallCapturedPage['key'] | null {
  const pageKey = dataType.replace(/_daily$/u, '')
  return pageKey === 'store' || pageKey === 'trade' || pageKey === 'flow' || pageKey === 'item' || pageKey === 'service' ? pageKey : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function collectionErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
