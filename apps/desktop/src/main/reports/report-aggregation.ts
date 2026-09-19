import type { ReportDataset, ReportQuery } from '@ecommerce/shared'

export const SUM_KEYS = [
  'pay_amt', 'pay_order_count', 'pay_buyer_count', 'pay_item_count', 'visitor_count', 'page_view_count',
  'ad_spend', 'ad_pay_amt', 'refund_amt'
] as const

const METRIC_LABELS: Record<(typeof SUM_KEYS)[number], string> = {
  pay_amt: '支付金额', pay_order_count: '支付子订单数', pay_buyer_count: '支付买家数', pay_item_count: '支付件数',
  visitor_count: '访客数', page_view_count: '浏览量', ad_spend: '广告消耗', ad_pay_amt: '广告归因成交', refund_amt: '成功退款金额'
}

export interface ReportShopTarget {
  shopId: string
  shopName: string
  platform: string
}

export function summarizeReports(reports: ReportDataset[], expectedShopCount: number, usePlatformRate = true): ReportDataset['summary'] {
  const single = usePlatformRate && reports.length === 1 && expectedShopCount === 1 ? reports[0] : undefined
  const summary = aggregateFacts(reports.map((report) => report.summary), SUM_KEYS, expectedShopCount)
  for (const key of ['pay_amt_lower_bound', 'refund_amt_lower_bound']) {
    summary[key] = sumKnown(reports.map((report) => report.summary[key]))
  }
  summary['pay_rate'] = single && nullableNumeric(single.summary['visitor_count']) !== 0
    ? nullableNumeric(single.summary['pay_rate']) ?? coveredRatio(summary, 'pay_buyer_count', 'visitor_count')
    : coveredRatio(summary, 'pay_buyer_count', 'visitor_count')
  summary['customer_unit_price'] = coveredRatio(summary, 'pay_amt', 'pay_buyer_count')
  summary['refund_rate'] = null
  summary['platform_refund_rate'] = single ? nullableNumeric(single.summary['platform_refund_rate']) : null
  summary['daily_refund_pay_ratio'] = coveredRatio(summary, 'refund_amt', 'pay_amt')
  summary['ad_roi'] = coveredRatio(summary, 'pay_amt', 'ad_spend')
  summary['platform_ad_roi'] = single ? nullableNumeric(single.summary['platform_ad_roi']) : coveredRatio(summary, 'ad_pay_amt', 'ad_spend')
  return summary
}

export function aggregateReports(query: ReportQuery, expectedShopCount: number, reports: ReportDataset[], expectedShops: ReportShopTarget[] = []): ReportDataset | null {
  if (reports.length === 0) return null
  const single = reports.length === 1 && expectedShopCount === 1 ? reports[0] : undefined
  const generatedAt = new Date().toISOString()
  const summary = summarizeReports(reports, expectedShopCount)
  const trends = new Map<string, Array<Record<string, string | number | null>>>()
  for (const report of reports) {
    for (const row of report.trend) {
      const date = String(row['date'] ?? report.meta.biz_date)
      const current = trends.get(date) ?? []
      current.push(row)
      trends.set(date, current)
    }
  }
  const missingShopCount = Math.max(0, expectedShopCount - reports.length)
  const warnings = [...new Set(reports.flatMap(({ quality }) => quality.warnings))]
  for (const key of SUM_KEYS) {
    const covered = numeric(summary[`${key}_reported_shop_count`])
    if (covered < expectedShopCount) warnings.push(`${METRIC_LABELS[key]}覆盖 ${covered}/${expectedShopCount} 家店铺；仅汇总已知值，相关全范围比率按缺失处理。`)
  }
  if (nullableNumeric(summary['pay_amt_lower_bound']) !== null || nullableNumeric(summary['refund_amt_lower_bound']) !== null) warnings.push('Top 商品下限仅用于提示缺失店铺的已知金额，不计入全店总额或比率。')
  if (missingShopCount > 0) warnings.unshift(`${missingShopCount} 家有效店铺尚无所选日期的报表数据。`)
  const attachShop = (rows: Array<Record<string, string | number | null>>, report: ReportDataset): Array<Record<string, string | number | null>> => rows.map((row) => ({ shop_name: report.meta.shop_name, shop_id: report.filters.shopIds[0] ?? null, ...row }))
  const sections = {
    channels: reports.flatMap((report) => attachShop(report.sections.channels, report)),
    keywords: reports.flatMap((report) => attachShop(report.sections.keywords, report)),
    campaigns: reports.flatMap((report) => attachShop(report.sections.campaigns, report)),
    alerts: reports.flatMap((report) => attachShop(report.sections.alerts, report)),
    service: reports.flatMap((report) => attachShop(report.sections.service, report)),
    shop_overview: buildShopOverview(reports, expectedShops)
  }
  const completeShopCount = reports.filter(({ quality }) => quality.status === 'complete').length
  const allComplete = missingShopCount === 0 && completeShopCount === reports.length && SUM_KEYS.every((key) => summary[`${key}_missing_shop_count`] === 0)
  return {
    schema_version: '1.0.0',
    report_type: query.reportType,
    dataset_id: single?.dataset_id ?? `tmall_multi_${query.dateEnd.replaceAll('-', '')}`,
    filters: query,
    meta: {
      ...single?.meta,
      shop_name: single?.meta.shop_name ?? `${reports.length} 家店铺汇总`, date_range: query.dateStart === query.dateEnd ? query.dateEnd : `${query.dateStart}—${query.dateEnd}`,
      updated_at: reports.map(({ meta }) => meta.updated_at).sort().at(-1) ?? generatedAt, biz_date: query.dateEnd,
      data_status: 'real', collection_status: 'completed', normalizer_version: reports.every(({ meta }) => meta.normalizer_version === reports[0]?.meta.normalizer_version) ? reports[0]?.meta.normalizer_version ?? 'unknown' : 'mixed'
    },
    summary,
    trend: [...trends.entries()].map(([date, rows]) => ({ date, ...aggregateFacts(rows, ['pay_amt', 'refund_amt', 'visitor_count', 'pay_order_count', 'ad_spend'], expectedShopCount) })).sort((left, right) => left.date.localeCompare(right.date)),
    shop_rows: reports.flatMap((report) => attachShop(report.shop_rows, report)),
    sections,
    quality: {
      complete_shop_count: completeShopCount, missing_shop_count: missingShopCount, warning_count: warnings.length,
      status: allComplete ? 'complete' : 'partial', dataset_count: reports.reduce((sum, report) => sum + report.quality.dataset_count, 0), warnings
    },
    source_paths: [...new Set(reports.flatMap(({ source_paths }) => source_paths))],
    generated_at: generatedAt
  }
}

