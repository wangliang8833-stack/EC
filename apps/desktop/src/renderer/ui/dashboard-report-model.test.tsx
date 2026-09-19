import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReportDataset } from '@ecommerce/shared'
import { describe, expect, it, vi } from 'vitest'
import { DashboardReportTable } from './DashboardReportTable.js'
import { dashboardPercent, dashboardInteger, dashboardMoney, metricCoverage, lowerBoundNote, startDashboardQuery } from './dashboard-report-model.js'

function deferredReport() {
  let resolve!: (value: ReportDataset) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<ReportDataset>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function reportForDate(date: string): ReportDataset {
  return {
    schema_version: '1.0.0', report_type: 'tmall_daily_dashboard', dataset_id: date,
    filters: { reportType: 'tmall_daily_dashboard', dateStart: date, dateEnd: date, platforms: ['tmall'], shopIds: ['a'], ownerIds: [] },
    meta: { shop_name: '测试店', date_range: date, updated_at: date, biz_date: date, data_status: 'real', collection_status: 'completed' },
    summary: {}, trend: [], shop_rows: [], sections: { channels: [], keywords: [], campaigns: [], alerts: [], service: [] },
    quality: { complete_shop_count: 0, missing_shop_count: 0, warning_count: 0, status: 'partial', dataset_count: 7, warnings: [] },
    source_paths: [], generated_at: date
  }
}

describe('sales overview display and query lifecycle', () => {
  it('formats ratios without guessing units and preserves unavailable values', () => {
    expect(dashboardPercent(1.5)).toBe('150.00%')
    expect(dashboardPercent(0.005)).toBe('0.50%')
    expect(dashboardPercent(0)).toBe('0.00%')
    expect([dashboardPercent(null), dashboardMoney(null), dashboardInteger(null)]).toEqual(['—', '—', '—'])
    expect([dashboardMoney(0), dashboardInteger(0)]).toEqual(['¥0.00', '0'])
  })

  it('shows coverage and lower bounds independently of reported store totals', () => {
    const summary = { refund_amt: 0, refund_amt_reported_shop_count: 1, refund_amt_missing_shop_count: 1, refund_amt_lower_bound: 20 }
    expect(metricCoverage(summary, 'refund_amt')).toContain('1/2 家')
    expect(lowerBoundNote(summary, 'refund_amt')).toContain('Top 下限 ¥20.00')
  })

  it('renders shop identity for matching multi-shop source, product and keyword rows', () => {
    for (const detail of ['channels', 'products', 'keywords'] as const) {
      const html = renderToStaticMarkup(createElement(DashboardReportTable, {
        detail, multipleShops: true, rows: ['店铺甲', '店铺乙'].map((shop) => ({ shop_name: shop, source_name: '搜索', item_title: '同名商品', keyword: '同名词', visitor_count: 10, pay_amt: 100 }))
      }))
      expect(html).toContain('店铺甲')
      expect(html).toContain('店铺乙')
      expect(html).toContain('<th>店铺</th>')
    }
  })

  it('renders all normalized service metric records with source and account identity', () => {
    const html = renderToStaticMarkup(createElement(DashboardReportTable, {
      detail: 'service', multipleShops: true, rows: Array.from({ length: 12 }, (_, index) => ({
        shop_name: '店铺甲', service_account: '客服甲', service_source: '日明细', name: `指标${index}`, value: index, unit: '人'
      }))
    }))
    expect(html).toContain('指标11')
    expect(html).toContain('客服甲')
    expect(html).toContain('日明细')
  })

  it('ignores a late success from the previous filter after the latest query has completed', async () => {
    const old = deferredReport()
    const latest = deferredReport()
    const callbacks = { onData: vi.fn(), onError: vi.fn(), onSettled: vi.fn() }
    const cleanup = startDashboardQuery(() => old.promise, callbacks)
    cleanup()
    startDashboardQuery(() => latest.promise, callbacks)
    const current = reportForDate('2026-09-16')
    latest.resolve(current)
    await vi.waitFor(() => expect(callbacks.onSettled).toHaveBeenCalledOnce())
    old.resolve(reportForDate('2026-09-15'))
    await old.promise
    await Promise.resolve()
    expect(callbacks.onData).toHaveBeenCalledExactlyOnceWith(current)
    expect(callbacks.onSettled).toHaveBeenCalledOnce()
  })

  it('ignores obsolete errors and loading completion while the new request is pending', async () => {
    const old = deferredReport()
    const latest = deferredReport()
    const callbacks = { onData: vi.fn(), onError: vi.fn(), onSettled: vi.fn() }
    const cleanup = startDashboardQuery(() => old.promise, callbacks)
    cleanup()
    startDashboardQuery(() => latest.promise, callbacks)
    old.reject(new Error('old shop failed'))
    await old.promise.catch(() => undefined)
    await Promise.resolve()
    await Promise.resolve()
    expect(callbacks.onError).not.toHaveBeenCalled()
    expect(callbacks.onSettled).not.toHaveBeenCalled()
    latest.reject(new Error('current shop failed'))
    await vi.waitFor(() => expect(callbacks.onSettled).toHaveBeenCalledOnce())
    expect(callbacks.onError).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'current shop failed' }))
  })
})
