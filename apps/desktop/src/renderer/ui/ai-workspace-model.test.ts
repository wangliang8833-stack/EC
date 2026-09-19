import { describe, expect, it } from 'vitest'
import type { ReportDataset } from '@ecommerce/shared'
import { buildOperationProposals, buildSelectionOpportunities } from './ai-workspace-model.js'

function report(overrides: Partial<ReportDataset> = {}): ReportDataset {
  return {
    schema_version: '1.0.0', report_type: 'tmall_daily_dashboard', dataset_id: 'dataset-1',
    filters: { reportType: 'tmall_daily_dashboard', dateStart: '2026-09-01', dateEnd: '2026-09-01', platforms: ['tmall'], shopIds: ['T1'], ownerIds: [] },
    meta: { shop_name: '测试店', date_range: '2026-09-01', updated_at: '2026-09-02T00:00:00Z', biz_date: '2026-09-01', data_status: 'real', collection_status: 'completed' },
    summary: { pay_amt: 1000, pay_order_count: 10, pay_buyer_count: 10, visitor_count: 200, pay_rate: 0.05, refund_rate: 0.02 }, trend: [],
    shop_rows: [
      { item_id: 'A', item_title: '商品 A', pay_amt: 800, visitor_count: 100, pay_buyer_count: 10, pay_rate: 0.1, refund_amt: 20 },
      { item_id: 'B', item_title: '商品 B', pay_amt: 200, visitor_count: 80, pay_buyer_count: 1, pay_rate: 0.0125, refund_amt: null }
    ],
    sections: { channels: [], keywords: [], campaigns: [], alerts: [], service: [] },
    quality: { complete_shop_count: 1, missing_shop_count: 0, warning_count: 0, status: 'complete', dataset_count: 1, warnings: [] },
    source_paths: ['data/raw/source.json'], generated_at: '2026-09-02T00:00:00Z', ...overrides
  }
}

describe('AI workspace deterministic models', () => {
  it('ranks selection opportunities reproducibly and keeps source evidence', () => {
    const rows = buildSelectionOpportunities(report())
    expect(rows[0]?.title).toBe('商品 A')
    expect(rows[0]?.overallScore).toBeGreaterThan(rows[1]?.overallScore ?? 0)
    expect(rows[0]?.sourceSnapshotIds).toEqual(['data/raw/source.json'])
  })

  it('detects operation risks before any AI call', () => {
    const promotion = report({ sections: { channels: [], keywords: [], campaigns: [{ campaign_name: '低效计划', spend: 300, platform_roi: 1.8 }], alerts: [], service: [] } })
    const proposals = buildOperationProposals(report(), promotion)
    expect(proposals.some(({ problemCode }) => problemCode === 'SPEND_UP_ROAS_DOWN')).toBe(true)
    expect(proposals.some(({ problemCode }) => problemCode === 'HIGH_TRAFFIC_LOW_CONVERSION')).toBe(true)
  })

})
