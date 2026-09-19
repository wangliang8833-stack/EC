import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CollectionProbeResult, HistoryBackfillJob, HistoryBackfillRequest, HistoryDayInspection } from '@ecommerce/shared'
import { JsonStorageService } from '../storage/json-storage-service.js'
import { CollectionCancelledError, CollectionTimeoutError } from '../adapters/tmall/collection-execution.js'
import { CollectionCoordinator } from './collection-coordinator.js'
import { HistoryBackfillService } from './history-backfill-service.js'
import { historyAccount } from './history-test-fixtures.js'

const roots: string[] = []
const services: HistoryBackfillService[] = []
afterEach(async () => { await Promise.allSettled(services.splice(0).map(service => service.stop())); vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
const missing: HistoryDayInspection = { state: 'missing', coverage: [], reason: '缺失' }
const ready: HistoryDayInspection = { state: 'ready', coverage: [{ key: 'pay_amt', label: '支付', status: 'available', reason: '有效', retryable: false }], reason: '有效' }
const request: HistoryBackfillRequest = { platforms: ['tmall'], shopIds: ['TEST_SHOP_5', 'TEST_SHOP_1'], dateStart: '2026-09-12', dateEnd: '2026-09-13', mode: 'missing_only', concurrency: 2 }
const success: CollectionProbeResult = { runId: 'run_test', accountId: 'acc_TEST_SHOP_5', status: 'SUCCESS', pageUrl: '', pageTitle: '', tableCount: 0, rowCount: 0, relativePath: null, warning: null }
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve } }
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'history-jobs-')); roots.push(root)
  const storage = new JsonStorageService(root); await storage.initialize()
  const accounts = { list: vi.fn(async () => [historyAccount(), historyAccount('TEST_SHOP_1')]), updateLoginStatus: vi.fn(async () => historyAccount()) }
  const state = new Map<string, HistoryDayInspection>()
  const data = { inspect: vi.fn(async (account: ReturnType<typeof historyAccount>, date: string) => state.get(`${account.shop_id}/${date}`) ?? missing), rebuild: vi.fn(async () => undefined) }
  const collect = vi.fn(async (account: ReturnType<typeof historyAccount>, options: { bizDate?: string }) => { state.set(`${account.shop_id}/${options.bizDate}`, ready); return success })
  const changed = vi.fn()
  const coordinator = new CollectionCoordinator()
  const service = new HistoryBackfillService(storage, accounts, data, coordinator, collect, changed, () => new Date('2026-09-19T01:00:00Z'), [0, 0]); services.push(service)
  await service.start()
  return { root, storage, accounts, data, state, collect, service, changed, coordinator }
}

