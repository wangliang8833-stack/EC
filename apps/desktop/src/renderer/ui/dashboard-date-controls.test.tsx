import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import type { ReportDataset } from '@ecommerce/shared'
import { DashboardCoverageNotice } from './DashboardDateControls.js'
import { DashboardReportTable } from './DashboardReportTable.js'
import { metricCoverage } from './dashboard-report-model.js'

function coverageDataset(missing: boolean): Pick<ReportDataset, 'dashboard_coverage'> {
  return { dashboard_coverage: { expectedShopDays: 2, reportedShopDays: missing ? 1 : 2, completeShopCount: missing ? 0 : 1, shops: [{ shopId: 'one', shopName: '示例店', platform: 'tmall', missingDates: missing ? ['2026-09-17'] : [], incompleteDates: [] }] } }
}
describe('dashboard range rendering', () => {
  it('shows green complete status and red per-shop/date gaps', () => {
    const render = (missing: boolean): string => renderToStaticMarkup(createElement(DashboardCoverageNotice, { dataset: coverageDataset(missing), loading: false, error: false, emptyScope: false, preview: false }))
    expect(render(false)).toContain('dashboard-coverage-complete')
    expect(render(true)).toContain('dashboard-coverage-missing')
    expect(render(true)).toContain('2026-09-17')
    expect(render(true)).toContain('示例店')
  })
  it.each(['loading', 'error', 'emptyScope', 'preview'] as const)('suppresses stale complete status during %s', state => {
    const html = renderToStaticMarkup(createElement(DashboardCoverageNotice, { dataset: coverageDataset(false), loading: false, error: false, emptyScope: false, preview: false, [state]: true }))
    expect(html).not.toContain('dashboard-coverage-complete')
    expect(html).toContain('dashboard-coverage-neutral')
  })
  it('shows store-day metric coverage and dates on detailed records', () => {
    expect(metricCoverage({ pay_amt_missing_shop_day_count: 1, pay_amt_reported_shop_day_count: 3 }, 'pay_amt')).toContain('3/4 店铺日')
    const html = renderToStaticMarkup(createElement(DashboardReportTable, { rows: [{ biz_date: '2026-09-17', item_title: '示例' }], detail: 'products', multipleShops: false, multipleDays: true }))
    expect(html).toContain('<th>日期</th>')
    expect(html).toContain('2026-09-17')
  })
})
