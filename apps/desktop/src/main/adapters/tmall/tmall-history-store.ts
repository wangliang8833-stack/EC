import { randomUUID } from 'node:crypto'
import type { AccountConfig, HistoryCoverage, HistoryDayInspection, ReportDataset } from '@ecommerce/shared'
import type { TmallCapturedPage, TmallDailySnapshot } from '../../browser/browser-profile-manager.js'
import type { JsonStorageService } from '../../storage/json-storage-service.js'
import { CollectionCancelledError } from './collection-execution.js'
import { normalizeTmallDaily, TMALL_NORMALIZER_VERSION, type TmallNormalizedResult } from './tmall-daily-normalizer.js'
import { endpointMatchesDate, validateTmallSnapshot } from './tmall-source-validation.js'

const PAGE_KEYS = ['store', 'trade', 'flow', 'item', 'service'] as const
const METRICS = [
  ['pay_amt', '支付金额'], ['visitor_count', '访客数'], ['page_view_count', '浏览量'],
  ['pay_order_count', '支付订单数'], ['pay_buyer_count', '支付买家数'], ['refund_amt', '全店成功退款'], ['ad_spend', '广告消耗']
] as const
const MODULES = [
  ['item', '/cc/item/view/top.json', 'item_daily', '商品 Top'],
  ['flow', '/flow/v3/overview/shopFlowSourceTop/v4.json', 'traffic_source_daily', '流量来源 Top'],
  ['flow', '/flow/new/overview/keywordTop.json', 'search_keyword_daily', '搜索词 Top'],
  ['service', '/csp/api/core/monitor/overview/list', 'service_overview', '客服概览'],
  ['service', '/csp/api/core/monitor/list', 'service_daily', '客服日明细']
] as const

export interface HistoryCandidate {
  snapshot: TmallDailySnapshot
  rawPaths: string[]
  normalized: TmallNormalizedResult
  report: ReportDataset | null
}

export class HistorySourceError extends Error {
  readonly code = 'HISTORY_SOURCE_INVALID'
  constructor(message: string, readonly retryable = false) { super(message) }
}

export class TmallHistoryStore {
  constructor(private readonly storage: JsonStorageService) {}

  async inspect(account: AccountConfig, bizDate: string): Promise<HistoryDayInspection> {
    const candidate = await this.candidate(account, bizDate)
    if (!candidate) return { state: 'missing', coverage: [], reason: '无可验证的该日数据，需要采集' }
    const coverage = historyCoverage(candidate.normalized.report, candidate.snapshot)
    if (!coreAvailable(candidate.normalized.report)) return { state: 'invalid', coverage, reason: '目标日期缺少支付金额或访客数据' }
    if (candidate.normalized.report.meta.data_finality !== 'final') return { state: 'invalid', coverage, reason: '已有数据为当天实时快照，需要补采完整自然日' }
    const report = candidate.report
    if (!report || report.meta.normalizer_version !== TMALL_NORMALIZER_VERSION || !await this.artifactsValid(report, account, bizDate, candidate.normalized)) {
      return { state: 'rebuildable', coverage, reason: '可信 Raw 可在本地重建日报' }
    }
    const commit = report.meta.collection_run_id ? { committedRunId: report.meta.collection_run_id } : {}
    if (coverage.some(field => field.retryable)) return { ...commit, state: 'retryable_partial', coverage, reason: '存在可重试的接口缺口' }
    return { ...commit, state: 'ready', coverage, reason: '现有可取数据有效；Top 及未支持字段仍按实际覆盖展示' }
  }

  async rebuild(account: AccountConfig, bizDate: string, signal?: AbortSignal, runId = `run_${randomUUID().replaceAll('-', '')}`): Promise<void> {
    const candidate = await this.candidate(account, bizDate)
    if (!candidate || !coreAvailable(candidate.normalized.report)) throw new HistorySourceError('本地 Raw 不足以重建目标日期')
    await this.commit(account, candidate.normalized, candidate.rawPaths, runId, signal, true)
  }

