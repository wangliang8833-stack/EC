import { dashboardDates, type ReportDataset, type ReportQuery } from '@ecommerce/shared'
import { SUM_KEYS, summarizeReports, type ReportShopTarget } from './report-aggregation.js'

const CORE_METRICS = {
  pay_amt: '支付金额', pay_order_count: '支付子订单数', pay_buyer_count: '支付买家数',
  visitor_count: '访客数', page_view_count: '浏览量', refund_amt: '成功退款金额', ad_spend: '广告消耗'
}
const known = (value: unknown): boolean => typeof value === 'number' && Number.isFinite(value)
const identity = (platform: string, shopId: string): string => `${platform}/${shopId}`

function dashboardSummary(reports: ReportDataset[], expected: number, usePlatformRate = true): ReportDataset['summary'] {
  const summary = summarizeReports(reports, expected, usePlatformRate)
  // Single-day platform ratios still require the same underlying coverage as period ratios.
  for (const [ratio, numerator, denominator] of [['pay_rate', 'pay_buyer_count', 'visitor_count'], ['platform_ad_roi', 'ad_pay_amt', 'ad_spend']] as const) {
    if (summary[`${numerator}_missing_shop_count`] !== 0 || summary[`${denominator}_missing_shop_count`] !== 0) summary[ratio] = null
  }
  return summary
}

