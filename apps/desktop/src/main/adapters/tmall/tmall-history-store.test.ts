import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { assertHistoryBackfillRequest, historyDates, isBusinessDate, shanghaiBusinessDate } from '@ecommerce/shared'
import { JsonStorageService } from '../../storage/json-storage-service.js'
import { historyAccount, historySnapshot, saveHistoryRaw } from '../../automation/history-test-fixtures.js'
import { normalizeTmallDaily } from './tmall-daily-normalizer.js'
import { filterHistorySnapshot, TmallHistoryStore } from './tmall-history-store.js'
import { validateTmallSnapshot } from './tmall-source-validation.js'

const roots: string[] = []
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function setup() { const root = await mkdtemp(join(tmpdir(), 'history-store-')); roots.push(root); const storage = new JsonStorageService(root); await storage.initialize(); return { root, storage, store: new TmallHistoryStore(storage) } }
const account = historyAccount()
const request = { platforms: ['tmall'], shopIds: ['TEST_SHOP_5'], dateStart: '2026-08-20', dateEnd: '2026-09-18', mode: 'missing_only', concurrency: 2 }

describe('historical boundaries and sources', () => {
  it('accepts exactly 30 completed Shanghai days and validates actual calendar dates', () => {
    expect(shanghaiBusinessDate(new Date('2026-09-18T16:00:00Z'))).toBe('2026-09-19')
    expect(historyDates('2026-08-20', '2026-09-18')).toHaveLength(30)
    expect(isBusinessDate('2024-02-29')).toBe(true)
    expect(isBusinessDate('2026-02-29')).toBe(false)
    expect(() => assertHistoryBackfillRequest(request, '2026-09-19')).not.toThrow()
    for (const patch of [{ dateStart: '2026-08-19' }, { dateEnd: '2026-09-19' }, { dateStart: '2026-09-20' }, { dateStart: '2026-02-30' }, { shopIds: ['TEST_SHOP_5', 'TEST_SHOP_5'] }, { shopIds: ['../../secret'] }, { platforms: ['pinduoduo'] }, { concurrency: NaN }, { concurrency: 10 }, { extra: true }]) {
      expect(() => assertHistoryBackfillRequest({ ...request, ...patch }, '2026-09-19')).toThrow()
    }
  })
  it('rejects an old target when only yesterday sources succeeded', () => {
    const snapshot = historySnapshot()
    snapshot.pages.find(page => page.key === 'flow')!.endpoints = {}
    snapshot.pages.find(page => page.key === 'trade')!.endpoints = { '/ipoll/live/yesterday/getYesterdayTrade.json': { ok: true, body: { data: { payAmt: 1000 } } } }
    expect(validateTmallSnapshot(snapshot).status).toBe('failed')
  })
  it('rejects empty successful core responses and mismatched request or response dates', () => {
    for (const change of [{ requestDate: '2026-09-18' }, { body: { code: 0, data: {} } }, { body: { code: 0, data: { payAmt: 12, statDate: '20260918' } } }]) {
      const snapshot = historySnapshot()
      const endpoints = snapshot.pages.find(page => page.key === 'flow')!.endpoints
      endpoints['/flow/new/guide/trend/overview.json'] = { ...(endpoints['/flow/new/guide/trend/overview.json'] as object), ...change }
      expect(validateTmallSnapshot(snapshot, true).status).toBe('failed')
    }
  })
  it('does not normalize a wrong-date optional module and accepts legitimate zeros', () => {
    const snapshot = historySnapshot('2026-09-12', 0)
    const item = snapshot.pages.find(page => page.key === 'item')!.endpoints['/cc/item/view/top.json'] as Record<string, unknown>
    item['requestDate'] = '2026-09-18'
    const result = normalizeTmallDaily(filterHistorySnapshot(snapshot), account)
    expect(result.report.summary['pay_amt']).toBe(0)
    expect(result.report.shop_rows).toHaveLength(0)
    expect(validateTmallSnapshot(snapshot, true).status).toBe('partial')
  })
})