  async candidate(account: AccountConfig, bizDate: string): Promise<HistoryCandidate | null> {
    const report = await this.readReport(account, bizDate)
    if (report) {
      const snapshot = await this.loadSnapshot(report.source_paths.filter(path => path.includes('/raw/')), account, bizDate)
      if (snapshot && validateTmallSnapshot(snapshot, true).status !== 'failed') {
        return { snapshot, rawPaths: report.source_paths.filter(path => path.includes('/raw/')), normalized: normalizeTmallDaily(snapshot, account), report }
      }
    }
    // Group orphan Raw by account and run, never combine unrelated attempts.
    const root = `data/raw/tmall/${account.shop_id}`
    const candidates: Array<{ paths: string[]; snapshot: TmallDailySnapshot }> = []
    for (const directory of await this.storage.listChildren(root, 'directory')) {
      const groups = new Map<string, string[]>()
      for (const key of PAGE_KEYS) {
        for (const path of await this.storage.listChildren(`${directory}/${key}/${bizDate.replaceAll('-', '/')}`, 'json')) {
          const run = path.split('/').at(-1)!
          const paths = groups.get(run) ?? []
          paths.push(path)
          groups.set(run, paths)
        }
      }
      for (const paths of groups.values()) {
        if (paths.length !== PAGE_KEYS.length) continue
        const snapshot = await this.loadSnapshot(paths, account, bizDate)
        if (snapshot && validateTmallSnapshot(snapshot, true).status !== 'failed') candidates.push({ paths, snapshot })
      }
    }
    candidates.sort((a, b) => b.snapshot.capturedAt.localeCompare(a.snapshot.capturedAt))
    const candidate = candidates[0]
    return candidate ? { snapshot: candidate.snapshot, rawPaths: candidate.paths, normalized: normalizeTmallDaily(candidate.snapshot, account), report: null } : null
  }

  async loadSnapshot(paths: string[], account: AccountConfig, bizDate: string): Promise<TmallDailySnapshot | null> {
    if (paths.length !== PAGE_KEYS.length || new Set(paths).size !== paths.length) return null
    const pages: TmallCapturedPage[] = []
    let capturedAt = ''
    let identity = ''
    for (const path of paths) {
      if (!path.startsWith(`data/raw/tmall/${account.shop_id}/`) || path.includes('..') || path.includes('\\')) return null
      const raw = await this.readOptional<Record<string, unknown>>(path)
      if (!raw || raw['shop_id'] !== account.shop_id || raw['data_date'] !== bizDate || typeof raw['account_id'] !== 'string' || typeof raw['run_id'] !== 'string' || !record(raw['payload']) || typeof raw['collected_at'] !== 'string' || !Number.isFinite(Date.parse(raw['collected_at']))) return null
      const key = String(raw['data_type']).replace(/_daily$/, '') as TmallCapturedPage['key']
      if (!PAGE_KEYS.includes(key)) return null
      const current = `${raw['account_id']}/${raw['run_id']}`
      if (identity && current !== identity) return null
      identity = current
      const expectedPath = `data/raw/tmall/${account.shop_id}/${raw['account_id']}/${key}/${bizDate.replaceAll('-', '/')}/${raw['run_id']}.json`
      if (path !== expectedPath) return null
      const source = record(raw['source']) ? raw['source'] : {}
      pages.push({ key, sourcePage: String(source['page_title'] ?? key), sourceUrl: String(source['page_url'] ?? ''), endpoints: raw['payload'] })
      if (raw['collected_at'] > capturedAt) capturedAt = raw['collected_at']
    }
    if (new Set(pages.map(page => page.key)).size !== PAGE_KEYS.length) return null
    return filterHistorySnapshot({ bizDate, capturedAt, pages })
  }