export function buildDashboardRangeReport(query: ReportQuery, targets: ReportShopTarget[], input: ReportDataset[]): ReportDataset {
  const dates = dashboardDates(query.dateStart, query.dateEnd)
  const shops = [...new Map(targets.map(shop => [identity(shop.platform, shop.shopId), shop])).values()]
  const selected = new Set(shops.map(shop => identity(shop.platform, shop.shopId)))
  // A refreshed report replaces the same shop/day; never count two runs twice.
  const byDay = new Map<string, ReportDataset>()
  for (const report of input) {
    const platform = report.filters.platforms[0], shopId = report.filters.shopIds[0], date = report.meta.biz_date
    if (!platform || !shopId || report.filters.shopIds.length !== 1 || report.filters.platforms.length !== 1
      || !selected.has(identity(platform, shopId)) || !dates.includes(date)
      || report.filters.dateStart !== date || report.filters.dateEnd !== date
      || report.meta.data_status !== 'real' || report.meta.collection_status !== 'completed') continue
    const key = `${identity(platform, shopId)}/${date}`
    const previous = byDay.get(key)
    if (!previous || report.meta.updated_at > previous.meta.updated_at) byDay.set(key, report)
  }
  const reports = [...byDay.values()]
  const reportsFor = (shop: ReportShopTarget): ReportDataset[] => dates.flatMap(date => {
    const report = byDay.get(`${identity(shop.platform, shop.shopId)}/${date}`)
    return report ? [report] : []
  })
  const coverageShops = shops.map(shop => ({
    ...shop,
    missingDates: dates.filter(date => !byDay.has(`${identity(shop.platform, shop.shopId)}/${date}`)),
    incompleteDates: reportsFor(shop).flatMap(report => {
      const metrics = Object.entries(CORE_METRICS).filter(([key]) => !known(report.summary[key])).map(([, label]) => label)
      if (report.meta.data_finality === 'realtime') metrics.push('未结算的实时快照')
      return metrics.length ? [{ date: report.meta.biz_date, metrics }] : []
    })
  }))
  const completeShopCount = coverageShops.filter(shop => !shop.missingDates.length && !shop.incompleteDates.length).length
  const expected = shops.length * dates.length
  const summary = dashboardSummary(reports, expected, dates.length === 1)
  for (const key of SUM_KEYS) {
    summary[`${key}_reported_shop_day_count`] = summary[`${key}_reported_shop_count`] ?? 0
    summary[`${key}_missing_shop_day_count`] = summary[`${key}_missing_shop_count`] ?? expected
    const complete = shops.filter(shop => reportsFor(shop).filter(report => known(report.summary[key])).length === dates.length).length
    summary[`${key}_reported_shop_count`] = complete
    summary[`${key}_missing_shop_count`] = shops.length - complete
  }
  summary['refund_reported_shop_count'] = summary['refund_amt_reported_shop_count'] ?? 0
  summary['refund_missing_shop_count'] = summary['refund_amt_missing_shop_count'] ?? shops.length
  const warnings = [...new Set(reports.flatMap(report => report.quality.warnings))]
  for (const shop of coverageShops) {
    if (shop.missingDates.length) warnings.push(`${shop.shopName}缺少 ${shop.missingDates.length} 天日报：${shop.missingDates.join('、')}。`)
    if (shop.incompleteDates.length) warnings.push(`${shop.shopName}有 ${shop.incompleteDates.length} 天核心指标不完整；详见上方缺失明细。`)
  }
  if (dates.length > 1) warnings.unshift('访客数、支付买家数为每日各店合计，未跨日、跨店去重；转化率与客单价按这些合计重算。Top 与客服明细保留原日期，不代表整个区间的排名或去重结果。')
  if (completeShopCount < shops.length) warnings.unshift('金额与数量仅合计已有值，缺失日期和指标不按 0 处理；相关比率在覆盖不足时显示 —。')
  const rows = (get: (report: ReportDataset) => ReportDataset['shop_rows']): ReportDataset['shop_rows'] => reports.flatMap(report => get(report).map(row => ({
    ...row, shop_name: report.meta.shop_name, shop_id: report.filters.shopIds[0]!, biz_date: report.meta.biz_date
  })))
  const generatedAt = new Date().toISOString()
  return {
    schema_version: '1.0.0', report_type: query.reportType,
    dataset_id: `dashboard_${query.dateStart}_${query.dateEnd}_${shops.map(shop => identity(shop.platform, shop.shopId)).join('_')}`,
    filters: query,
    meta: {
      shop_name: shops.length === 1 ? shops[0]!.shopName : `${shops.length} 家店铺汇总`,
      date_range: `${query.dateStart}—${query.dateEnd}`, biz_date: query.dateEnd,
      updated_at: reports.map(report => report.meta.updated_at).sort().at(-1) ?? generatedAt,
      data_status: reports.length ? 'real' : 'empty', collection_status: reports.length ? 'completed' : 'not_collected'
    },
    summary,
    trend: dates.map(date => ({ date, ...dashboardSummary(reports.filter(report => report.meta.biz_date === date), shops.length) })),
    shop_rows: rows(report => report.shop_rows),
    sections: {
      channels: rows(report => report.sections.channels), keywords: rows(report => report.sections.keywords),
      campaigns: rows(report => report.sections.campaigns), alerts: rows(report => report.sections.alerts), service: rows(report => report.sections.service),
      shop_overview: shops.map((shop, index) => ({
        shop_id: shop.shopId, shop_name: shop.shopName, platform: shop.platform,
        ...dashboardSummary(reportsFor(shop), dates.length, dates.length === 1),
        missing_day_count: coverageShops[index]!.missingDates.length,
        incomplete_day_count: coverageShops[index]!.incompleteDates.length,
        data_status: coverageShops[index]!.missingDates.length || coverageShops[index]!.incompleteDates.length ? 'partial' : 'complete'
      }))
    },
    dashboard_coverage: { expectedShopDays: expected, reportedShopDays: reports.length, completeShopCount, shops: coverageShops },
    quality: {
      complete_shop_count: completeShopCount, missing_shop_count: shops.length - completeShopCount,
      warning_count: warnings.length, warnings,
      status: !reports.length ? 'empty' : completeShopCount === shops.length && reports.every(report => report.quality.status === 'complete') ? 'complete' : 'partial',
      dataset_count: reports.reduce((count, report) => count + report.quality.dataset_count, 0)
    },
    source_paths: [...new Set(reports.flatMap(report => report.source_paths))], generated_at: generatedAt
  }
}
