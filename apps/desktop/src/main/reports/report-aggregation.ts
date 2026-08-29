import type { ReportDataset, ReportQuery } from '@ecommerce/shared'

const SUM_KEYS = [
  'pay_amt', 'pay_order_count', 'pay_buyer_count', 'pay_item_count', 'visitor_count', 'page_view_count',
  'ad_spend', 'ad_pay_amt'
] as const

export function aggregateReports(query: ReportQuery, expectedShopCount: number, reports: ReportDataset[]): ReportDataset | null {
  if (reports.length === 0) return null
  if (reports.length === 1 && expectedShopCount === 1) return reports[0] ?? null
  const generatedAt = new Date().toISOString()
  const summary: Record<string, string | number | null> = {}
  for (const key of SUM_KEYS) summary[key] = reports.reduce((sum, report) => sum + numeric(report.summary[key]), 0)
  summary['refund_amt'] = nullableSum(reports.map((report) => report.summary['refund_amt']))
  const payAmt = numeric(summary['pay_amt'])
  const payBuyers = numeric(summary['pay_buyer_count'])
  const visitors = numeric(summary['visitor_count'])
  const refundAmt = nullableNumeric(summary['refund_amt'])
  const adSpend = numeric(summary['ad_spend'])
  const adPayAmt = numeric(summary['ad_pay_amt'])
  summary['pay_rate'] = visitors > 0 ? payBuyers / visitors : 0
  summary['customer_unit_price'] = payBuyers > 0 ? payAmt / payBuyers : 0
  summary['refund_rate'] = payAmt > 0 && refundAmt !== null ? refundAmt / payAmt : null
  summary['ad_roi'] = adSpend > 0 ? payAmt / adSpend : null
  summary['platform_ad_roi'] = adSpend > 0 ? adPayAmt / adSpend : null

  const trends = new Map<string, Record<string, string | number | null>>()
  const datesWithMissingRefund = new Set<string>()
  for (const report of reports) {
    for (const row of report.trend) {
      const date = String(row['date'] ?? report.meta.biz_date)
      const current = trends.get(date) ?? { date, pay_amt: 0, refund_amt: null, visitor_count: 0, pay_order_count: 0, ad_spend: 0 }
      for (const key of ['pay_amt', 'visitor_count', 'pay_order_count', 'ad_spend']) current[key] = numeric(current[key]) + numeric(row[key])
      const rowRefundAmt = nullableNumeric(row['refund_amt'])
      if (rowRefundAmt !== null) current['refund_amt'] = numeric(current['refund_amt']) + rowRefundAmt
      else datesWithMissingRefund.add(date)
      trends.set(date, current)
    }
  }
  for (const date of datesWithMissingRefund) {
    const row = trends.get(date)
    if (row) row['refund_amt'] = null
  }
  const missingShopCount = Math.max(0, expectedShopCount - reports.length)
  const warnings = [...new Set(reports.flatMap(({ quality }) => quality.warnings))]
  if (missingShopCount > 0) warnings.unshift(`${missingShopCount} 家有效店铺尚无所选日期的报表数据。`)
  const attachShop = (rows: Array<Record<string, string | number | null>>, report: ReportDataset): Array<Record<string, string | number | null>> => rows.map((row) => ({ shop_name: report.meta.shop_name, shop_id: report.filters.shopIds[0] ?? null, ...row }))
  const sections = {
    channels: reports.flatMap((report) => attachShop(report.sections.channels, report)),
    keywords: reports.flatMap((report) => attachShop(report.sections.keywords, report)),
    campaigns: reports.flatMap((report) => attachShop(report.sections.campaigns, report)),
    alerts: reports.flatMap((report) => attachShop(report.sections.alerts, report)),
    service: reports.flatMap((report) => attachShop(report.sections.service, report))
  }
  const completeShopCount = reports.filter(({ quality }) => quality.status === 'complete').length
  const allComplete = missingShopCount === 0 && completeShopCount === reports.length
  return {
    schema_version: '1.0.0',
    report_type: query.reportType,
    dataset_id: `tmall_multi_${query.dateEnd.replaceAll('-', '')}`,
    filters: query,
    meta: {
      shop_name: `${reports.length} 家店铺汇总`, date_range: query.dateStart === query.dateEnd ? query.dateEnd : `${query.dateStart}—${query.dateEnd}`,
      updated_at: reports.map(({ meta }) => meta.updated_at).sort().at(-1) ?? generatedAt, biz_date: query.dateEnd,
      data_status: 'real', collection_status: 'completed', normalizer_version: reports.every(({ meta }) => meta.normalizer_version === reports[0]?.meta.normalizer_version) ? reports[0]?.meta.normalizer_version ?? 'unknown' : 'mixed'
    },
    summary,
    trend: [...trends.values()].sort((left, right) => String(left['date']).localeCompare(String(right['date']))),
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

function nullableSum(values: unknown[]): number | null {
  const numbers = values.map(nullableNumeric).filter((value): value is number => value !== null)
  return numbers.length === values.length ? numbers.reduce((sum, value) => sum + value, 0) : null
}