  async commit(account: AccountConfig, normalized: TmallNormalizedResult, rawPaths: string[], runId: string, signal?: AbortSignal, preventDowngrade = false): Promise<ReportDataset> {
    const report = normalized.report
    const date = report.meta.biz_date as string
    const check = (): void => { if (signal?.aborted) throw new CollectionCancelledError('collection') }
    check()
    if (preventDowngrade) {
      if (!coreAvailable(report)) throw new HistorySourceError('目标日期支付金额或访客数缺失，未替换已有日报')
      const previous = await this.readReport(account, date)
      if (previous) {
        const oldSnapshot = await this.loadSnapshot(previous.source_paths.filter(path => path.includes('/raw/')), account, date)
        // Re-normalize trustworthy legacy Raw so old inferred zeros do not become a permanent blocker.
        const baseline = previous.meta.normalizer_version !== TMALL_NORMALIZER_VERSION && oldSnapshot && validateTmallSnapshot(oldSnapshot, true).status !== 'failed'
          ? normalizeTmallDaily(oldSnapshot, account).report : previous
        const newSnapshot = await this.loadSnapshot(rawPaths, account, date)
        const nextCoverage = newSnapshot ? historyCoverage(report, newSnapshot) : []
        for (const [key] of METRICS) {
          if (known(baseline.summary[key]) && !known(report.summary[key])) throw new HistorySourceError(`新数据缺失已有指标 ${key}，保留原日报`, nextCoverage.some(field => field.key === key && field.retryable))
        }
        if (oldSnapshot && newSnapshot) {
          const previousCoverage = historyCoverage(baseline, oldSnapshot)
          for (const old of previousCoverage.filter(field => field.status === 'available' || field.status === 'partial')) {
            const next = nextCoverage.find(field => field.key === old.key)
            if (next && next.status !== 'available' && next.status !== 'partial') throw new HistorySourceError(`新数据缺失已有模块 ${old.label}，保留原日报`, next.retryable)
          }
        }
      }
    }
    const normalizedPaths: string[] = []
    for (const dataset of normalized.datasets) {
      check()
      const path = `data/normalized/tmall/${account.shop_id}/${account.account_id}/${date.replaceAll('-', '/')}/${runId}/${dataset.dataset}.json`
      await this.storage.writeJson(path, dataset)
      normalizedPaths.push(path)
    }
    report.source_paths = [...rawPaths, ...normalizedPaths]
    report.meta.collection_run_id = runId
    check()
    await this.storage.writeJson(`data/aggregate/tmall/${account.shop_id}/${account.account_id}/${date.replaceAll('-', '/')}/${runId}/dashboard.json`, report)
    check()
    await this.storage.writeJson(`data/report-datasets/tmall/${account.shop_id}/${date}.json`, report, undefined, check)
    return report
  }

  private async readReport(account: AccountConfig, date: string): Promise<ReportDataset | null> {
    const report = await this.readOptional<ReportDataset>(`data/report-datasets/tmall/${account.shop_id}/${date}.json`)
    if (!report || !record(report.meta) || !record(report.summary) || !record(report.quality) || report.meta.biz_date !== date || report.meta.data_status !== 'real' || report.filters?.dateStart !== date || report.filters.dateEnd !== date || !Array.isArray(report.filters.shopIds) || !report.filters.shopIds.includes(account.shop_id) || !Array.isArray(report.filters.platforms) || !report.filters.platforms.includes('tmall') || !Array.isArray(report.source_paths) || report.source_paths.some(path => typeof path !== 'string')) return null
    return report
  }

  private async artifactsValid(report: ReportDataset, account: AccountConfig, date: string, expected: TmallNormalizedResult): Promise<boolean> {
    if (report.meta.collection_status !== 'completed' || report.meta.data_finality !== 'final' || !Object.entries(expected.report.summary).every(([key, value]) => report.summary[key] === value)) return false
    const paths = report.source_paths.filter(path => path.startsWith(`data/normalized/tmall/${account.shop_id}/`))
    if (paths.length !== 7) return false
    const seen = new Set<string>()
    for (const path of paths) {
      if (path.includes('..') || path.includes('\\')) return false
      const value = await this.readOptional<Record<string, unknown>>(path)
      const dataset = expected.datasets.find(dataset => dataset.dataset === value?.['dataset'])
      if (!value || !dataset || seen.has(dataset.dataset) || value['platform'] !== 'tmall' || value['shop_id'] !== account.shop_id || value['biz_date'] !== date || JSON.stringify(value['rows']) !== JSON.stringify(dataset.rows)) return false
      seen.add(dataset.dataset)
    }
    return true
  }

