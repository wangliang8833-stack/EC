import { describe, expect, it } from 'vitest'
import { AccountLockedError, AccountLockManager } from './account-lock-manager.js'

describe('AccountLockManager', () => {
  it('allows only one active run for an account', () => {
    const locks = new AccountLockManager()
    const lease = locks.acquire('acc_001', 'run_001', 1_000, 10_000)

    expect(() => locks.acquire('acc_001', 'run_002', 1_000, 10_100)).toThrow(AccountLockedError)
    expect(lease.release()).toBe(true)
    expect(lease.release()).toBe(false)
    expect(() => locks.acquire('acc_001', 'run_002', 1_000, 10_100)).not.toThrow()
  })

  it('recovers stale leases after their TTL', () => {
    const locks = new AccountLockManager()
    locks.acquire('acc_001', 'run_stale', 1_000, 10_000)
    expect(locks.isLocked('acc_001', 10_999)).toBe(true)
    expect(locks.isLocked('acc_001', 11_000)).toBe(false)
    expect(() => locks.acquire('acc_001', 'run_recovered', 1_000, 11_000)).not.toThrow()
  })
})

