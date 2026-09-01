import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AccountConfig, ReportDataset } from '@ecommerce/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserProfileManager, TmallCollectionOptions, TmallDailySnapshot } from '../../browser/browser-profile-manager.js'
import { JsonStorageService } from '../../storage/json-storage-service.js'
import { CollectionTimeoutError } from './collection-execution.js'
import { TMALL_NORMALIZER_VERSION } from './tmall-daily-normalizer.js'
import { shanghaiToday, shanghaiYesterday, TmallProbeService } from './tmall-probe-service.js'

const roots: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const account: AccountConfig = {
  schema_version: '1.0.0',
  account_id: 'acc_tmall_test_001',
  platform: 'tmall',
  shop_id: 'tmall_shop_001',
  shop_name: '测试旗舰店',
  subaccount_name: '数据子账号',
  owner: '测试负责人',
  session_partition: 'persist:account-acc_tmall_test_001',
  credential_ref: null,
  login_url: 'https://myseller.taobao.com/home.htm',
  allowed_hosts: ['taobao.com', 'tmall.com'],
  enabled: true,
  login_status: 'authenticated',
  last_login_checked_at: null,
  created_at: '2026-08-27T08:00:00.000Z',
  updated_at: '2026-08-27T08:00:00.000Z'
}

function validSnapshot(bizDate: string, payAmt = 20, visitors = 2): TmallDailySnapshot {
  return {
    bizDate,
    capturedAt: '2026-09-01T00:30:00.000Z',
    pages: [
      { key: 'store', sourcePage: '首页', sourceUrl: 'https://sycm.taobao.com/portal/home.htm', endpoints: {
        '/portal/live/new/index/overview/v3.json': { ok: true, status: 200, body: { code: 0, data: { yestday: { payAmt, uv: visitors, payByrCnt: payAmt > 0 ? 1 : 0 } } } }
      } },
      { key: 'trade', sourcePage: '交易', sourceUrl: 'https://sycm.taobao.com/ipoll/index.htm', endpoints: {
        '/ipoll/live/yesterday/getYesterdayTrade.json': { ok: true, status: 200, body: { code: 0, data: { payAmt: payAmt * 100, payOrdCnt: payAmt > 0 ? 1 : 0, payByrCnt: payAmt > 0 ? 1 : 0 } } },
        '/ipoll/live/yesterday/getYesterdayFlow.json': { ok: true, status: 200, body: { code: 0, data: { uv: visitors } } }
      } },
      { key: 'flow', sourcePage: '流量', sourceUrl: 'https://sycm.taobao.com/flow/monitor/overview', endpoints: {
        '/flow/new/guide/trend/overview.json': { ok: true, status: 200, body: { code: 0, data: { payAmt, uv: visitors } } }
      } },
      { key: 'item', sourcePage: '商品', sourceUrl: 'https://sycm.taobao.com/cc/item_rank', endpoints: {} },
      { key: 'service', sourcePage: '客服', sourceUrl: 'https://sycm.taobao.com/qos/service/core_monitor/new', endpoints: {
        '/csp/api/core/monitor/overview/list': { ok: true, status: 200, body: { code: 200, data: [] } }
      } }
    ]
  }
}

