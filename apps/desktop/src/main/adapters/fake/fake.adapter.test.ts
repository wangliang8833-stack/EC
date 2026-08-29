import { describe, expect, it } from 'vitest'
import type { AccountConfig, AccountContext } from '@ecommerce/shared'
import { FakePlatformAdapter } from './fake.adapter.js'

function context(): AccountContext {
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
  return { account, run_id: 'run_fixture_001', data_root: 'unused-in-fixture' }
}

describe('FakePlatformAdapter', () => {
  it('creates deterministic schema-shaped raw data', async () => {
    const adapter = new FakePlatformAdapter()
    const accountContext = context()
    await adapter.navigate(accountContext, { data_type: 'shop_daily_overview', page_key: 'overview' })
    await adapter.setDateRange(accountContext, { start: '2026-08-26', end: '2026-08-26' })
    const result = await adapter.collect(accountContext, { data_type: 'shop_daily_overview', page_key: 'overview' })

    expect(result.collection_method).toBe('fixture')
    expect(result.data_date).toBe('2026-08-26')
    expect(result.payload.paid_amount_cent).toBe(123_456)
    await expect(adapter.validate(result)).resolves.toMatchObject({ valid: true })
  })

  it('requires the date step before collection', async () => {
    const adapter = new FakePlatformAdapter()
    await expect(
      adapter.collect(context(), { data_type: 'shop_daily_overview', page_key: 'overview' })
    ).rejects.toThrow('Date range must be configured')
  })
})

