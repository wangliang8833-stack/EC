export interface AccountLease {
  accountId: string
  runId: string
  acquiredAt: string
  expiresAt: string
  release(): boolean
}

interface StoredLease {
  runId: string
  acquiredAt: number
  expiresAt: number
}

export class AccountLockedError extends Error {
  constructor(accountId: string, runId: string) {
    super(`Account ${accountId} is already locked by run ${runId}`)
    this.name = 'AccountLockedError'
  }
}

export class AccountLockManager {
  private readonly leases = new Map<string, StoredLease>()

  acquire(accountId: string, runId: string, ttlMs: number, now = Date.now()): AccountLease {
    if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
      throw new RangeError('Lease TTL must be a positive integer')
    }
    this.removeExpired(now)
    const existing = this.leases.get(accountId)
    if (existing) throw new AccountLockedError(accountId, existing.runId)

    const stored: StoredLease = { runId, acquiredAt: now, expiresAt: now + ttlMs }
    this.leases.set(accountId, stored)
    let released = false

    return {
      accountId,
      runId,
      acquiredAt: new Date(stored.acquiredAt).toISOString(),
      expiresAt: new Date(stored.expiresAt).toISOString(),
      release: () => {
        if (released) return false
        const current = this.leases.get(accountId)
        if (!current || current.runId !== runId) return false
        released = true
        return this.leases.delete(accountId)
      }
    }
  }

  isLocked(accountId: string, now = Date.now()): boolean {
    this.removeExpired(now)
    return this.leases.has(accountId)
  }

  private removeExpired(now: number): void {
    for (const [accountId, lease] of this.leases) {
      if (lease.expiresAt <= now) this.leases.delete(accountId)
    }
  }
}

