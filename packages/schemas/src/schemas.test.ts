import { describe, expect, it } from 'vitest'
import type { AccountConfig, JobConfig } from '@ecommerce/shared'
import { SchemaRegistry, SchemaValidationError } from './validator.js'

const registry = new SchemaRegistry()

function validAccount(): AccountConfig {
  return {
    schema_version: '1.0.0',
    account_id: 'acc_test_001',
    platform: 'pinduoduo',
    shop_id: 'shop_test_001',
    shop_name: '测试店铺',
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

describe('SchemaRegistry', () => {
  it('accepts a valid account without credentials in JSON', () => {
    const account = validAccount()
    expect(registry.validate<AccountConfig>('account-config-1.0.0', account)).toBe(true)
    expect(JSON.stringify(account)).not.toMatch(/password|cookie|token/i)
  })

  it('accepts observable captcha and login failure states', () => {
    expect(registry.validate<AccountConfig>('account-config-1.0.0', { ...validAccount(), login_status: 'captcha_required' })).toBe(true)
    expect(registry.validate<AccountConfig>('account-config-1.0.0', { ...validAccount(), login_status: 'login_failed' })).toBe(true)
  })

  it('rejects a shared default session', () => {
    const account = { ...validAccount(), session_partition: 'persist:default' }
    expect(registry.validate<AccountConfig>('account-config-1.0.0', account)).toBe(false)
    expect(() => registry.assert<AccountConfig>('account-config-1.0.0', account)).toThrow(SchemaValidationError)
  })

  it('rejects plaintext credential fields', () => {
    const account = { ...validAccount(), password: 'not-allowed' }
    expect(registry.validate<AccountConfig>('account-config-1.0.0', account)).toBe(false)
  })

  it('requires the configured Shanghai timezone for jobs', () => {
    const job: JobConfig = {
      schema_version: '1.0.0',
      job_id: 'job_test_001',
      name: '测试任务',
      platform: 'pinduoduo',
      account_ids: ['acc_test_001'],
      data_type: 'shop_daily_overview',
      schedule: {
        type: 'cron',
        expression: '0 30 9 * * *',
        timezone: 'Asia/Shanghai',
        jitter_seconds: 60
      },
      date_strategy: ['T-1', 'T-2'],
      retry: { max_attempts: 3, backoff_seconds: [60, 300, 900] },
      timeout_seconds: 180,
      enabled: true
    }
    expect(registry.validate<JobConfig>('job-config-1.0.0', job)).toBe(true)
  })
})
