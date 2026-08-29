import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AccountConfig, DataUpdateResult } from '@ecommerce/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { JsonStorageService } from '../storage/json-storage-service.js'
import { ScheduledCollectionService } from './scheduled-collection-service.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function account(): AccountConfig {
  return {
    schema_version: '1.0.0', account_id: 'acc_tmall', platform: 'tmall', shop_id: 'shop_tmall', shop_name: '测试店铺',
    subaccount_name: '子账号', owner: '负责人', session_partition: 'persist:account-acc_tmall', credential_ref: null,
    login_url: 'https://myseller.taobao.com/', allowed_hosts: ['taobao.com'], enabled: true, login_status: 'authenticated',
    last_login_checked_at: null, created_at: '2026-08-28T00:00:00.000Z', updated_at: '2026-08-28T00:00:00.000Z'
  }
}

function result(bizDate: string): DataUpdateResult {
  const now = new Date().toISOString()
  return { bizDate, timezone: 'Asia/Shanghai', startedAt: now, completedAt: now, total: 1, updated: 1, skipped: 0, needLogin: 0, failed: 0, shops: [] }
}

describe('ScheduledCollectionService', () => {
  it('persists editable schedules and executes the configured platform scope', async () => {
    const root = await mkdtemp(join(tmpdir(), 'scheduled-jobs-'))
    roots.push(root)
    const storage = new JsonStorageService(root)
    await storage.initialize()
    const updates: Array<{ bizDate: string; concurrency: number | undefined; interval: number | undefined }> = []
    const changed = vi.fn()
    const service = new ScheduledCollectionService(storage, { list: async () => [account()] }, async (request, options) => {
      updates.push({ bizDate: request.bizDate, concurrency: options.concurrency, interval: options.batchIntervalMs })
      return result(request.bizDate)
    }, changed)
    await service.start()

    const created = await service.create({ name: '每日更新', scheduleTime: '08:30', platforms: ['all'], dateStrategy: 'yesterday', concurrency: 3, batchIntervalMinutes: 7, enabled: true })
    expect(created).toMatchObject({ name: '每日更新', status: 'pending', concurrency: 3, batchIntervalMinutes: 7 })
    expect(created.nextRunAt).not.toBeNull()

    await service.run(created.jobId)
    await vi.waitFor(() => expect(service.list()[0]?.status).toBe('completed'))
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ concurrency: 3, interval: 420_000 })
    expect(service.list()[0]?.lastResult?.updated).toBe(1)

    await service.update(created.jobId, { name: '调整后', scheduleTime: '09:10', platforms: ['tmall'], dateStrategy: 'today', concurrency: 2, batchIntervalMinutes: 0, enabled: false })
    expect(service.list()[0]).toMatchObject({ name: '调整后', status: 'disabled', nextRunAt: null })
    service.stop()
    const restored = new ScheduledCollectionService(storage, { list: async () => [account()] }, async (request) => result(request.bizDate), changed)
    await restored.start()
    expect(restored.list()[0]).toMatchObject({ jobId: created.jobId, name: '调整后', status: 'disabled' })
    await restored.delete(created.jobId)
    expect(restored.list()).toEqual([])
    expect(changed).toHaveBeenCalled()
    restored.stop()
  })

  it('rejects invalid scheduling limits', async () => {
    const root = await mkdtemp(join(tmpdir(), 'scheduled-jobs-invalid-'))
    roots.push(root)
    const storage = new JsonStorageService(root)
    await storage.initialize()
    const service = new ScheduledCollectionService(storage, { list: async () => [] }, async (request) => result(request.bizDate), () => undefined)
    await service.start()
    await expect(service.create({ name: '错误任务', scheduleTime: '25:00', platforms: ['all'], dateStrategy: 'yesterday', concurrency: 0, batchIntervalMinutes: -1, enabled: true })).rejects.toThrow()
    service.stop()
  })
})