describe('TmallProbeService', () => {
  it('rejects HTTP-200 login business errors without writing a completed report', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tmall-probe-login-error-'))
    roots.push(root)
    const storage = new JsonStorageService(root)
    await storage.initialize()
    const loginError = { ok: true, status: 200, body: { code: 5810, msg: 'You must login system first.' } }
    const browser = {
      collectTmallDaily: async (_account: AccountConfig, bizDate: string): Promise<TmallDailySnapshot> => ({
        bizDate, capturedAt: '2026-09-01T00:30:00.000Z', pages: [
          { key: 'store', sourcePage: '首页', sourceUrl: 'https://sycm.taobao.com/custom/login.htm', endpoints: { '/portal/live/new/index/overview/v3.json': loginError } },
          { key: 'trade', sourcePage: '交易', sourceUrl: 'https://sycm.taobao.com/custom/login.htm', endpoints: { '/ipoll/live/yesterday/getYesterdayTrade.json': loginError } },
          { key: 'flow', sourcePage: '流量', sourceUrl: 'https://sycm.taobao.com/custom/login.htm', endpoints: { '/flow/new/guide/trend/overview.json': loginError } },
          { key: 'item', sourcePage: '商品', sourceUrl: 'https://sycm.taobao.com/custom/login.htm', endpoints: { '/cc/item/view/top.json': loginError } },
          { key: 'service', sourcePage: '客服', sourceUrl: 'https://sycm.taobao.com/custom/login.htm', endpoints: {} }
        ]
      })
    } as unknown as BrowserProfileManager

    const result = await new TmallProbeService(browser, storage).run(account, { bizDate: '2026-08-31' })

    expect(result.status).toBe('NEED_HUMAN_LOGIN')
    expect(result.warning).toContain('登录')
    await expect(readFile(join(root, 'data', 'report-datasets', 'tmall', account.shop_id, '2026-08-31.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('accepts a business-successful snapshot whose core metrics are legitimately zero', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tmall-probe-zero-'))
    roots.push(root)
    const storage = new JsonStorageService(root)
    await storage.initialize()
    const browser = { collectTmallDaily: async (_account: AccountConfig, bizDate: string) => validSnapshot(bizDate, 0, 0) } as unknown as BrowserProfileManager

    const result = await new TmallProbeService(browser, storage).run(account, { bizDate: '2026-08-31' })
    const report = await storage.readJson<ReportDataset>(result.relativePath!)

    expect(result.status).toBe('SUCCESS')
    expect(report.summary).toMatchObject({ pay_amt: 0, visitor_count: 0, pay_order_count: 0 })
  })

  it('does not skip a historical cache whose Raw sources contain a login error', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tmall-probe-invalid-cache-'))
    roots.push(root)
    const storage = new JsonStorageService(root)
    await storage.initialize()
    let collectionCalls = 0
    const browser = {
      collectTmallDaily: async (_account: AccountConfig, bizDate: string) => {
        collectionCalls += 1
        return validSnapshot(bizDate, collectionCalls === 1 ? 20 : 35, 3)
      }
    } as unknown as BrowserProfileManager
    const service = new TmallProbeService(browser, storage)
    const first = await service.run(account, { bizDate: '2026-08-31' })
    const report = await storage.readJson<ReportDataset>(first.relativePath!)
    for (const path of report.source_paths.filter((value) => value.includes('/raw/'))) {
      const raw = await storage.readJson<Record<string, unknown>>(path)
      const source = raw['source'] as Record<string, unknown>
      source['page_url'] = 'https://sycm.taobao.com/custom/login.htm'
      await storage.writeJson(path, raw)
    }

    const refreshed = await service.run(account, { bizDate: '2026-08-31' })
    const refreshedReport = await storage.readJson<ReportDataset>(refreshed.relativePath!)

    expect(refreshed.status).toBe('SUCCESS')
    expect(collectionCalls).toBe(2)
    expect(refreshedReport.summary['pay_amt']).toBe(35)
  })

  it('refreshes a same-day realtime snapshot after the business date has closed', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-28T05:30:00.000Z'))
    const root = await mkdtemp(join(tmpdir(), 'tmall-probe-finalize-'))
    roots.push(root)
    const storage = new JsonStorageService(root)
    await storage.initialize()
    let collectionCalls = 0
    const browser = {
      collectTmallDaily: async (_account: AccountConfig, bizDate: string) => {
        collectionCalls += 1
        const final = collectionCalls === 2
        return {
          bizDate,
          capturedAt: final ? '2026-08-29T00:40:00.000Z' : '2026-08-28T05:32:31.000Z',
          pages: [
            { key: 'store', sourcePage: '首页', sourceUrl: 'https://sycm.taobao.com/portal/home.htm', endpoints: {
              '/portal/live/new/index/overview/v3.json': { ok: true, body: { data: { data: final
                ? { yestday: { payAmt: { value: 128.1 }, uv: { value: 153 }, payByrCnt: { value: 5 } } }
                : { today: { payAmt: { value: 52.7 }, uv: { value: 58 }, payByrCnt: { value: 2 } } } } } }
            } },
            { key: 'trade', sourcePage: '交易', sourceUrl: 'https://sycm.taobao.com/ipoll/index.htm', endpoints: final ? {
              '/ipoll/live/yesterday/getYesterdayTrade.json': { ok: true, body: { data: { payAmt: 12810, payByrCnt: 5 } } },
              '/ipoll/live/yesterday/getYesterdayFlow.json': { ok: true, body: { data: { uv: 153 } } }
            } : {} },
            { key: 'flow', sourcePage: '流量', sourceUrl: 'https://sycm.taobao.com/flow/monitor/overview', endpoints: {
              '/flow/new/guide/trend/overview.json': { ok: true, body: { data: final ? { payAmt: 128.1, uv: 153 } : { payAmt: 0, uv: 0 } } }
            } },
            { key: 'item', sourcePage: '商品', sourceUrl: 'https://sycm.taobao.com/cc/item_rank', endpoints: {} },
            { key: 'service', sourcePage: '客服', sourceUrl: 'https://sycm.taobao.com/qos/service/core_monitor/new', endpoints: {} }
          ]
        }
      }
    } as unknown as BrowserProfileManager
    const service = new TmallProbeService(browser, storage)

    const realtime = await service.run(account, { bizDate: '2026-08-28' })
    vi.setSystemTime(new Date('2026-08-29T00:40:00.000Z'))
    const finalized = await service.run(account, { bizDate: '2026-08-28' })
    const report = await storage.readJson<ReportDataset>(finalized.relativePath!)

    expect(realtime.status).toBe('SUCCESS')
    expect(finalized.status).toBe('SUCCESS')
    expect(collectionCalls).toBe(2)
    expect(report.meta.data_finality).toBe('final')
    expect(report.summary).toMatchObject({ pay_amt: 128.1, visitor_count: 153, pay_buyer_count: 5, pay_rate: 5 / 153 })
  })

  it('persists sanitized Raw, normalized, aggregate and report datasets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tmall-probe-'))
    roots.push(root)
    const storage = new JsonStorageService(root)
    await storage.initialize()
    let collectionCalls = 0
    const browser = {
      collectTmallDaily: async (_account: AccountConfig, bizDate: string) => { collectionCalls += 1; return ({ bizDate, capturedAt: '2026-08-27T03:00:00.000Z', pages: [
        { key: 'store', sourcePage: '首页', sourceUrl: 'https://sycm.taobao.com/portal/home.htm?token=secret', endpoints: {
          '/portal/live/new/index/overview/v3.json': { ok: true, status: 200, body: { data: { yestday: { payAmt: 20, uv: 2, pv: 6 } } }, token: 'must-not-persist' },
          '/portal/board/grow/factor/overview.json': { ok: true, status: 200, body: { data: { self: { totalPromoSpend: 0.61, clicks: 2, portalAdPayAmt: 0, tROI: 0 } } } }
        } },
        { key: 'trade', sourcePage: '交易', sourceUrl: 'https://sycm.taobao.com/ipoll/index.htm', endpoints: {
          '/ipoll/live/yesterday/getYesterdayTrade.json': { ok: true, status: 200, body: { data: { payAmt: 2000, payOrdCnt: 1, payByrCnt: 1, payItmCnt: 1 } } },
          '/ipoll/live/yesterday/getYesterdayFlow.json': { ok: true, status: 200, body: { data: { uv: 2, pv: 6, itmUv: 2 } } }
        } },
        { key: 'flow', sourcePage: '流量', sourceUrl: 'https://sycm.taobao.com/flow/monitor/overview', endpoints: {
          '/flow/new/guide/trend/overview.json': { ok: true, status: 200, body: { data: { uv: 2, pv: 6, payAmt: 20, payRate: 0.5 } } },
          '/flow/v3/overview/shopFlowSourceTop/v4.json': { ok: true, status: 200, body: { data: { data: [{ sourceName: '搜索', uv: 1, pv: 5, payAmt: 20 }] } } },
          '/flow/new/overview/keywordTop.json': { ok: true, status: 200, body: { data: { data: [{ keyword: '艾草', uv: 1, pv: 5, payAmt: 20 }] } } }
        } },
        { key: 'item', sourcePage: '商品', sourceUrl: 'https://sycm.taobao.com/cc/item_rank', endpoints: {
          '/cc/item/view/top.json': { ok: true, status: 200, body: { data: { data: [{ itemId: '1001', title: '测试商品', payAmt: 20, itmUv: 2, itmPv: 6 }] } } }
        } },
        { key: 'service', sourcePage: '客服', sourceUrl: 'https://sycm.taobao.com/qos/service/core_monitor/new', endpoints: {
          '/csp/api/core/monitor/overview/list': { ok: true, status: 200, body: { data: [{ name: '咨询人数', value: 0 }] } },
          '/csp/api/core/monitor/list': { ok: true, status: 200, body: { data: [{ date: bizDate.replaceAll('-', ''), receptionCnt: 0 }] } }
        } }
      ] }) }
    } as unknown as BrowserProfileManager
    const service = new TmallProbeService(browser, storage)

    const result = await service.run(account)
    expect(result.status).toBe('SUCCESS')
    expect(result.relativePath).toMatch(/^data\/report-datasets\/tmall\//)
    expect(result.datasetCount).toBe(7)
    const report = JSON.parse(await readFile(join(root, result.relativePath!), 'utf8')) as { meta: Record<string, unknown>; summary: Record<string, unknown>; source_paths: string[] }
    expect(report.summary['pay_amt']).toBe(20)
    expect(report.summary['visitor_count']).toBe(2)
    expect(report.meta['normalizer_version']).toBe(TMALL_NORMALIZER_VERSION)
    const raw = JSON.parse(await readFile(join(root, report.source_paths[0]!), 'utf8')) as Record<string, unknown>
    expect(JSON.stringify(raw)).not.toContain('must-not-persist')
    expect(raw['data_type']).toBe('store_daily')

    const repeated = await service.run(account)
    expect(repeated.status).toBe('ALREADY_COLLECTED')
    expect(repeated.bizDate).toBe(result.bizDate)
    expect(repeated.warning).toContain(`目标日期 ${result.bizDate}（Asia/Shanghai）`)
    expect(collectionCalls).toBe(1)

    const todayFirst = await service.run(account, { bizDate: shanghaiToday() })
    const todaySecond = await service.run(account, { bizDate: shanghaiToday() })
    expect(todayFirst.status).toBe('SUCCESS')
    expect(todaySecond.status).toBe('SUCCESS')
    expect(collectionCalls).toBe(3)
  })

  it('repairs a legacy completed report from existing Raw without collecting again', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tmall-probe-repair-'))
    roots.push(root)
    const storage = new JsonStorageService(root)
    await storage.initialize()
    let collectionCalls = 0
    const browser = {
      collectTmallDaily: async (_account: AccountConfig, bizDate: string) => {
        collectionCalls += 1
        return {
          bizDate,
          capturedAt: '2026-08-28T00:49:13.000Z',
          pages: [
            { key: 'store', sourcePage: '首页', sourceUrl: 'https://sycm.taobao.com/portal/home.htm', endpoints: { '/portal/live/new/index/overview/v3.json': { ok: true, body: { content: { data: { data: { yestday: { payAmt: { value: 32.5 }, uv: { value: 5 } } } } } } } } },
            { key: 'trade', sourcePage: '交易', sourceUrl: 'https://sycm.taobao.com/ipoll/index.htm', endpoints: { '/ipoll/live/yesterday/getYesterdayTrade.json': { ok: true, body: { data: { data: { payAmt: 3250, payOrdCnt: 1, payByrCnt: 1 } } } } } },
            { key: 'flow', sourcePage: '流量', sourceUrl: 'https://sycm.taobao.com/flow/monitor/overview', endpoints: { '/flow/new/guide/trend/overview.json': { ok: true, body: { data: { payAmt: 32.5, uv: 5 } } } } },
            { key: 'item', sourcePage: '商品', sourceUrl: 'https://sycm.taobao.com/cc/item_rank', endpoints: {} },
            { key: 'service', sourcePage: '客服', sourceUrl: 'https://sycm.taobao.com/qos/service/core_monitor/new', endpoints: {} }
          ]
        }
      }
    } as unknown as BrowserProfileManager
    const logged: Array<Record<string, unknown>> = []
    const service = new TmallProbeService(browser, storage, {
      info: (fields) => { logged.push(fields) }, warn: () => undefined, error: () => undefined
    })
    const first = await service.run(account)
    const reportPath = first.relativePath!
    const legacy = await storage.readJson<ReportDataset>(reportPath)
    legacy['summary']['pay_amt'] = 3250
    legacy['summary']['customer_unit_price'] = 3250
    delete legacy['meta']['normalizer_version']
    await storage.writeJson(reportPath, legacy)

    const repaired = await service.getCompletedReport(account, first.bizDate!)

    expect(repaired?.summary['pay_amt']).toBe(32.5)
    expect(repaired?.summary['customer_unit_price']).toBe(32.5)
    expect(repaired?.meta.normalizer_version).toBe(TMALL_NORMALIZER_VERSION)
    expect(repaired?.source_paths.filter((path) => path.includes('/raw/'))).toHaveLength(5)
    expect(collectionCalls).toBe(1)
    expect(logged).toContainEqual(expect.objectContaining({ event: 'report_repaired', oldPayAmt: 3250, newPayAmt: 32.5 }))
  })

  it('returns a human-login result without writing fake data', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tmall-probe-'))
    roots.push(root)
    const storage = new JsonStorageService(root)
    await storage.initialize()
    const browser = { collectTmallDaily: async () => null } as unknown as BrowserProfileManager
    const result = await new TmallProbeService(browser, storage).run(account)

    expect(result.status).toBe('NEED_HUMAN_LOGIN')
    expect(result.relativePath).toBeNull()
  })

  it('keeps completed page Raw and a failed run manifest when a later page times out', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tmall-probe-'))
    roots.push(root)
    const storage = new JsonStorageService(root)
    await storage.initialize()
    const logged: Array<{ level: string; fields: Record<string, unknown> }> = []
    const logger = {
      info: (fields: Record<string, unknown>) => { logged.push({ level: 'info', fields }) },
      warn: (fields: Record<string, unknown>) => { logged.push({ level: 'warn', fields }) },
      error: (fields: Record<string, unknown>) => { logged.push({ level: 'error', fields }) }
    }
    const browser = {
      collectTmallDaily: async (_account: AccountConfig, bizDate: string, options: TmallCollectionOptions) => {
        const page = { key: 'store' as const, sourcePage: '首页', sourceUrl: 'https://sycm.taobao.com/portal/home.htm', endpoints: {} }
        await options.onProgress?.('navigating', 'store', 0, 5)
        await options.onProgress?.('capturing', 'store', 0, 5)
        await options.onPageCaptured?.(page, 0, 5, '2026-08-28T00:00:00.000Z')
        throw new CollectionTimeoutError('capture', 45_000, 'trade')
      },
      cancelDailyCollection: () => undefined
    } as unknown as BrowserProfileManager
    const service = new TmallProbeService(browser, storage, logger)

    await expect(service.run(account, { runId: 'run_timeout_test' })).rejects.toBeInstanceOf(CollectionTimeoutError)
    const bizDate = shanghaiYesterday()
    const rawPath = join(root, 'data', 'raw', 'tmall', account.shop_id, account.account_id, 'store', ...bizDate.split('-'), 'run_timeout_test.json')
    const manifestPath = join(root, 'data', 'runs', 'tmall', account.shop_id, account.account_id, bizDate, 'run_timeout_test.json')
    const reportPath = join(root, 'data', 'report-datasets', 'tmall', account.shop_id, `${bizDate}.json`)
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { status: string; progress: Array<{ stage: string; message: string }> }

    expect(JSON.parse(await readFile(rawPath, 'utf8'))).toMatchObject({ data_type: 'store_daily', run_id: 'run_timeout_test' })
    expect(manifest.status).toBe('failed')
    expect(manifest.progress.at(-1)).toMatchObject({ stage: 'failed' })
    expect(manifest.progress.at(-1)?.message).toContain('trade')
    await expect(readFile(reportPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect(logged.some((entry) => entry.level === 'error' && entry.fields['event'] === 'collection_terminal')).toBe(true)
  })

  it('calculates yesterday from the exact Asia/Shanghai calendar boundary', () => {
    expect(shanghaiYesterday(new Date('2026-08-27T15:59:00.000Z'))).toBe('2026-08-26')
    expect(shanghaiYesterday(new Date('2026-08-27T16:01:00.000Z'))).toBe('2026-08-27')
  })
})