function numeric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function nullableNumeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function sumKnown(values: unknown[]): number | null {
  const known = values.map(nullableNumeric).filter((value): value is number => value !== null)
  return known.length > 0 ? known.reduce((sum, value) => sum + value, 0) : null
}

function aggregateFacts(rows: Array<Record<string, string | number | null>>, keys: readonly string[], expectedShopCount: number): Record<string, string | number | null> {
  const result: Record<string, string | number | null> = {}
  for (const key of keys) {
    const values = rows.map((row) => row[key])
    const count = values.filter((value) => nullableNumeric(value) !== null).length
    result[key] = sumKnown(values)
    result[`${key}_reported_shop_count`] = count
    result[`${key}_missing_shop_count`] = Math.max(0, expectedShopCount - count)
  }
  // 保留旧版退款覆盖字段，兼容现有消费方。
  result['refund_reported_shop_count'] = result['refund_amt_reported_shop_count'] ?? 0
  result['refund_missing_shop_count'] = result['refund_amt_missing_shop_count'] ?? expectedShopCount
  return result
}

function coveredRatio(summary: Record<string, string | number | null>, numeratorKey: string, denominatorKey: string): number | null {
  if (summary[`${numeratorKey}_missing_shop_count`] !== 0 || summary[`${denominatorKey}_missing_shop_count`] !== 0) return null
  const numerator = nullableNumeric(summary[numeratorKey])
  const denominator = nullableNumeric(summary[denominatorKey])
  return numerator !== null && denominator !== null && denominator > 0 ? numerator / denominator : null
}

function buildShopOverview(reports: ReportDataset[], expectedShops: ReportShopTarget[]): Array<Record<string, string | number | null>> {
  const reportByShopId = new Map(reports.flatMap((report) => {
    const shopId = report.filters.shopIds[0]
    return shopId ? [[shopId, report] as const] : []
  }))
  const targets = expectedShops.length > 0 ? expectedShops : reports.map((report) => ({
    shopId: report.filters.shopIds[0] ?? report.dataset_id,
    shopName: report.meta.shop_name,
    platform: report.filters.platforms[0] ?? 'unknown'
  }))
  return targets.map((target) => {
    const report = reportByShopId.get(target.shopId)
    return {
      shop_id: target.shopId,
      shop_name: target.shopName,
      platform: target.platform,
      biz_date: report?.meta.biz_date ?? null,
      pay_amt: report ? nullableNumeric(report.summary['pay_amt']) : null,
      pay_amt_lower_bound: report ? nullableNumeric(report.summary['pay_amt_lower_bound']) : null,
      visitor_count: report ? nullableNumeric(report.summary['visitor_count']) : null,
      pay_buyer_count: report ? nullableNumeric(report.summary['pay_buyer_count']) : null,
      pay_rate: report ? nullableNumeric(report.summary['pay_rate']) : null,
      refund_amt: report ? nullableNumeric(report.summary['refund_amt']) : null,
      refund_amt_lower_bound: report ? nullableNumeric(report.summary['refund_amt_lower_bound']) : null,
      ad_spend: report ? nullableNumeric(report.summary['ad_spend']) : null,
      data_status: report?.quality.status ?? 'empty',
      warning_count: report?.quality.warning_count ?? 0,
      data_finality: report?.meta.data_finality ?? null,
      updated_at: report?.meta.updated_at ?? null
    }
  })
}
