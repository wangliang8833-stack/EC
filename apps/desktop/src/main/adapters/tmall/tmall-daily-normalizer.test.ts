import type { AccountConfig } from '@ecommerce/shared'
import { describe, expect, it } from 'vitest'
import type { TmallDailySnapshot } from '../../browser/browser-profile-manager.js'
import { normalizeTmallDaily } from './tmall-daily-normalizer.js'

const account: AccountConfig = {
  schema_version: '1.0.0', account_id: 'acc_money_test', platform: 'tmall', shop_id: 'shop_money_test',
  shop_name: '金额测试店', subaccount_name: '测试子账号', owner: '测试负责人', session_partition: 'persist:money-test',
  credential_ref: null, login_url: 'https://myseller.taobao.com/home.htm', allowed_hosts: ['taobao.com', 'tmall.com'],
  enabled: true, login_status: 'authenticated', last_login_checked_at: null,
  created_at: '2026-08-28T00:00:00.000Z', updated_at: '2026-08-28T00:00:00.000Z'
}

describe('normalizeTmallDaily money units', () => {
  it('converts the trade endpoint payAmt from fen while preserving yuan-valued endpoints', () => {
    const snapshot: TmallDailySnapshot = {
      bizDate: '2026-08-27',
      capturedAt: '2026-08-28T00:49:13.000Z',
      pages: [
        {
          key: 'store', sourcePage: '首页', sourceUrl: 'https://sycm.taobao.com/portal/home.htm', endpoints: {
            '/portal/live/new/index/overview/v3.json': { ok: true, body: { content: { data: { data: { yestday: { payAmt: { value: 32.5 }, uv: { value: 5 }, rfdSucAmt: { value: 7.25 }, payAmtRfdRate: { value: 0.2231 } } } } } } }
          }
        },
        {
          key: 'trade', sourcePage: '交易', sourceUrl: 'https://sycm.taobao.com/ipoll/index.htm', endpoints: {
            '/ipoll/live/yesterday/getYesterdayTrade.json': { ok: true, body: { data: { data: { payAmt: 3250, payOrdCnt: 1, payByrCnt: 1 } } } }
          }
        },
        {
          key: 'flow', sourcePage: '流量', sourceUrl: 'https://sycm.taobao.com/flow/monitor/overview', endpoints: {
            '/flow/new/guide/trend/overview.json': { ok: true, body: { data: { payAmt: { value: 32.5 }, uv: { value: 5 } } } }
          }
        }
      ]
    }

    const normalized = normalizeTmallDaily(snapshot, account)
    const storeRow = normalized.datasets.find((dataset) => dataset.dataset === 'store_daily')?.rows[0]

    expect(storeRow?.['pay_amt']).toBe(32.5)
    expect(normalized.report.summary['pay_amt']).toBe(32.5)
    expect(normalized.report.summary['customer_unit_price']).toBe(32.5)
    expect(normalized.report.summary['refund_amt']).toBe(7.25)
    expect(normalized.report.summary['refund_rate']).toBe(0.2231)
    expect(normalized.report.trend[0]?.['pay_amt']).toBe(32.5)
    expect(normalized.datasets.find((dataset) => dataset.dataset === 'refund_summary_daily')?.rows[0]).toMatchObject({ success_refund_amt: 7.25 })
    expect(normalized.datasets).toHaveLength(7)
  })

  it('uses exact-date today metrics and never leaks the yesterday trade amount into today', () => {
    const snapshot: TmallDailySnapshot = {
      bizDate: '2026-08-28',
      capturedAt: '2026-08-28T01:00:00.000Z',
      pages: [
        {
          key: 'store', sourcePage: '首页', sourceUrl: 'https://sycm.taobao.com/portal/home.htm', endpoints: {
            '/portal/live/new/index/overview/v3.json': { ok: true, body: { content: { data: { data: {
              today: { payAmt: { value: 12.34 }, uv: { value: 3 }, payByrCnt: { value: 1 }, rfdSucAmt: { value: 1.23 } },
              yestday: { payAmt: { value: 32.5 }, uv: { value: 5 } }
            } } } } }
          }
        },
        {
          key: 'trade', sourcePage: '交易', sourceUrl: 'https://sycm.taobao.com/ipoll/index.htm', endpoints: {
            '/ipoll/live/yesterday/getYesterdayTrade.json': { ok: true, body: { data: { data: { payAmt: 3250 } } } }
          }
        },
        {
          key: 'flow', sourcePage: '流量', sourceUrl: 'https://sycm.taobao.com/flow/monitor/overview', endpoints: {
            '/flow/new/guide/trend/overview.json': { ok: true, body: { data: { payAmt: { value: 12.34 }, uv: { value: 3 }, payByrCnt: { value: 1 } } } }
          }
        }
      ]
    }

    const normalized = normalizeTmallDaily(snapshot, account)

    expect(normalized.report.summary['pay_amt']).toBe(12.34)
    expect(normalized.report.summary['refund_amt']).toBe(1.23)
    expect(normalized.report.summary['visitor_count']).toBe(3)
  })

  it('keeps non-zero realtime homepage metrics when delayed today flow endpoints return zero', () => {
    const snapshot: TmallDailySnapshot = {
      bizDate: '2026-08-28', capturedAt: '2026-08-28T05:32:31.000Z', pages: [
        { key: 'store', sourcePage: '首页', sourceUrl: 'https://sycm.taobao.com/portal/home.htm', endpoints: {
          '/portal/live/new/index/overview/v3.json': { ok: true, body: { content: { code: 0, data: { data: { today: {
            payAmt: { value: 52.7 }, uv: { value: 58 }, pv: { value: 164 }, payByrCnt: { value: 2 }, payOrdCnt: { value: 2 }, payRate: { value: 2 / 58 }
          } } } } } }
        } },
        { key: 'flow', sourcePage: '流量', sourceUrl: 'https://sycm.taobao.com/flow/monitor/overview', endpoints: {
          '/flow/new/guide/trend/overview.json': { ok: true, body: { code: 0, data: {
            payAmt: { value: 0 }, uv: { value: 0 }, pv: { value: 0 }, payByrCnt: { value: 0 }, payRate: { value: 0 }
          } } },
          '/flow/v3/overview/shopFlowSourceTop/v4.json': { ok: true, body: { code: 1009, message: '数据马不停蹄产出中，请稍候再试哦～' } }
        } }
      ]
    }

    const normalized = normalizeTmallDaily(snapshot, account)

    expect(normalized.report.summary).toMatchObject({ pay_amt: 52.7, visitor_count: 58, page_view_count: 164, pay_buyer_count: 2, pay_order_count: 2 })
    expect(normalized.report.quality.warnings).toContainEqual(expect.stringContaining('流量接口'))
    expect(normalized.report.quality.warnings).toContainEqual(expect.stringContaining('首页实时数据'))
  })

  it('uses the requested historical-date endpoints instead of current or yesterday summaries', () => {
    const snapshot: TmallDailySnapshot = {
      bizDate: '2026-08-20', capturedAt: '2026-08-28T01:00:00.000Z', pages: [
        { key: 'store', sourcePage: '首页', sourceUrl: 'https://sycm.taobao.com/portal/home.htm', endpoints: {
          '/portal/live/new/index/overview/v3.json': { ok: true, body: { content: { data: { data: { today: { payAmt: { value: 100 } }, yestday: { payAmt: { value: 32.5 } } } } } } }
        } },
        { key: 'trade', sourcePage: '交易', sourceUrl: 'https://sycm.taobao.com/ipoll/index.htm', endpoints: {
          '/ipoll/live/yesterday/getYesterdayTrade.json': { ok: true, body: { data: { data: { payAmt: 3250 } } } }
        } },
        { key: 'flow', sourcePage: '流量', sourceUrl: 'https://sycm.taobao.com/flow/monitor/overview', endpoints: {
          '/flow/new/guide/trend/overview.json': { ok: true, body: { data: { payAmt: { value: 18.25 }, uv: { value: 4 }, payByrCnt: { value: 1 } } } }
        } },
        { key: 'item', sourcePage: '商品', sourceUrl: 'https://sycm.taobao.com/cc/item_rank', endpoints: {
          '/cc/item/view/top.json': { ok: true, body: { data: { data: [{ itemId: '1', title: '历史商品', payAmt: { value: 18.25 }, sucRefundAmt: { value: 2.5 } }] } } }
        } }
      ]
    }

    const normalized = normalizeTmallDaily(snapshot, account)

    expect(normalized.report.summary['pay_amt']).toBe(18.25)
    expect(normalized.report.summary['refund_amt']).toBe(2.5)
  })

  it('preserves missing refund totals as unknown instead of inferring zero from a Top item list', () => {
    const snapshot: TmallDailySnapshot = {
      bizDate: '2026-08-27', capturedAt: '2026-08-28T00:49:13.000Z', pages: [
        { key: 'store', sourcePage: '首页', sourceUrl: 'https://sycm.taobao.com/portal/home.htm', endpoints: {
          '/portal/live/new/index/overview/v3.json': { ok: true, body: { content: { data: { data: { yestday: {
            payAmt: { value: 32.5 }, payByrCnt: { value: 1 }, uv: { value: 5 }, rfdSucAmt: {}, portalShopSucRfdAmt: {}, payAmtRfdRate: {}
          } } } } } }
        } },
        { key: 'item', sourcePage: '商品', sourceUrl: 'https://sycm.taobao.com/cc/item_rank', endpoints: {
          '/cc/item/view/top.json': { ok: true, body: { data: { data: [{ itemId: '1', title: 'Top 商品', sucRefundAmt: { value: 0 } }] } } }
        } }
      ]
    }

    const normalized = normalizeTmallDaily(snapshot, account)

    expect(normalized.report.summary['refund_amt']).toBeNull()
    expect(normalized.report.summary['refund_rate']).toBeNull()
    expect(normalized.datasets.find((dataset) => dataset.dataset === 'refund_summary_daily')?.rows[0]).toMatchObject({ success_refund_amt: null, refund_rate: null })
    expect(normalized.report.quality.warnings).toContainEqual(expect.stringContaining('不能证明全店退款为 0'))
  })

  it('reports the dashboard investment ratio as total payment divided by ad spend', () => {
    const snapshot: TmallDailySnapshot = {
      bizDate: '2026-08-27', capturedAt: '2026-08-28T00:49:13.000Z', pages: [
        { key: 'store', sourcePage: '首页', sourceUrl: 'https://sycm.taobao.com/portal/home.htm', endpoints: {
          '/portal/live/new/index/overview/v3.json': { ok: true, body: { content: { data: { data: { yestday: { payAmt: { value: 32.5 }, payByrCnt: { value: 1 }, uv: { value: 5 } } } } } } },
          '/portal/board/grow/factor/overview.json': { ok: true, body: { content: { data: { self: {
            totalPromoSpend: { value: 2.24 }, portalAdPayAmt: { value: 0 }, tROI: { value: 0 }
          } } } } }
        } }
      ]
    }

    const normalized = normalizeTmallDaily(snapshot, account)

    expect(normalized.report.summary['ad_roi']).toBeCloseTo(32.5 / 2.24, 8)
    expect(normalized.report.summary['platform_ad_roi']).toBe(0)
  })
})