describe('persistent history backfill', () => {
  it('collects exactly selected store-days and second execution skips valid data', async () => {
    const { service, collect } = await setup()
    const job = await service.create(request)
    await service.waitForIdle()
    expect(collect).toHaveBeenCalledTimes(4)
    expect(service.list().find(value => value.jobId === job.jobId)?.items.every(item => item.status === 'succeeded')).toBe(true)
    await service.create(request); await service.waitForIdle()
    expect(collect).toHaveBeenCalledTimes(4)
    expect(service.list().some(value => value.items.every(item => item.status === 'skipped'))).toBe(true)
  })
  it('rejects unsupported, disabled and duplicate input rather than succeeding with zero items', async () => {
    const { service } = await setup()
    await expect(service.preview({ ...request, shopIds: ['missing'] })).rejects.toThrow('未启用')
    await expect(service.preview({ ...request, platforms: ['pinduoduo'] })).rejects.toThrow('仅支持天猫')
    await expect(service.preview({ ...request, shopIds: ['TEST_SHOP_5', 'TEST_SHOP_5'] })).rejects.toThrow('不重复')
  })
  it('serializes each store while allowing independent stores concurrently and limits active jobs', async () => {
    const { service, collect, state } = await setup()
    const gate = deferred(), entered = deferred(), busy = new Set<string>()
    let maximum = 0
    collect.mockImplementation(async (account, options) => {
      expect(busy.has(account.shop_id)).toBe(false)
      busy.add(account.shop_id); maximum = Math.max(maximum, busy.size)
      if (busy.size === 2) entered.resolve()
      await gate.promise
      busy.delete(account.shop_id); state.set(`${account.shop_id}/${options.bizDate}`, ready); return success
    })
    await service.create(request); await entered.promise
    await expect(service.create(request)).rejects.toThrow('已有历史')
    gate.resolve(); await service.waitForIdle()
    expect(maximum).toBe(2)
  })
  it('pauses after active units and resumes only pending dates', async () => {
    const { service, collect, state } = await setup()
    const gate = deferred(), entered = deferred()
    collect.mockImplementation(async (account, options) => { entered.resolve(); await gate.promise; state.set(`${account.shop_id}/${options.bizDate}`, ready); return success })
    const job = await service.create({ ...request, shopIds: ['TEST_SHOP_5'], concurrency: 1 })
    await entered.promise; await service.pause(job.jobId); gate.resolve(); await service.waitForIdle()
    expect(service.list()[0]?.status).toBe('paused')
    expect(collect).toHaveBeenCalledTimes(1)
    await service.resume(job.jobId); await service.waitForIdle()
    expect(collect).toHaveBeenCalledTimes(2)
  })
  it('isolates a login failure to its own store and resumes after login', async () => {
    const { service, collect, state, accounts } = await setup()
    let loggedIn = false
    collect.mockImplementation(async (account, options) => {
      if (account.shop_id === 'TEST_SHOP_5' && !loggedIn) return { ...success, status: 'NEED_HUMAN_LOGIN' }
      state.set(`${account.shop_id}/${options.bizDate}`, ready); return success
    })
    const job = await service.create(request); await service.waitForIdle()
    expect(accounts.updateLoginStatus).toHaveBeenCalledTimes(1)
    expect(service.list()[0]?.items.filter(item => item.status === 'need_login')).toHaveLength(2)
    expect(collect).toHaveBeenCalledTimes(3)
    loggedIn = true; await service.resume(job.jobId); await service.waitForIdle()
    expect(collect).toHaveBeenCalledTimes(5)
  })
  it('retries transient failures at most three times and persists the attempt history', async () => {
    const { service, collect, storage } = await setup()
    collect.mockImplementation(async () => { throw new CollectionTimeoutError('capture', 1) })
    const job = await service.create({ ...request, shopIds: ['TEST_SHOP_5'], dateEnd: request.dateStart }); await service.waitForIdle()
    expect(collect).toHaveBeenCalledTimes(3)
    const saved = await storage.readJson<HistoryBackfillJob>(`data/backfill-jobs/${job.jobId}.json`)
    expect(saved.items[0]).toMatchObject({ attempts: 3, status: 'failed' })
    expect(saved.items[0]?.runIds).toHaveLength(3)
  })
  it('cancels running and queued dates without starting more requests', async () => {
    const { service, collect } = await setup()
    const entered = deferred()
    collect.mockImplementation(async (_account, options) => {
      entered.resolve()
      const signal = (options as { signal?: AbortSignal }).signal!
      await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new CollectionCancelledError('collection')), { once: true }))
      return success
    })
    const job = await service.create({ ...request, shopIds: ['TEST_SHOP_5'], concurrency: 1 })
    await entered.promise; await service.cancel(job.jobId); await service.waitForIdle()
    expect(collect).toHaveBeenCalledTimes(1)
    expect(service.list()[0]?.status).toBe('cancelled')
    expect(service.list()[0]?.items.every(item => item.status === 'cancelled')).toBe(true)
  })
  it('restores interrupted tasks paused and recognizes data committed before the crash', async () => {
    const { service, collect, storage, data, accounts, coordinator } = await setup()
    const job = await service.create({ ...request, shopIds: ['TEST_SHOP_5'], dateEnd: request.dateStart }); await service.waitForIdle()
    const path = `data/backfill-jobs/${job.jobId}.json`
    const saved = await storage.readJson<HistoryBackfillJob>(path)
    saved.status = 'running'; saved.items[0]!.status = 'running'; await storage.writeJson(path, saved)
    const restored = new HistoryBackfillService(storage, accounts, data, coordinator, collect, () => undefined, () => new Date('2026-09-19T01:00:00Z'), [0, 0]); services.push(restored)
    await restored.start()
    expect(restored.list()[0]?.status).toBe('paused')
    await restored.resume(job.jobId); await restored.waitForIdle()
    expect(collect).toHaveBeenCalledTimes(1)
    expect(restored.list()[0]?.items[0]?.status).toBe('skipped')
  })
  it('does not request a disabled account after preview or consume unsupported fields endlessly', async () => {
    const { service, data, accounts, collect } = await setup()
    data.inspect.mockResolvedValue({ ...ready, coverage: [{ key: 'refund_amt', label: '退款', status: 'unsupported', reason: '无来源', retryable: false }] })
    await service.create(request); await service.waitForIdle()
    expect(collect).not.toHaveBeenCalled()
    expect(service.list()[0]?.status).toBe('completed_with_gaps')
    data.inspect.mockImplementation(async () => { accounts.list.mockResolvedValue([]); return missing })
    await service.create({ ...request, shopIds: ['TEST_SHOP_5'], dateEnd: request.dateStart }); await service.waitForIdle()
    expect(collect).not.toHaveBeenCalled()
    expect(service.list().some(job => job.items.some(item => item.errorCode === 'ACCOUNT_UNAVAILABLE'))).toBe(true)
  })

  it('does not mistake an older completed report for an interrupted forced refresh', async () => {
    const { service, collect, storage, data, accounts, coordinator } = await setup()
    data.inspect.mockResolvedValue({ ...ready, committedRunId: 'run_older' })
    const job = await service.create({ ...request, shopIds: ['TEST_SHOP_5'], dateEnd: request.dateStart }); await service.waitForIdle()
    const path = `data/backfill-jobs/${job.jobId}.json`
    const saved = await storage.readJson<HistoryBackfillJob>(path)
    saved.request.mode = 'refresh_selected'; saved.status = 'running'; saved.items[0]!.status = 'running'; saved.items[0]!.attempts = 1; saved.items[0]!.runId = 'run_interrupted'; saved.items[0]!.runIds = ['run_interrupted']
    await storage.writeJson(path, saved)
    const restored = new HistoryBackfillService(storage, accounts, data, coordinator, collect, () => undefined, () => new Date('2026-09-19T01:00:00Z'), [0, 0]); services.push(restored)
    await restored.start(); await restored.resume(job.jobId); await restored.waitForIdle()
    expect(collect).toHaveBeenCalledTimes(1)
    expect(restored.list()[0]?.items[0]?.status).toBe('succeeded')
  })

  it('rejects corrupt persisted retry timestamps and coverage before executing', async () => {
    const { service, collect, storage, data, accounts, coordinator } = await setup()
    const job = await service.create({ ...request, shopIds: ['TEST_SHOP_5'], dateEnd: request.dateStart }); await service.waitForIdle()
    const path = `data/backfill-jobs/${job.jobId}.json`
    const saved = await storage.readJson<HistoryBackfillJob>(path)
    for (const patch of [{ nextRetryAt: 'bad-date' }, { coverage: [null] }, { runId: '../../bad' }]) {
      const broken = structuredClone(saved); Object.assign(broken.items[0]!, patch); await storage.writeJson(path, broken)
      const restored = new HistoryBackfillService(storage, accounts, data, coordinator, collect, () => undefined)
      await expect(restored.start()).rejects.toThrow('无效')
    }
    expect(collect).toHaveBeenCalledTimes(1)
  })

  it('does not create a task after shutdown starts during preflight', async () => {
    const { service, data, collect } = await setup()
    const gate = deferred(), entered = deferred()
    data.inspect.mockImplementation(async () => { entered.resolve(); await gate.promise; return missing })
    const creating = service.create({ ...request, shopIds: ['TEST_SHOP_5'], dateEnd: request.dateStart })
    const rejected = expect(creating).rejects.toThrow('正在退出')
    await entered.promise
    const stopped = service.stop(); gate.resolve(); await Promise.all([stopped, rejected])
    expect(service.list()).toEqual([])
    expect(collect).not.toHaveBeenCalled()
  })

  it('aborts other running collectors immediately when progress persistence fails', async () => {
    const { service, collect, storage } = await setup()
    const both = deferred(); let entered = 0, aborted = 0
    collect.mockImplementation(async (_account, options) => {
      entered += 1; if (entered === 2) both.resolve()
      const signal = (options as { signal: AbortSignal }).signal
      await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => { aborted += 1; reject(new CollectionCancelledError('collection')) }, { once: true }))
      return success
    })
    const job = await service.create({ ...request, dateEnd: request.dateStart })
    await both.promise
    vi.spyOn(storage, 'writeJson').mockRejectedValue(new Error('disk full'))
    await expect(service.pause(job.jobId)).rejects.toThrow('disk full')
    await service.waitForIdle()
    expect(aborted).toBe(2)
    expect(collect).toHaveBeenCalledTimes(2)
    expect(service.list()[0]?.lastError).toContain('保存失败')
  })
})

describe('shared collection coordinator', () => {
  it('prioritizes daily tasks at the next store boundary and cancels queued work', async () => {
    const coordinator = new CollectionCoordinator(), gate = deferred(), entered = deferred(), order: string[] = []
    const first = coordinator.run(['shop:a'], async () => { entered.resolve(); await gate.promise })
    await entered.promise
    const history = coordinator.run(['shop:a'], async () => { order.push('history') }, undefined, 0)
    const daily = coordinator.run(['shop:a'], async () => { order.push('daily') }, undefined, 1)
    const controller = new AbortController()
    const cancelled = coordinator.run(['shop:a'], async () => { order.push('cancelled') }, controller.signal)
    const rejection = expect(cancelled).rejects.toBeInstanceOf(CollectionCancelledError)
    controller.abort(); gate.resolve()
    await Promise.all([first, history, daily, rejection])
    expect(order).toEqual(['daily', 'history'])
  })
})
