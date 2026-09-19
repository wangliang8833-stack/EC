import { describe, expect, it } from 'vitest'
import { dashboardDates, dashboardPreset, dashboardRangeLabel, type ReportDataset, type ReportQuery } from '@ecommerce/shared'
import { normalizeTmallDaily } from '../adapters/tmall/tmall-daily-normalizer.js'
import { historyAccount, historySnapshot } from '../automation/history-test-fixtures.js'
import { buildDashboardRangeReport } from './dashboard-range-report.js'

const query: ReportQuery = { reportType: 'tmall_daily_dashboard', dateStart: '2026-09-17', dateEnd: '2026-09-18', shopIds: ['TEST_SHOP_5', 'TEST_SHOP_1'], platforms: ['tmall'], ownerIds: [] }
const targets = query.shopIds.map(shopId => ({ shopId, shopName: shopId, platform: 'tmall' }))
function daily(shop: string, date: string, pay = 100): ReportDataset {
  const report = normalizeTmallDaily(historySnapshot(date, pay), historyAccount(shop)).report
  report.meta.collection_status = 'completed'
  Object.assign(report.summary, { refund_amt: 0, pay_order_count: 2, pay_buyer_count: 1, visitor_count: 10, page_view_count: 20, pay_item_count: 3, ad_spend: 10, ad_pay_amt: 50 })
  return report
}
const all = (): ReportDataset[] => targets.flatMap(shop => dashboardDates(query.dateStart, query.dateEnd).map(date => daily(shop.shopId, date)))

describe('dashboard date ranges', () => {
  it('uses natural weeks/months including endpoints and caps the current period at yesterday', () => {
    expect(dashboardPreset('week', '2026-09-18', '2026-09-19')).toEqual({ dateStart: '2026-09-14', dateEnd: '2026-09-18' })
    expect(dashboardPreset('week', '2026-09-06', '2026-09-19')).toEqual({ dateStart: '2026-08-31', dateEnd: '2026-09-06' })
    expect(dashboardPreset('month', '2026-09-18', '2026-09-19')).toEqual({ dateStart: '2026-09-01', dateEnd: '2026-09-18' })
    expect(dashboardPreset('month', '2024-02-10', '2026-09-19')).toEqual({ dateStart: '2024-02-01', dateEnd: '2024-02-29' })
    expect(dashboardPreset('week', '2026-09-21', '2026-09-21')).toEqual({ dateStart: '2026-09-14', dateEnd: '2026-09-20' })
    expect(dashboardPreset('month', '', '2026-10-01')).toEqual({ dateStart: '2026-09-01', dateEnd: '2026-09-30' })
    expect(dashboardDates('2026-08-01', '2026-08-31')).toHaveLength(31)
    expect(dashboardRangeLabel({ dateStart: '2025-12-29', dateEnd: '2026-01-04' })).toBe('2025-12-29—2026-01-04')
  })
  it.each([['2026-02-30', '2026-03-01'], ['2026-09-19', '2026-09-18'], ['', '2026-09-18'], ['2025-01-01', '2026-09-18']])('rejects invalid or unbounded ranges %s to %s', (start, end) => {
    expect(() => dashboardDates(start, end)).toThrow()
  })
})

