import { describe, expect, it } from 'vitest'
import type { ReportDataset, ReportQuery } from '@ecommerce/shared'
import { buildPromotionReport } from './promotion-report.js'

const query: ReportQuery = {
  reportType: 'tmall_promotion_report',
  dateStart: '2026-08-31',
  dateEnd: '2026-08-31',
  platforms: ['tmall'],
  shopIds: ['TEST_SHOP_1'],
  ownerIds: []
}

describe('buildPromotionReport', () => {
  it('preserves known account metrics and marks unavailable detail as partial', () => {
    const result = buildPromotionReport(query, 1, [dailyReport()], [{ shopId: 'TEST_SHOP_1', shopName: '示例店铺1', platform: 'tmall' }])
    expect(result?.summary).toMatchObject({ spend: 178.74, clicks: 144, cpc: 1.24125, transaction_amount: 0, roi: 0.70700458766924 })
    expect(result?.sections.promotion_accounts?.[0]).toMatchObject({ shop_id: 'TEST_SHOP_1', shop_name: '示例店铺1', source_level: 'sycm_account_summary' })
    expect(result?.quality.status).toBe('partial')
    expect(result?.quality.warnings).toContain('万相台计划级明细尚未接入；当前只展示生意参谋广告账户汇总。')
  })

  it('does not replace unavailable metrics with zero', () => {
    const source = dailyReport()
    source.sections.campaigns = []
    source.summary['ad_pay_amt'] = null
    source.summary['platform_ad_roi'] = null
    const result = buildPromotionReport(query, 1, [source])
    expect(result?.summary['clicks']).toBeNull()
    expect(result?.summary['transaction_amount']).toBeNull()
    expect(result?.summary['roi']).toBeNull()
  })

  it('flags contradictory attribution fields', () => {
    const result = buildPromotionReport(query, 1, [dailyReport()])
    expect(result?.quality.warnings.some((warning) => warning.includes('归因字段口径不一致'))).toBe(true)
  })
})

function dailyReport(): ReportDataset {
  return {
    schema_version: '1.0.0', report_type: 'tmall_daily_dashboard', dataset_id: 'tmall_TEST_SHOP_1_20260831', filters: { ...query, reportType: 'tmall_daily_dashboard' },
    meta: { shop_name: '示例店铺1', date_range: '2026-08-31', updated_at: '2026-09-01T00:28:48.277Z', biz_date: '2026-08-31', data_status: 'real', collection_status: 'completed', data_finality: 'final' },
    summary: { pay_amt: 217.52, pay_order_count: 11, ad_spend: 178.74, ad_pay_amt: 0, platform_ad_roi: 0.70700458766924 },
    trend: [], shop_rows: [],
    sections: { channels: [], keywords: [], campaigns: [{ campaign_name: '生意参谋广告汇总（非计划级）', spend: 178.74, clicks: 144, attributed_pay_amt: 0, roi: 0.70700458766924 }], alerts: [], service: [] },
    quality: { complete_shop_count: 0, missing_shop_count: 1, warning_count: 1, status: 'partial', dataset_count: 7, warnings: ['广告计划明细待后续接入。'] },
    source_paths: ['data/normalized/tmall/TEST_SHOP_1/account/2026/08/31/ad_account_daily.json'], generated_at: '2026-09-01T00:28:48.277Z'
  }
}
