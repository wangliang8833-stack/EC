import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReportDataset } from '@ecommerce/shared'
import { buildCommerceAnalysis, loadAnalysisCells, type AnalysisCell, type AnalysisScope } from './commerce-analysis-model.js'
import { renderCommerceAnalysisHtml } from './CommerceAnalysisReport.js'

const scope: AnalysisScope = { endDate: '2026-09-16', days: 1, shops: [{ shopId: 'a', shopName: '店铺甲' }, { shopId: 'b', shopName: '店铺乙' }], template: 'overview' }
function cell(shopId: string, date: string, summary: ReportDataset['summary'] = {}): AnalysisCell {
  return { shopId, date, error: null, report: {
    schema_version: '1.0.0', report_type: 'tmall_daily_dashboard', dataset_id: `${shopId}-${date}`,
    filters: { reportType: 'tmall_daily_dashboard', dateStart: date, dateEnd: date, platforms: ['tmall'], shopIds: [shopId], ownerIds: [] },
    meta: { shop_name: shopId, date_range: date, updated_at: `${date}T20:00:00Z`, biz_date: date, data_status: 'real', collection_status: 'completed', normalizer_version: 'tmall-0.6.0', data_finality: 'final' },
    summary, trend: [], shop_rows: [], sections: { channels: [], keywords: [], campaigns: [], alerts: [], service: [] },
    quality: { complete_shop_count: 1, missing_shop_count: 0, status: 'complete', dataset_count: 1, warnings: [], warning_count: 0 },
    source_paths: [`data/raw/${shopId}/${date}.json`], generated_at: `${date}T20:00:00Z`
  } }
}
const fixedTime = '2026-09-17T01:00:00Z'
describe('local commerce analysis templates', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(fixedTime)) })
  afterEach(() => { vi.useRealTimers() })
  it('preserves partial sums but suppresses ratios on incomplete scope', () => {
    const r = buildCommerceAnalysis(scope, [cell('a', '2026-09-16', { pay_amt: 100, visitor_count: 10, pay_buyer_count: 2, ad_spend: 20 })], fixedTime)
    expect(r.metrics.find(m => m.key === 'pay_amt')).toMatchObject({ value: 100, reported: 1, expected: 2 })
    expect(r.metrics.find(m => m.key === 'conversion')?.value).toBeNull()
    expect(r.metrics.find(m => m.key === 'store_roi')?.value).toBeNull()
    expect(r.shops[1]?.pay).toBeNull()
    expect(r.available).toBe(1)
  })
  it('compares exactly the same complete shops, not changing coverage', () => {
    const r = buildCommerceAnalysis(scope, [cell('a', '2026-09-15', { pay_amt: 100 }), cell('a', '2026-09-16', { pay_amt: 80 }), cell('b', '2026-09-16', { pay_amt: 1000 })], fixedTime)
    expect(r.comparison).toEqual({ shopCount: 1, current: 80, previous: 100, delta: -20, ratio: -0.2 })
    expect(r.shops[1]?.delta).toBeNull()
  })
  it('keeps zero facts and refuses zero-denominator growth or ticket', () => {
    const s = { ...scope, shops: scope.shops.slice(0, 1) }
    const r = buildCommerceAnalysis(s, [cell('a', '2026-09-15', { pay_amt: 0 }), cell('a', '2026-09-16', { pay_amt: 0, pay_buyer_count: 0, visitor_count: 0, ad_spend: 0 })], fixedTime)
    expect(r.metrics[0]?.value).toBe(0)
    expect(r.comparison.ratio).toBeNull()
    expect(r.shops[0]?.ticket).toBeNull()
    expect(r.shops[0]?.conversion).toBeNull()
  })
  it('requires every day of both periods before comparing a shop', () => {
    const s: AnalysisScope = { ...scope, days: 7, shops: scope.shops.slice(0, 1) }
    const cells = Array.from({ length: 14 }, (_, i) => cell('a', `2026-09-${String(i + 3).padStart(2, '0')}`, { pay_amt: i < 7 ? 10 : 20 }))
    const r = buildCommerceAnalysis(s, cells, fixedTime)
    expect(r.comparison).toMatchObject({ current: 140, previous: 70, delta: 70 })
    expect(buildCommerceAnalysis(s, cells.slice(1), fixedTime).comparison.shopCount).toBe(0)
    expect(r.metrics.find(m => m.key === 'visitor_count')?.definition).toContain('未跨店或跨日去重')
  })
  it('rejects duplicate, mismatched and realtime rows instead of summing twice', () => {
    const a = cell('a', '2026-09-16', { pay_amt: 100 }), b = cell('b', '2026-09-16', { pay_amt: 200 })
    b.report!.meta.data_finality = 'realtime'
    const r = buildCommerceAnalysis(scope, [a, a, b], fixedTime)
    expect(r.available).toBe(0)
    expect(r.metrics[0]?.value).toBeNull()
    expect(r.warnings.join(' ')).toContain('重复')
  })
  it('sums money in fen and separates refund/advertising meanings', () => {
    const r = buildCommerceAnalysis(scope, [cell('a', '2026-09-16', { pay_amt: 0.1, refund_amt: 0.2, ad_spend: 0.4, ad_pay_amt: 0.1, platform_ad_roi: 4 }), cell('b', '2026-09-16', { pay_amt: 0.2 })], fixedTime)
    expect(r.metrics[0]?.value).toBe(0.3)
    expect(r.findings.some(f => f.id === 'attribution')).toBe(true)
    expect(r.findings.some(f => f.id === 'spend:a')).toBe(true)
    expect(renderCommerceAnalysisHtml(r)).toContain('200.00%')
  })
  it('diagnoses traffic against its own prior period, without an invented 3% benchmark', () => {
    const r = buildCommerceAnalysis(scope, [cell('a', '2026-09-15', { visitor_count: 100, pay_buyer_count: 10 }), cell('a', '2026-09-16', { visitor_count: 200, pay_buyer_count: 12 })], fixedTime)
    const finding = r.findings.find(f => f.id === 'traffic:a')
    expect(finding?.evidence).toContain('10.00% → 6.00%')
    expect(finding?.interpretation).toContain('尚无因果证据')
  })
  it('uses latest-day products and does not merge same item ids across shops', () => {
    const a = cell('a', '2026-09-16', { pay_amt: 100 }), b = cell('b', '2026-09-16', { pay_amt: 200 }), old = cell('a', '2026-09-15', { pay_amt: 300 })
    for (const c of [a, b, old]) c.report!.shop_rows = [{ item_id: 'same', item_title: c.shopId, pay_amt: 60 }]
    const r = buildCommerceAnalysis(scope, [a, b, old], fixedTime)
    expect(r.products).toHaveLength(2)
    expect(r.findings.some(f => f.id === 'concentration:a')).toBe(true)
    expect(r.findings.some(f => f.id === 'concentration:b')).toBe(false)
  })
  it('renders escaped, standalone, deterministic HTML from the same report model', () => {
    const s = { ...scope, shops: [{ shopId: 'a', shopName: '<script>alert(1)</script>' }] }
    const a = cell('a', '2026-09-16', { pay_amt: 123 })
    a.report!.shop_rows = [{ item_title: '<img src=x onerror=alert(1)>', pay_amt: 100 }]
    const r = buildCommerceAnalysis(s, [a], fixedTime), html = renderCommerceAnalysisHtml(r)
    expect(html).toBe(renderCommerceAnalysisHtml(buildCommerceAnalysis(s, [a], fixedTime)))
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img ')
    expect(html).toContain('¥123.00')
    expect(html).toContain('data/raw/a/2026-09-16.json')
    expect(html).not.toMatch(/(?:href|src)="https?:/)
  })
  it('routes distinct templates without adding untriggered prescriptions', () => {
    const a = cell('a', '2026-09-16', { pay_amt: 100, ad_spend: 200 })
    const r = buildCommerceAnalysis({ ...scope, template: 'merchandise' }, [a], fixedTime)
    expect(r.findings.some(f => f.id.startsWith('spend:'))).toBe(false)
    expect(renderCommerceAnalysisHtml(r)).not.toContain('广告与退款口径核查')
    expect(renderCommerceAnalysisHtml(r)).toContain('来源 Top 样本')
  })
  it('loads daily queries with bounded concurrency and isolates one failed day', async () => {
    let active = 0, peak = 0
    const query = vi.fn(async (q: ReportDataset['filters']) => {
      active++; peak = Math.max(peak, active)
      await Promise.resolve(); active--
      expect(q.dateStart).toBe(q.dateEnd)
      if (q.shopIds[0] === 'b') throw new Error('采集读取失败')
      return cell(q.shopIds[0]!, q.dateEnd, { pay_amt: 10 }).report!
    })
    const cells = await loadAnalysisCells(scope, query)
    expect(query).toHaveBeenCalledTimes(4)
    expect(peak).toBeLessThanOrEqual(4)
    expect(cells.filter(c => c.error)).toHaveLength(2)
    expect(buildCommerceAnalysis(scope, cells).available).toBe(1)
  })
  it('discards cancelled loads and stops scheduling remaining dates', async () => {
    let cancelled = false
    const query = vi.fn(async (q: ReportDataset['filters']) => { cancelled = true; return cell(q.shopIds[0]!, q.dateEnd).report! })
    const cells = await loadAnalysisCells({ ...scope, days: 30 }, query, () => cancelled)
    expect(cells).toEqual([])
    expect(query.mock.calls.length).toBeLessThanOrEqual(4)
  })
  it('does not turn an empty API response or wrong shop into real data', async () => {
    const query = async (q: ReportDataset['filters']): Promise<ReportDataset> => cell('wrong-shop', q.dateEnd, { pay_amt: 999 }).report!
    const cells = await loadAnalysisCells(scope, query)
    expect(cells.every(c => c.report === null)).toBe(true)
  })
})
