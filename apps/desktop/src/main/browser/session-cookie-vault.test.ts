import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Cookie } from 'electron'
import type { AccountConfig } from '@ecommerce/shared'
import { describe, expect, it, vi } from 'vitest'
import { isAllowedCookieDomain, SessionCookieVault, type SessionCookieEncryption } from './session-cookie-vault.js'

const account: AccountConfig = {
  schema_version: '1.0.0',
  account_id: 'acc_tmall_test_001',
  platform: 'tmall',
  shop_id: 'tmall_shop_001',
  shop_name: '测试店铺',
  subaccount_name: '测试子账号',
  owner: '测试负责人',
  session_partition: 'persist:account-acc_tmall_test_001',
  credential_ref: null,
  login_url: 'https://loginmyseller.taobao.com/',
  allowed_hosts: ['taobao.com', 'tmall.com', 'alipay.com'],
  enabled: true,
  login_status: 'need_human_login',
  last_login_checked_at: null,
  created_at: '2026-08-27T00:00:00.000Z',
  updated_at: '2026-08-27T00:00:00.000Z'
}

function encryption(): SessionCookieEncryption {
  return {
    isAvailable: () => true,
    encrypt: (value) => xor(Buffer.from(value, 'utf8')),
    decrypt: (value) => xor(Buffer.from(value)).toString('utf8')
  }
}

function xor(value: Buffer): Buffer {
  for (let index = 0; index < value.length; index += 1) value[index] = (value[index] ?? 0) ^ 0xa5
  return value
}

function cookie(overrides: Partial<Cookie> = {}): Cookie {
  return {
    name: 'login_session',
    value: 'sensitive-value',
    domain: '.taobao.com',
    hostOnly: false,
    path: '/',
    secure: true,
    httpOnly: true,
    session: true,
    sameSite: 'lax',
    ...overrides
  }
}

describe('SessionCookieVault', () => {
  it('encrypts only allowlisted session cookies and restores them without an expiry', async () => {
    const root = await mkdtemp(join(tmpdir(), 'session-cookie-vault-'))
    const vault = new SessionCookieVault(root, encryption())
    const get = vi.fn(async () => [
      cookie(),
      cookie({ name: 'persistent', session: false, expirationDate: 2_000_000_000 }),
      cookie({ name: 'outside', domain: '.example.com' })
    ])
    const set = vi.fn(async (_details: unknown) => undefined)

    await expect(vault.snapshot(account, { get, set } as never)).resolves.toBe(1)
    const stored = await readFile(join(root, 'Session Cookie Snapshots', `${account.account_id}.bin`), 'utf8')
    expect(stored).not.toContain('sensitive-value')
    await expect(vault.restore(account, { get, set } as never)).resolves.toBe(1)
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://taobao.com/',
      name: 'login_session',
      domain: '.taobao.com',
      secure: true,
      httpOnly: true
    }))
    expect(set.mock.calls[0]?.[0]).not.toHaveProperty('expirationDate')
  })

  it('does not persist secrets when OS encryption is unavailable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'session-cookie-vault-disabled-'))
    const vault = new SessionCookieVault(root, {
      isAvailable: () => false,
      encrypt: vi.fn(),
      decrypt: vi.fn()
    })
    const get = vi.fn(async () => [cookie()])

    await expect(vault.snapshot(account, { get, set: vi.fn() } as never)).resolves.toBe(0)
    expect(get).not.toHaveBeenCalled()
  })

  it('uses label-boundary domain matching', () => {
    expect(isAllowedCookieDomain('.login.taobao.com', account.allowed_hosts)).toBe(true)
    expect(isAllowedCookieDomain('eviltaobao.com', account.allowed_hosts)).toBe(false)
  })
})
