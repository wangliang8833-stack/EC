import type { ReportDataset } from '@ecommerce/shared'

type Row = Record<string, string | number | null>
export type DashboardDetail = 'channels' | 'products' | 'keywords' | 'service'

export function dashboardColumns(detail: DashboardDetail, multipleShops: boolean, multipleDays = false): Array<[string, string]> {
  const identity: Array<[string, string]> = [...(multipleShops ? [['shop_name', '店铺']] as Array<[string, string]> : []), ...(multipleDays ? [['biz_date', '日期']] as Array<[string, string]> : [])]
  if (detail === 'service') return [...identity, ['service_account', '客服账号'], ['service_source', '来源'], ['name', '指标'], ['value', '所选日期值'], ['unit', '单位']]
  const key = detail === 'channels' ? 'source_name' : detail === 'products' ? 'item_title' : 'keyword'
  const label = detail === 'channels' ? '来源' : detail === 'products' ? '商品' : '关键词'
  return [...identity, [key, label], ['visitor_count', '访客'], ['page_view_count', '浏览'], ['pay_amt', '支付金额']]
}

export function dashboardMoney(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—'
}

export function dashboardPercent(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${(value * 100).toFixed(2)}%` : '—'
}

export function dashboardInteger(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value).toLocaleString('zh-CN') : '—'
}

export function metricCoverage(summary: Row, key: string): string {
  const dayMissing = summary[`${key}_missing_shop_day_count`]
  const dayReported = summary[`${key}_reported_shop_day_count`]
  if (typeof dayMissing === 'number' && dayMissing > 0 && typeof dayReported === 'number') return ` · 覆盖 ${dayReported}/${dayReported + dayMissing} 店铺日`
  const missing = summary[`${key}_missing_shop_count`]
  const reported = summary[`${key}_reported_shop_count`]
  return typeof missing === 'number' && missing > 0 && typeof reported === 'number' ? ` · 覆盖 ${reported}/${reported + missing} 家` : ''
}

export function lowerBoundNote(summary: Row, key: 'pay_amt' | 'refund_amt'): string {
  const value = summary[`${key}_lower_bound`]
  return typeof value === 'number' ? ` · 未覆盖店铺 Top 下限 ${dashboardMoney(value)}` : ''
}

export function startDashboardQuery(fetchReport: () => Promise<ReportDataset>, callbacks: {
  onData: (report: ReportDataset) => void
  onError: (error: unknown) => void
  onSettled: () => void
}): () => void {
  let cancelled = false
  void fetchReport()
    .then((report) => { if (!cancelled) callbacks.onData(report) })
    .catch((error: unknown) => { if (!cancelled) callbacks.onError(error) })
    .finally(() => { if (!cancelled) callbacks.onSettled() })
  return () => { cancelled = true }
}