describe('history storage and atomic publication', () => {
  it('previews orphan Raw without writes and rebuilds locally with explicit field coverage', async () => {
    const { storage, store } = await setup()
    await saveHistoryRaw(storage, account, historySnapshot())
    const spy = vi.spyOn(storage, 'writeJson')
    const before = await store.inspect(account, '2026-09-12')
    expect(before.state).toBe('rebuildable')
    expect(spy).not.toHaveBeenCalled()
    await store.rebuild(account, '2026-09-12')
    const after = await store.inspect(account, '2026-09-12')
    expect(after.state).toBe('ready')
    expect(after.coverage.find(field => field.key === 'refund_amt')).toMatchObject({ status: 'unsupported', retryable: false })
    expect(after.coverage.find(field => field.key === 'item_daily')).toMatchObject({ status: 'partial', retryable: false })
    expect(after.coverage.find(field => field.key === 'service_daily')?.status).toBe('available')
  })
  it('keeps valid data after changing the preferred subaccount and repairs missing derived files', async () => {
    const { storage, store, root } = await setup()
    await saveHistoryRaw(storage, account, historySnapshot())
    await store.rebuild(account, '2026-09-12')
    const other = { ...account, account_id: 'acc_other' }
    expect((await store.inspect(other, '2026-09-12')).state).toBe('ready')
    const report = await storage.readJson<{ source_paths: string[] }>('data/report-datasets/tmall/TEST_SHOP_5/2026-09-12.json')
    await rm(join(root, report.source_paths.find(path => path.includes('/normalized/'))!))
    expect((await store.inspect(other, '2026-09-12')).state).toBe('rebuildable')
  })
  it('refuses to combine Raw from different attempts', async () => {
    const { storage, store } = await setup()
    const first = await saveHistoryRaw(storage, account, historySnapshot(), 'run_one')
    const second = await saveHistoryRaw(storage, account, historySnapshot(), 'run_two')
    expect(await store.loadSnapshot([first[0]!, ...second.slice(1)], account, '2026-09-12')).toBeNull()
  })
  it('preserves the old report and its immutable artifacts if final publication fails', async () => {
    const { storage, store, root } = await setup()
    const snapshot = historySnapshot()
    const paths = await saveHistoryRaw(storage, account, snapshot)
    await store.commit(account, normalizeTmallDaily(snapshot, account), paths, 'run_old', undefined, true)
    const reportPath = 'data/report-datasets/tmall/TEST_SHOP_5/2026-09-12.json'
    const old = await readFile(join(root, reportPath), 'utf8')
    const normalizedPath = JSON.parse(old).source_paths.find((path: string) => path.includes('/normalized/'))
    const oldArtifact = await readFile(join(root, normalizedPath), 'utf8')
    const write = storage.writeJson.bind(storage)
    vi.spyOn(storage, 'writeJson').mockImplementation(async (path, value, schema) => { if (path === reportPath) throw new Error('disk failure'); return write(path, value, schema) })
    await expect(store.commit(account, normalizeTmallDaily(historySnapshot('2026-09-12', 99), account), paths, 'run_new', undefined, true)).rejects.toThrow('disk failure')
    expect(await readFile(join(root, reportPath), 'utf8')).toBe(old)
    expect(await readFile(join(root, normalizedPath), 'utf8')).toBe(oldArtifact)
  })
  it('prevents a late commit after cancellation and prevents loss of existing metrics', async () => {
    const { storage, store } = await setup()
    const snapshot = historySnapshot(), paths = await saveHistoryRaw(storage, account, snapshot)
    await store.commit(account, normalizeTmallDaily(snapshot, account), paths, 'run_old', undefined, true)
    const degraded = normalizeTmallDaily(snapshot, account); degraded.report.summary['visitor_count'] = null
    await expect(store.commit(account, degraded, paths, 'run_bad', undefined, true)).rejects.toThrow('缺失')
    const controller = new AbortController()
    const write = storage.writeJson.bind(storage)
    vi.spyOn(storage, 'writeJson').mockImplementation(async (path, value, schema) => { const result = await write(path, value, schema); if (path.includes('/aggregate/')) controller.abort(); return result })
    await expect(store.commit(account, normalizeTmallDaily(snapshot, account), paths, 'run_cancel', controller.signal, true)).rejects.toThrow('取消')
    expect((await storage.readJson<{ meta: { collection_run_id: string } }>('data/report-datasets/tmall/TEST_SHOP_5/2026-09-12.json')).meta.collection_run_id).toBe('run_old')
  })

  it('checks cancellation inside final publication, after writeJson has started', async () => {
    const { storage, store } = await setup()
    const snapshot = historySnapshot(), paths = await saveHistoryRaw(storage, account, snapshot)
    await store.commit(account, normalizeTmallDaily(snapshot, account), paths, 'run_old', undefined, true)
    const controller = new AbortController(), write = storage.writeJson.bind(storage)
    vi.spyOn(storage, 'writeJson').mockImplementation(async (path, value, schema, guard) => {
      if (path.includes('/report-datasets/')) controller.abort()
      return write(path, value, schema, guard)
    })
    await expect(store.commit(account, normalizeTmallDaily(snapshot, account), paths, 'run_cancel_late', controller.signal, true)).rejects.toThrow('取消')
    expect((await storage.readJson<{ meta: { collection_run_id: string } }>('data/report-datasets/tmall/TEST_SHOP_5/2026-09-12.json')).meta.collection_run_id).toBe('run_old')
  })

  it('preserves 403 permission failures and makes transient advertising gaps retryable', async () => {
    const { storage, store } = await setup()
    const snapshot = historySnapshot()
    snapshot.pages.find(page => page.key === 'store')!.endpoints['/portal/board/grow/factor/overview.json'] = { ok: false, status: 503 }
    snapshot.pages.find(page => page.key === 'item')!.endpoints['/cc/item/view/top.json'] = { ok: false, status: 403 }
    await saveHistoryRaw(storage, account, snapshot)
    await store.rebuild(account, snapshot.bizDate)
    const inspection = await store.inspect(account, snapshot.bizDate)
    expect(inspection.state).toBe('retryable_partial')
    expect(inspection.coverage.find(field => field.key === 'ad_spend')).toMatchObject({ status: 'missing', retryable: true })
    expect(inspection.coverage.find(field => field.key === 'item_daily')).toMatchObject({ status: 'permission_denied', retryable: false })
  })

  it('protects legacy metrics and previously available modules from a degraded refresh', async () => {
    const { storage, store } = await setup()
    const snapshot = historySnapshot(), paths = await saveHistoryRaw(storage, account, snapshot)
    const old = normalizeTmallDaily(snapshot, account)
    old.report.meta.normalizer_version = 'tmall-0.6.0'
    await store.commit(account, old, paths, 'run_old')
    const next = historySnapshot()
    next.pages.find(page => page.key === 'item')!.endpoints['/cc/item/view/top.json'] = { ok: false, status: 503 }
    const nextPaths = await saveHistoryRaw(storage, account, next, 'run_refresh')
    await expect(store.commit(account, normalizeTmallDaily(next, account), nextPaths, 'run_refresh', undefined, true)).rejects.toThrow('缺失已有模块')
    const missingOrder = normalizeTmallDaily(snapshot, account); missingOrder.report.summary['pay_order_count'] = null
    await expect(store.commit(account, missingOrder, paths, 'run_order', undefined, true)).rejects.toThrow('pay_order_count')
  })
})