  private async readOptional<T>(path: string): Promise<T | null> {
    try { return await this.storage.readJson<T>(path) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return null
      throw error
    }
  }
}

/** Strip unusable sources before normalization; warnings alone cannot stop wrong-date values entering a report. */
export function filterHistorySnapshot(snapshot: TmallDailySnapshot): TmallDailySnapshot {
  return { ...snapshot, pages: snapshot.pages.map(page => ({ ...page, endpoints: Object.fromEntries(Object.entries(page.endpoints).map(([path, endpoint]) => {
    if (record(endpoint) && endpoint['ok'] !== true) return [path, endpoint]
    if (!record(endpoint) || !endpointMatchesDate(path, endpoint, snapshot, true)) return [path, { ok: false, error: 'DATE_EVIDENCE_MISSING', status: 0 }]
    return [path, endpoint]
  })) })) }
}

export function historyCoverage(report: ReportDataset, snapshot: TmallDailySnapshot): HistoryCoverage[] {
  const fields: HistoryCoverage[] = METRICS.map(([key, label]) => ({
    key, label, status: known(report.summary[key]) ? 'available' : key === 'refund_amt' ? 'unsupported' : 'missing',
    reason: known(report.summary[key]) ? '该日有效汇总' : key === 'refund_amt' ? '当前来源未提供该日全店退款汇总；商品 Top 仅作下限' : '来源未提供该字段，不能按零处理', retryable: false
  }))
  const ad = snapshot.pages.find(page => page.key === 'store')?.endpoints['/portal/board/grow/factor/overview.json']
  const adField = fields.find(field => field.key === 'ad_spend')!
  if (adField.status !== 'available') {
    adField.retryable = transient(ad)
    if (denied(ad)) { adField.status = 'permission_denied'; adField.reason = '当前账号无广告汇总权限'; adField.retryable = false }
    else if (adField.retryable) adField.reason = '广告汇总接口暂时不可用，可重试补齐'
  }
  for (const [pageKey, path, key, label] of MODULES) {
    const endpoint = snapshot.pages.find(page => page.key === pageKey)?.endpoints[path]
    const body = record(endpoint) && record(endpoint['body']) ? endpoint['body'] : null
    const code = body?.['code']
    const permission = denied(endpoint)
    const valid = record(endpoint) && endpoint['ok'] === true && (code === undefined || code === 0 || code === 200 || code === '0' || code === '200') && containsArray(body)
    fields.push({ key, label, status: valid ? key.includes('service') ? 'available' : 'partial' : permission ? 'permission_denied' : 'missing',
      reason: valid ? key.includes('service') ? '有效日数据（允许明确空列表）' : 'Top 列表，未证明覆盖全部分页' : permission ? '当前账号无该模块权限' : '接口未返回有效列表',
      retryable: !valid && !permission && transient(endpoint) })
  }
  return fields
}

function denied(endpoint: unknown): boolean {
  if (!record(endpoint)) return false
  const body = record(endpoint['body']) ? endpoint['body'] : {}
  return endpoint['status'] === 403 || /权限|未订购|permission|forbidden/iu.test(String(body['msg'] ?? body['message'] ?? ''))
}
function transient(endpoint: unknown): boolean {
  if (!record(endpoint)) return true
  if (denied(endpoint) || endpoint['error'] === 'DATE_EVIDENCE_MISSING') return false
  const status = Number(endpoint['status'] ?? 0)
  if (endpoint['ok'] !== true) return status === 0 || status === 429 || status >= 500
  const body = record(endpoint['body']) ? endpoint['body'] : {}
  return /稍后|延迟|产出|繁忙|限流|频繁|timeout|try.*later/iu.test(String(body['msg'] ?? body['message'] ?? ''))
}

function containsArray(value: unknown, depth = 0): boolean {
  if (depth > 8) return false
  if (Array.isArray(value)) return true
  return record(value) && Object.values(value).some(child => containsArray(child, depth + 1))
}
function coreAvailable(report: ReportDataset): boolean { return known(report.summary['pay_amt']) && known(report.summary['visitor_count']) }
function known(value: unknown): boolean { return typeof value === 'number' && Number.isFinite(value) }
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
