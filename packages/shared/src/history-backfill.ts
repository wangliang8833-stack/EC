export interface HistoryBackfillRequest {
  platforms: string[]
  shopIds: string[]
  dateStart: string
  dateEnd: string
  mode: 'missing_only' | 'refresh_selected'
  concurrency: number
}

export interface HistoryCoverage {
  key: string
  label: string
  status: 'available' | 'partial' | 'missing' | 'unsupported' | 'permission_denied'
  reason: string
  retryable: boolean
}

export interface HistoryDayInspection {
  committedRunId?: string
  state: 'ready' | 'rebuildable' | 'missing' | 'retryable_partial' | 'invalid'
  coverage: HistoryCoverage[]
  reason: string
}

export type HistoryItemStatus = 'queued' | 'running' | 'succeeded' | 'skipped' | 'need_login' | 'failed' | 'cancelled'
export interface HistoryBackfillItem extends HistoryDayInspection {
  key: string
  shopId: string
  shopName: string
  accountId: string
  bizDate: string
  status: HistoryItemStatus
  action: 'collect' | 'rebuild' | 'skip'
  attempts: number
  runId: string | null
  runIds: string[]
  nextRetryAt: string | null
  errorCode: string | null
  message: string
  updatedAt: string
}

export interface HistoryBackfillPreview {
  request: HistoryBackfillRequest
  items: HistoryBackfillItem[]
  total: number
  collect: number
  rebuild: number
  skip: number
}

export type HistoryBackfillStatus = 'queued' | 'running' | 'pausing' | 'paused' | 'needs_attention' | 'completed' | 'completed_with_gaps' | 'cancelled'
export interface HistoryBackfillJob extends HistoryBackfillPreview {
  schemaVersion: '1.0.0'
  jobId: string
  anchorDate: string
  timezone: 'Asia/Shanghai'
  status: HistoryBackfillStatus
  createdAt: string
  updatedAt: string
  lastError: string | null
}

export function shanghaiBusinessDate(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const fields = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${fields['year']}-${fields['month']}-${fields['day']}`
}

export function isBusinessDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function shiftBusinessDate(date: string, days: number): string {
  if (!isBusinessDate(date) || !Number.isSafeInteger(days)) throw new TypeError('业务日期或偏移无效')
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10)
}

export function historyDates(start: string, end: string): string[] {
  if (!isBusinessDate(start) || !isBusinessDate(end) || start > end) throw new TypeError('历史日期区间无效')
  const count = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 + 1
  if (count > 30) throw new RangeError('历史补采最多选择 30 天')
  return Array.from({ length: count }, (_, index) => shiftBusinessDate(start, index))
}

export function assertHistoryBackfillRequest(value: unknown, today = shanghaiBusinessDate()): asserts value is HistoryBackfillRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('历史补采参数无效')
  const input = value as Record<string, unknown>
  const keys = ['platforms', 'shopIds', 'dateStart', 'dateEnd', 'mode', 'concurrency']
  if (Object.keys(input).length !== keys.length || Object.keys(input).some(key => !keys.includes(key))) throw new TypeError('历史补采包含无效字段')
  if (!Array.isArray(input['platforms']) || input['platforms'].length !== 1 || input['platforms'][0] !== 'tmall') throw new TypeError('历史补采目前仅支持天猫')
  const ids = input['shopIds']
  if (!Array.isArray(ids) || !ids.length || ids.length > 200 || ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{3,128}$/.test(id)) || new Set(ids).size !== ids.length) throw new TypeError('请选择 1—200 家不重复的有效店铺')
  if (!isBusinessDate(input['dateStart']) || !isBusinessDate(input['dateEnd'])) throw new TypeError('日期必须为真实的 YYYY-MM-DD 自然日')
  historyDates(input['dateStart'], input['dateEnd'])
  if (input['dateStart'] < shiftBusinessDate(today, -30) || input['dateEnd'] >= today) throw new RangeError('请选择最近 30 个已结束的自然日（不含今天）')
  if (input['mode'] !== 'missing_only' && input['mode'] !== 'refresh_selected') throw new TypeError('补采模式无效')
  if (!Number.isInteger(input['concurrency']) || Number(input['concurrency']) < 1 || Number(input['concurrency']) > 3) throw new RangeError('历史补采并发店铺数必须为 1—3')
}