describe('dashboard period aggregation and coverage', () => {
  it('sums every shop/day once and recalculates ratios, per-shop totals and daily trends', () => {
    const reports = all()
    const result = buildDashboardRangeReport(query, targets, [...reports, reports[0]!])
    expect(result.summary).toMatchObject({ pay_amt: 400, visitor_count: 40, pay_rate: 0.1, customer_unit_price: 100, ad_roi: 10 })
    expect(result.trend.map(row => row['pay_amt'])).toEqual([200, 200])
    expect(result.sections.shop_overview?.map(row => row['pay_amt'])).toEqual([200, 200])
    expect(result.dashboard_coverage).toMatchObject({ expectedShopDays: 4, reportedShopDays: 4, completeShopCount: 2 })
    expect(result.shop_rows.map(row => row['biz_date'])).toEqual(['2026-09-17', '2026-09-18', '2026-09-17', '2026-09-18'])
  })
  it('counts missing dates even when the end date is complete, and leaves a gap in the trend', () => {
    const result = buildDashboardRangeReport(query, targets, all().filter(report => report.meta.biz_date === query.dateEnd))
    expect(result.summary).toMatchObject({ pay_amt: 200, pay_amt_reported_shop_day_count: 2, pay_amt_missing_shop_day_count: 2, pay_amt_missing_shop_count: 2, pay_rate: null, ad_roi: null })
    expect(result.trend[0]?.['pay_amt']).toBeNull()
    expect(result.dashboard_coverage?.completeShopCount).toBe(0)
    expect(result.dashboard_coverage?.shops[0]?.missingDates).toEqual(['2026-09-17'])
  })
  it('identifies a missing metric on a single day and does not treat null as zero', () => {
    const reports = all()
    reports[0]!.summary['refund_amt'] = null
    const result = buildDashboardRangeReport(query, targets, reports)
    expect(result.summary).toMatchObject({ refund_amt: 0, refund_amt_reported_shop_day_count: 3, refund_amt_missing_shop_day_count: 1, daily_refund_pay_ratio: null })
    expect(result.dashboard_coverage?.completeShopCount).toBe(1)
    expect(result.dashboard_coverage?.shops[0]?.incompleteDates).toEqual([{ date: '2026-09-17', metrics: ['成功退款金额'] }])
  })
  it('treats genuine zeros as complete while zero denominators leave rates unknown', () => {
    const reports = all()
    reports.forEach(report => Object.keys(report.summary).forEach(key => { report.summary[key] = 0 }))
    const result = buildDashboardRangeReport(query, targets, reports)
    expect(result.dashboard_coverage?.completeShopCount).toBe(2)
    expect(result.summary['pay_amt']).toBe(0)
    expect(result.summary['pay_rate']).toBeNull()
  })
  it('rejects off-date/off-platform/foreign/unfinished records and selects the newer same-day report', () => {
    const old = daily('TEST_SHOP_5', '2026-09-17', 10)
    const newer = structuredClone(old); newer.meta.updated_at = '2099-01-01'; newer.summary['pay_amt'] = 20
    const foreign = daily('T9999', '2026-09-18')
    const invalid = daily('TEST_SHOP_1', '2026-09-18'); invalid.filters.dateStart = '2026-09-17'
    const unfinished = daily('TEST_SHOP_1', '2026-09-17'); unfinished.meta.collection_status = 'not_collected'
    const otherPlatform = daily('TEST_SHOP_1', '2026-09-18'); otherPlatform.filters.platforms = ['jd']
    const result = buildDashboardRangeReport(query, targets, [newer, old, foreign, invalid, unfinished, otherPlatform, daily('TEST_SHOP_5', '2026-09-16')])
    expect(result.summary['pay_amt']).toBe(20)
    expect(result.dashboard_coverage?.reportedShopDays).toBe(1)
  })
  it('includes absent shops, distinguishes platform identities and returns coverage for an empty range', () => {
    const result = buildDashboardRangeReport(query, [...targets, { ...targets[0]!, platform: 'jd' }], [])
    expect(result.meta.data_status).toBe('empty')
    expect(result.dashboard_coverage).toMatchObject({ expectedShopDays: 6, reportedShopDays: 0, completeShopCount: 0 })
    expect(result.sections.shop_overview).toHaveLength(3)
    expect(result.trend).toHaveLength(2)
    expect(result.summary['pay_amt']).toBeNull()
  })
  it('keeps daily platform rates but never reuses one day rate for a multi-day interval', () => {
    const report = daily('TEST_SHOP_5', '2026-09-18'); report.summary['pay_rate'] = 0.7
    const single = buildDashboardRangeReport({ ...query, dateStart: query.dateEnd, shopIds: ['TEST_SHOP_5'] }, [targets[0]!], [report])
    expect(single.summary['pay_rate']).toBe(0.7)
    expect(buildDashboardRangeReport(query, targets, [report]).summary['pay_rate']).toBeNull()
  })
  it('does not mark an unsettled realtime snapshot complete', () => {
    const reports = all(); reports[0]!.meta.data_finality = 'realtime'
    expect(buildDashboardRangeReport(query, targets, reports).dashboard_coverage?.completeShopCount).toBe(1)
  })
  it('suppresses platform ratios when a single-day source metric is absent in all views', () => {
    const report = daily('TEST_SHOP_5', query.dateEnd)
    Object.assign(report.summary, { pay_rate: 0.5, platform_ad_roi: 8, pay_buyer_count: null, ad_spend: null })
    const result = buildDashboardRangeReport({ ...query, dateStart: query.dateEnd, shopIds: ['TEST_SHOP_5'] }, [targets[0]!], [report])
    for (const summary of [result.summary, result.sections.shop_overview![0]!, result.trend[0]!]) expect(summary).toMatchObject({ pay_rate: null, platform_ad_roi: null })
  })
})
