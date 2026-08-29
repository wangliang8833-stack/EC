import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AccountConfig, AccountContext } from '@ecommerce/shared'
import { FakePlatformAdapter } from '../adapters/fake/fake.adapter.js'
import { JsonStorageService } from '../storage/json-storage-service.js'
import { StepRunner } from './step-runner.js'

const roots: string[] = []

function fixtureContext(root: string): AccountContext {
  const account: AccountConfig = {
    schema_version: '1.0.0',
    account_id: 'acc_fixture_001',
    platform: 'fixture',
    shop_id: 'shop_fixture_001',
    shop_name: '假数据店铺',
    subaccount_name: 'fixture-user',
    owner: '测试负责人',
    session_partition: 'persist:account-acc_fixture_001',
    credential_ref: null,
    login_url: 'https://fixture.invalid/',
    allowed_hosts: ['fixture.invalid'],
    enabled: true,
    login_status: 'authenticated',
    last_login_checked_at: '2026-08-27T10:00:00+08:00',
    created_at: '2026-08-27T10:00:00+08:00',
    updated_at: '2026-08-27T10:00:00+08:00'
  }
  return { account, run_id: 'run_fixture_001', data_root: root }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('StepRunner', () => {
  it('executes and persists a complete fake collection workflow', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ecommerce-runner-'))
    roots.push(root)
    const storage = new JsonStorageService(root)
    await storage.initialize()
    const runner = new StepRunner(new FakePlatformAdapter(), storage)
    const target = { data_type: 'shop_daily_overview', page_key: 'overview' }

    const result = await runner.run(fixtureContext(root), [
      { type: 'check_login', timeout_ms: 100 },
      { type: 'navigate', target, timeout_ms: 100 },
      { type: 'set_date', range: { start: '2026-08-26', end: '2026-08-26' }, timeout_ms: 100 },
      { type: 'collect', target, timeout_ms: 100 },
      { type: 'validate', timeout_ms: 100 },
      { type: 'persist_raw', timeout_ms: 100 }
    ])

    expect(result.steps).toHaveLength(6)
    expect(result.steps.every(({ status }) => status === 'SUCCESS')).toBe(true)
    expect(result.persisted.relativePath).toBe(
      'data/raw/fixture/shop_fixture_001/acc_fixture_001/shop_daily_overview/2026/08/26/run_fixture_001.json'
    )
    await expect(storage.readJson(result.persisted.relativePath, 'raw-collection-1.0.0')).resolves.toMatchObject({
      run_id: 'run_fixture_001',
      data_date: '2026-08-26'
    })
  })

  it('stops before navigation when login is not authenticated', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ecommerce-runner-'))
    roots.push(root)
    const storage = new JsonStorageService(root)
    await storage.initialize()
    const context = fixtureContext(root)
    context.account.login_status = 'need_human_login'
    const runner = new StepRunner(new FakePlatformAdapter(), storage)

    await expect(runner.run(context, [{ type: 'check_login', timeout_ms: 100 }])).rejects.toThrow(
      'Account login state is need_human_login'
    )
  })
})

