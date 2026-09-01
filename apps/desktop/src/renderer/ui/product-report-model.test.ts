import { describe, expect, it } from 'vitest'
import { buildProductReportModel } from './product-report-model.js'

describe('product report model', () => {
  it('aggregates product and shop metrics without turning unknown refunds into zero', () => {
    const model = buildProductReportModel([
      { shop_id: 'T1', shop_name: '甲店', item_id: 'A', item_title: '商品 A', pay_amt: 400, pay_item_count: 8, pay_buyer_count: 7, visitor_count: 100, refund_amt: 50 },
      { shop_id: 'T2', shop_name: '乙店', item_id: 'B', item_title: '商品 B', pay_amt: 100, pay_item_count: 2, pay_buyer_count: 1, visitor_count: 20, refund_amt: null }
    ])
    expect(model.totals).toMatchObject({ payAmt: 500, payItemCount: 10, payBuyerCount: 8, visitorCount: 120, refundAmt: 50, refundKnownCount: 1, topOneShare: 0.8 })
    expect(model.shops.map(({ shopName, share }) => [shopName, share])).toEqual([['甲店', 0.8], ['乙店', 0.2]])
  })

  it('classifies refund, conversion and growth opportunities', () => {
    const model = buildProductReportModel([
      { item_id: 'refund', pay_amt: 500, refund_amt: 120, visitor_count: 100, pay_rate: 0.08 },
      { item_id: 'traffic', pay_amt: 100, refund_amt: 0, visitor_count: 200, pay_rate: 0.02 },
      { item_id: 'potential', pay_amt: 80, refund_amt: 0, visitor_count: 20, pay_rate: 0.2 },
      { item_id: 'sample', pay_amt: 10, refund_amt: 0, visitor_count: 2, pay_rate: 1 }
    ], { shopName: '测试店', shopId: 'T0' })
    expect(model.items.map(({ itemId, diagnosis }) => [itemId, diagnosis])).toEqual([
      ['refund', 'refund-risk'],
      ['traffic', 'high-traffic-low-conversion'],
      ['potential', 'potential'],
      ['sample', 'small-sample']
    ])
  })
})
