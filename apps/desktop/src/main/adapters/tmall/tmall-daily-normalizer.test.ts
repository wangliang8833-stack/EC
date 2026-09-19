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
  function sample(home: Record<string, unknown>, items: Array<Record<string, unknown>> = [], serviceRows: Array<Record<string, unknown>> = []): TmallDailySnapshot {
    return {
      bizDate: '2026-08-27', capturedAt: '2026-08-28T01:00:00.000Z', pages: [
        { key: 'store', sourcePage: '首页', sourceUrl: 'https://sycm.taobao.com/portal/home.htm', endpoints: {
          '/portal/live/new/index/overview/v3.json': { ok: true, body: { data: { yestday: home } } }
        } },
        { key: 'item', sourcePage: '商品', sourceUrl: 'https://sycm.taobao.com/cc/item_rank', endpoints: {
          '/cc/item/view/top.json': { ok: true, body: { data: items } }
        } },
        { key: 'service', sourcePage: '客服', sourceUrl: 'https://sycm.taobao.com/qos/service/core_monitor/new', endpoints: {
          '/csp/api/core/monitor/overview/list': { ok: true, body: { data: [{ name: '咨询人数', value: 2 }] } },
          '/csp/api/core/monitor/list': { ok: true, body: { data: serviceRows } }
        } }
      ]
    }
  }

  it('keeps unavailable facts and derived rates null instead of generating zero business', () => {
    const { report } = normalizeTmallDaily(sample({ uv: 100, payAmt: ' ' }), account)
    expect(report.summary).toMatchObject({ pay_amt: null, pay_order_count: null, pay_buyer_count: null, ad_spend: null, ad_pay_amt: null, pay_rate: null, customer_unit_price: null, ad_roi: null })
    expect(report.trend[0]).toMatchObject({ pay_amt: null, ad_spend: null, pay_order_count: null })
  })

  it('distinguishes zero denominators from a real zero conversion', () => {
    const empty = normalizeTmallDaily(sample({ payAmt: 0, payByrCnt: 0, uv: 0 }), account).report
    const visitors = normalizeTmallDaily(sample({ payAmt: 0, payByrCnt: 0, uv: 10 }), account).report
    expect(empty.summary).toMatchObject({ pay_amt: 0, pay_rate: null, customer_unit_price: null })
    expect(visitors.summary).toMatchObject({ pay_rate: 0, customer_unit_price: null })
  })

  it('keeps Top amounts as separate lower bounds without claiming full store coverage', () => {
    const { report } = normalizeTmallDaily(sample({ uv: 10 }, [{ itemId: 'top', payAmt: 100, sucRefundAmt: 20 }]), account)
    expect(report.summary).toMatchObject({ pay_amt: null, refund_amt: null, pay_amt_lower_bound: 100, refund_amt_lower_bound: 20, daily_refund_pay_ratio: null })
    expect(report.quality.warnings).toContainEqual(expect.stringContaining('下限'))
  })

  it('separates platform refund rates from same-day refund payment ratios and parses percent units', () => {
    const { report } = normalizeTmallDaily(sample({ payAmt: 100, payByrCnt: 1, uv: 10, payRate: '0.5%', rfdSucAmt: 150, payAmtRfdRate: '10%' }), account)
    expect(report.summary).toMatchObject({ pay_rate: 0.005, platform_refund_rate: 0.1, refund_rate: null, daily_refund_pay_ratio: 1.5 })
  })

  it('turns dated service fields into named metric rows and retains unknown field identity', () => {
    const { report } = normalizeTmallDaily(sample({ payAmt: 100 }, [], [
      { date: '20260827', serviceAccount: '客服甲', receptionCnt: 3, mysteryMetric: 4 },
      { date: '20260826', receptionCnt: 99 }
    ]), account)
    expect(report.sections.service).toEqual([
      expect.objectContaining({ name: '咨询人数', value: 2 }),
      expect.objectContaining({ name: 'receptionCnt（未映射）', value: 3, service_account: '客服甲' }),
      expect.objectContaining({ name: 'mysteryMetric（未映射）', value: 4, service_account: '客服甲' })
    ])
  })

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
    expect(normalized.report.summary['platform_refund_rate']).toBe(0.2231)
    expect(normalized.report.summary['refund_rate']).toBeNull()
    expect(normalized.report.summary['daily_refund_pay_ratio']).toBe(7.25 / 32.5)
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
    expect(normalized.report.summary['refund_amt']).toBeNull()
    expect(normalized.report.summary['refund_amt_lower_bound']).toBe(2.5)
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
