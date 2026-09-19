import type { ReportDataset, ReportQuery } from '@ecommerce/shared'
import { describe, expect, it } from 'vitest'
import { aggregateReports } from './report-aggregation.js'

const query: ReportQuery = { reportType: 'tmall_daily_dashboard', dateStart: '2026-08-28', dateEnd: '2026-08-28', platforms: ['tmall'], shopIds: ['a', 'b'], ownerIds: [] }

function report(shopId: string, payAmt: number, refundAmt: number | null, buyers: number, visitors: number, paidSubOrders = buyers): ReportDataset {
  return {
    schema_version: '1.0.0', report_type: query.reportType, dataset_id: shopId,
    filters: { ...query, shopIds: [shopId] },
    meta: { shop_name: `店铺${shopId}`, date_range: query.dateEnd, updated_at: '2026-08-28T01:00:00.000Z', biz_date: query.dateEnd, data_status: 'real', collection_status: 'completed', normalizer_version: 'tmall-0.4.0' },
    summary: { pay_amt: payAmt, refund_amt: refundAmt, pay_order_count: paidSubOrders, pay_buyer_count: buyers, visitor_count: visitors, ad_spend: 2, ad_pay_amt: 4 },
    trend: [{ date: query.dateEnd, pay_amt: payAmt, refund_amt: refundAmt, visitor_count: visitors, pay_order_count: paidSubOrders, ad_spend: 2 }],
    shop_rows: [{ item_id: shopId, pay_amt: payAmt }],
    sections: { channels: [], keywords: [], campaigns: [], alerts: [], service: [] },
    quality: { complete_shop_count: 0, missing_shop_count: 1, warning_count: 1, status: 'partial', dataset_count: 7, warnings: ['部分完整'] },
    source_paths: [`data/${shopId}.json`], generated_at: '2026-08-28T01:00:00.000Z'
  }
}

