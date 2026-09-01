import type { ReportDataset, ReportQuery } from '@ecommerce/shared'

const SUM_KEYS = [
  'pay_amt', 'pay_order_count', 'pay_buyer_count', 'pay_item_count', 'visitor_count', 'page_view_count',
  'ad_spend', 'ad_pay_amt'
] as const

export interface ReportShopTarget {
  shopId: string
  shopName: string
  platform: string
}

export function aggregateReports(query: ReportQuery, expectedShopCount: number, reports: ReportDataset[], expectedShops: ReportShopTarget[] = []): ReportDataset | null {
  if (reports.length === 0) return null
  if (reports.length === 1 && expectedShopCount === 1) {
    const report = reports[0]
    if (!report) return null
    return { ...report, sections: { ...report.sections, shop_overview: buildShopOverview(reports, expectedShops) } }
  }
  const generatedAt = new Date().toISOString()
  const summary: Record<string, string | number | null> = {}
  for (const key of SUM_KEYS) summary[key] = reports.reduce((sum, report) => sum + numeric(report.summary[key]), 0)
  const refundReports = reports.flatMap((report) => {
    const refundAmt = nullableNumeric(report.summary['refund_amt'])
    return refundAmt === null ? [] : [{ refundAmt, payAmt: numeric(report.summary['pay_amt']) }]
  })
  const refundReportedShopCount = refundReports.length
  const refundMissingShopCount = Math.max(0, expectedShopCount - refundReportedShopCount)
  summary['refund_amt'] = refundReportedShopCount > 0 ? refundReports.reduce((sum, { refundAmt }) => sum + refundAmt, 0) : null
  summary['refund_reported_shop_count'] = refundReportedShopCount
  summary['refund_missing_shop_count'] = refundMissingShopCount
  const payAmt = numeric(summary['pay_amt'])
  const payBuyers = numeric(summary['pay_buyer_count'])
  const visitors = numeric(summary['visitor_count'])
  const refundAmt = nullableNumeric(summary['refund_amt'])
  const refundCoveredPayAmt = refundReports.reduce((sum, report) => sum + report.payAmt, 0)
  const adSpend = numeric(summary['ad_spend'])
  const adPayAmt = numeric(summary['ad_pay_amt'])
  summary['pay_rate'] = visitors > 0 ? payBuyers / visitors : 0
  summary['customer_unit_price'] = payBuyers > 0 ? payAmt / payBuyers : 0
  summary['refund_rate'] = refundCoveredPayAmt > 0 && refundAmt !== null ? refundAmt / refundCoveredPayAmt : null
  summary['ad_roi'] = adSpend > 0 ? payAmt / adSpend : null
  summary['platform_ad_roi'] = adSpend > 0 ? adPayAmt / adSpend : null

  const trends = new Map<string, Record<string, string | number | null>>()
  for (const report of reports) {
    for (const row of report.trend) {
      const date = String(row['date'] ?? report.meta.biz_date)
      const current = trends.get(date) ?? { date, pay_amt: 0, refund_amt: null, refund_reported_shop_count: 0, refund_missing_shop_count: expectedShopCount, visitor_count: 0, pay_order_count: 0, ad_spend: 0 }
      for (const key of ['pay_amt', 'visitor_count', 'pay_order_count', 'ad_spend']) current[key] = numeric(current[key]) + numeric(row[key])
      const rowRefundAmt = nullableNumeric(row['refund_amt'])
      if (rowRefundAmt !== null) {
        current['refund_amt'] = numeric(current['refund_amt']) + rowRefundAmt
        current['refund_reported_shop_count'] = numeric(current['refund_reported_shop_count']) + 1
      }
      trends.set(date, current)
    }
  }
  for (const row of trends.values()) {
    row['refund_missing_shop_count'] = Math.max(0, expectedShopCount - numeric(row['refund_reported_shop_count']))
  }
  const missingShopCount = Math.max(0, expectedShopCount - reports.length)
  const warnings = [...new Set(reports.flatMap(({ quality }) => quality.warnings))]
  if (refundMissingShopCount > 0) {
    warnings.unshift(refundReportedShopCount > 0
      ? `${refundMissingShopCount} 家店铺未返回退款金额，当前退款金额与退款影响率仅按 ${refundReportedShopCount} 家已知数据汇总。`
      : `${refundMissingShopCount} 家店铺均未返回退款金额，当前无法计算退款金额与退款影响率。`)
  }
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
      visitor_count: report ? nullableNumeric(report.summary['visitor_count']) : null,
      pay_buyer_count: report ? nullableNumeric(report.summary['pay_buyer_count']) : null,
      pay_rate: report ? nullableNumeric(report.summary['pay_rate']) : null,
      refund_amt: report ? nullableNumeric(report.summary['refund_amt']) : null,
      ad_spend: report ? nullableNumeric(report.summary['ad_spend']) : null,
      data_status: report?.quality.status ?? 'empty',
      warning_count: report?.quality.warning_count ?? 0,
      data_finality: report?.meta.data_finality ?? null,
      updated_at: report?.meta.updated_at ?? null
    }
  })
}
