import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AccountConfig } from '@ecommerce/shared'
import { JsonStorageService, UnsafeStoragePathError } from './json-storage-service.js'

const temporaryRoots: string[] = []

async function createService(): Promise<{ root: string; service: JsonStorageService }> {
  const root = await mkdtemp(join(tmpdir(), 'ecommerce-storage-'))
  temporaryRoots.push(root)
  const service = new JsonStorageService(root)
  await service.initialize()
  return { root, service }
}

function account(shopName = '测试店铺'): AccountConfig {
  return {
    schema_version: '1.0.0',
    account_id: 'acc_test_001',
    platform: 'pinduoduo',
    shop_id: 'shop_test_001',
    shop_name: shopName,
    subaccount_name: '测试子账号',
    owner: '测试负责人',
    session_partition: 'persist:account-acc_test_001',
    credential_ref: null,
    login_url: 'https://mms.pinduoduo.com/',
    allowed_hosts: ['mms.pinduoduo.com'],
    enabled: true,
    login_status: 'unknown',
    last_login_checked_at: null,
    created_at: '2026-08-27T10:00:00+08:00',
    updated_at: '2026-08-27T10:00:00+08:00'
  }
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('JsonStorageService', () => {
  it('validates and atomically writes JSON with a hash and audit record', async () => {
    const { root, service } = await createService()
    const result = await service.writeJson('config/accounts/acc_test_001.json', account(), 'account-config-1.0.0')

    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/)
    await expect(service.readJson<AccountConfig>('config/accounts/acc_test_001.json', 'account-config-1.0.0')).resolves.toEqual(account())
    expect(await readFile(join(root, 'logs', 'audit', 'storage.jsonl'), 'utf8')).toContain(result.sha256)
  })

  it('keeps a backup when replacing an index or config file', async () => {
    const { root, service } = await createService()
    await service.writeJson('config/accounts/acc_test_001.json', account('旧名称'), 'account-config-1.0.0')
    await service.writeJson('config/accounts/acc_test_001.json', account('新名称'), 'account-config-1.0.0')

    const backup = JSON.parse(await readFile(join(root, 'config', 'accounts', 'acc_test_001.json.bak'), 'utf8')) as AccountConfig
    expect(backup.shop_name).toBe('旧名称')
  })

  it('rejects paths outside the data root', async () => {
    const { service } = await createService()
    await expect(service.writeJson('../escaped.json', account())).rejects.toBeInstanceOf(UnsafeStoragePathError)
  })

  it('does not replace a valid file with schema-invalid data', async () => {
    const { service } = await createService()
    await service.writeJson('config/accounts/acc_test_001.json', account(), 'account-config-1.0.0')
    const invalid = { ...account(), session_partition: 'persist:default' }

    await expect(service.writeJson('config/accounts/acc_test_001.json', invalid, 'account-config-1.0.0')).rejects.toThrow()
    const saved = await service.readJson<AccountConfig>('config/accounts/acc_test_001.json', 'account-config-1.0.0')
    expect(saved.session_partition).toBe('persist:account-acc_test_001')
  })
})