describe('aggregateReports', () => {
  it('keeps absent totals unknown and prevents rates across differently covered shops', () => {
    const a = report('a', 100, 10, 1, 10)
    const b = report('b', 900, null, 9, 90)
    a.summary['ad_spend'] = 10
    b.summary['ad_spend'] = null
    b.summary['pay_buyer_count'] = null
    b.trend[0]!['ad_spend'] = null
    const result = aggregateReports(query, 2, [a, b])!
    expect(result.summary).toMatchObject({ pay_amt: 1000, ad_spend: 10, ad_spend_reported_shop_count: 1, ad_spend_missing_shop_count: 1, ad_roi: null, pay_rate: null, customer_unit_price: null, daily_refund_pay_ratio: null })
    expect(result.trend[0]).toMatchObject({ ad_spend_missing_shop_count: 1 })
    a.summary['ad_spend'] = null
    a.trend[0]!['ad_spend'] = null
    expect(aggregateReports(query, 2, [a, b])?.summary['ad_spend']).toBeNull()
    expect(aggregateReports(query, 2, [a, b])?.trend[0]?.['ad_spend']).toBeNull()
  })

  it('uses the same daily refund definition in single and multi-shop reports', () => {
    const a = report('a', 100, 20, 1, 10)
    a.summary['platform_refund_rate'] = 0.1
    const b = report('b', 0, 0, 0, 0)
    const single = aggregateReports({ ...query, shopIds: ['a'] }, 1, [a])!
    const multi = aggregateReports(query, 2, [a, b])!
    expect(single.summary).toMatchObject({ daily_refund_pay_ratio: 0.2, platform_refund_rate: 0.1, refund_rate: null })
    expect(multi.summary).toMatchObject({ daily_refund_pay_ratio: 0.2, platform_refund_rate: null, refund_rate: null })
  })

  it('keeps lower bounds distinct from covered totals in summary and shop overview', () => {
    const a = report('a', 100, null, 1, 10)
    a.summary['refund_amt_lower_bound'] = 20
    const result = aggregateReports(query, 2, [a, report('b', 0, 0, 0, 0)])!
    expect(result.summary).toMatchObject({ refund_amt: 0, refund_amt_lower_bound: 20, refund_reported_shop_count: 1, refund_missing_shop_count: 1, daily_refund_pay_ratio: null })
    expect(result.sections.shop_overview?.[0]).toMatchObject({ refund_amt: null, refund_amt_lower_bound: 20 })
  })

  it('does not calculate rates when a requested shop has no report or denominators are zero', () => {
    expect(aggregateReports(query, 2, [report('a', 100, 10, 1, 10)])?.summary).toMatchObject({ ad_roi: null, pay_rate: null, customer_unit_price: null })
    expect(aggregateReports(query, 2, [report('a', 0, 0, 0, 0), report('b', 0, 0, 0, 0)])?.summary).toMatchObject({ pay_rate: null, customer_unit_price: null, daily_refund_pay_ratio: null })
  })

  it('sums shop facts and recalculates rates from the combined totals', () => {
    const result = aggregateReports(query, 2, [report('a', 30, 3, 1, 5, 2), report('b', 70, 7, 3, 15, 5)])

    expect(result?.summary).toMatchObject({ pay_amt: 100, refund_amt: 10, pay_order_count: 7, pay_buyer_count: 4, visitor_count: 20, pay_rate: 0.2, customer_unit_price: 25, refund_rate: null, daily_refund_pay_ratio: 0.1, ad_roi: 25 })
    expect(result?.trend).toEqual([expect.objectContaining({ pay_amt: 100, refund_amt: 10, pay_order_count: 7 })])
    expect(result?.shop_rows).toHaveLength(2)
    expect(result?.quality.dataset_count).toBe(14)
  })

  it('sums known refund facts and reports partial shop coverage', () => {
    const first = report('a', 30, 1_273.72, 1, 5)
    const second = report('b', 70, null, 3, 15)

    const result = aggregateReports(query, 2, [first, second])

    expect(result?.summary).toMatchObject({
      refund_amt: 1_273.72,
      refund_rate: null,
      daily_refund_pay_ratio: null,
      refund_reported_shop_count: 1,
      refund_missing_shop_count: 1
    })
    expect(result?.trend[0]).toMatchObject({
      refund_amt: 1_273.72,
      refund_reported_shop_count: 1,
      refund_missing_shop_count: 1
    })
    expect(result?.quality.warnings).toContain('成功退款金额覆盖 1/2 家店铺；仅汇总已知值，相关全范围比率按缺失处理。')
  })

  it('keeps the refund amount missing when no shop reports it', () => {
    const result = aggregateReports(query, 2, [report('a', 30, null, 1, 5), report('b', 70, null, 3, 15)])

    expect(result?.summary).toMatchObject({
      refund_amt: null,
      refund_rate: null,
      refund_reported_shop_count: 0,
      refund_missing_shop_count: 2
    })
    expect(result?.trend[0]).toMatchObject({
      refund_amt: null,
      refund_reported_shop_count: 0,
      refund_missing_shop_count: 2
    })
  })

  it('builds an overview row for every requested shop, including shops without a report', () => {
    const result = aggregateReports(query, 2, [report('a', 30, 3, 1, 5)], [
      { shopId: 'a', shopName: '店铺甲', platform: 'tmall' },
      { shopId: 'b', shopName: '店铺乙', platform: 'tmall' }
    ])

    expect(result?.sections.shop_overview).toEqual([
      expect.objectContaining({ shop_id: 'a', shop_name: '店铺甲', pay_amt: 30, visitor_count: 5, refund_amt: 3, data_status: 'partial' }),
      expect.objectContaining({ shop_id: 'b', shop_name: '店铺乙', pay_amt: null, visitor_count: null, refund_amt: null, data_status: 'empty' })
    ])
  })
})
