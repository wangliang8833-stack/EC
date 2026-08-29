import type { ReportDataset, ReportQuery } from '@ecommerce/shared'
import { describe, expect, it } from 'vitest'
import { aggregateReports } from './report-aggregation.js'

const query: ReportQuery = { reportType: 'tmall_daily_dashboard', dateStart: '2026-08-28', dateEnd: '2026-08-28', platforms: ['tmall'], shopIds: ['a', 'b'], ownerIds: [] }

function report(shopId: string, payAmt: number, refundAmt: number, buyers: number, visitors: number): ReportDataset {
  return {
    schema_version: '1.0.0', report_type: query.reportType, dataset_id: shopId,
    filters: { ...query, shopIds: [shopId] },
    meta: { shop_name: `店铺${shopId}`, date_range: query.dateEnd, updated_at: '2026-08-28T01:00:00.000Z', biz_date: query.dateEnd, data_status: 'real', collection_status: 'completed', normalizer_version: 'tmall-0.4.0' },
    summary: { pay_amt: payAmt, refund_amt: refundAmt, pay_buyer_count: buyers, visitor_count: visitors, ad_spend: 2, ad_pay_amt: 4 },
    trend: [{ date: query.dateEnd, pay_amt: payAmt, refund_amt: refundAmt, visitor_count: visitors, pay_order_count: buyers, ad_spend: 2 }],
    shop_rows: [{ item_id: shopId, pay_amt: payAmt }],
    sections: { channels: [], keywords: [], campaigns: [], alerts: [], service: [] },
    quality: { complete_shop_count: 0, missing_shop_count: 1, warning_count: 1, status: 'partial', dataset_count: 7, warnings: ['部分完整'] },
    source_paths: [`data/${shopId}.json`], generated_at: '2026-08-28T01:00:00.000Z'
  }
}

describe('aggregateReports', () => {
  it('sums shop facts and recalculates rates from the combined totals', () => {
    const result = aggregateReports(query, 2, [report('a', 30, 3, 1, 5), report('b', 70, 7, 3, 15)])

    expect(result?.summary).toMatchObject({ pay_amt: 100, refund_amt: 10, pay_buyer_count: 4, visitor_count: 20, pay_rate: 0.2, customer_unit_price: 25, refund_rate: 0.1, ad_roi: 25 })
    expect(result?.trend).toEqual([expect.objectContaining({ pay_amt: 100, refund_amt: 10 })])
    expect(result?.shop_rows).toHaveLength(2)
    expect(result?.quality.dataset_count).toBe(14)
  })

  it('does not turn missing refund facts into a zero-valued refund rate', () => {
    const first = report('a', 30, 0, 1, 5)
    const second = report('b', 70, 0, 3, 15)
    second.summary['refund_amt'] = null
    second.trend[0]!['refund_amt'] = null

    const result = aggregateReports(query, 2, [first, second])

    expect(result?.summary['refund_amt']).toBeNull()
    expect(result?.summary['refund_rate']).toBeNull()
    expect(result?.trend[0]?.['refund_amt']).toBeNull()
  })
})
