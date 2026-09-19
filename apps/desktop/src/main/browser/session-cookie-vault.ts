import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Cookie, Cookies } from 'electron'
import type { AccountConfig } from '@ecommerce/shared'

const SNAPSHOT_VERSION = 2
const LEGACY_SNAPSHOT_VERSION = 1
const MAX_SNAPSHOT_BYTES = 10 * 1024 * 1024
const MAX_COOKIE_COUNT = 4096

export interface SessionCookieEncryption {
  isAvailable(): boolean
  encrypt(value: string): Buffer
  decrypt(value: Buffer): string
}

type SessionCookieStore = Pick<Cookies, 'get' | 'set'>
type DomainCookie = Cookie & { domain: string }

interface SessionCookieRecord {
  url: string
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  httpOnly: boolean
  sameSite: Cookie['sameSite']
  expirationDate?: number
}

interface SessionCookieSnapshot {
  version: typeof SNAPSHOT_VERSION
  account_id: string
  captured_at: string
  cookies: SessionCookieRecord[]
}

interface LegacySessionCookieSnapshot {
  version: typeof LEGACY_SNAPSHOT_VERSION
  cookies: SessionCookieRecord[]
}

export class SessionCookieVault {
  private readonly pending = new Map<string, Promise<unknown>>()

  constructor(
    private readonly environmentDataRoot: string,
    private readonly encryption: SessionCookieEncryption
  ) {}

  async restore(account: AccountConfig, cookieStore: SessionCookieStore): Promise<number> {
    return this.enqueue(account.account_id, async () => {
      if (!this.encryption.isAvailable()) return 0
      let encrypted: Buffer
      try {
        encrypted = await readFile(this.snapshotPath(account.account_id))
      } catch (error) {
        if (isMissingFile(error)) return 0
        throw error
      }
      if (encrypted.byteLength > MAX_SNAPSHOT_BYTES) throw new Error('Encrypted session cookie snapshot is too large')

      const snapshot = parseSnapshot(this.encryption.decrypt(encrypted), account.account_id, account.allowed_hosts)
      let restored = 0
      for (const cookie of snapshot.cookies) {
        if (isExpired(cookie)) continue
        try {
          await cookieStore.set(cookie)
          restored += 1
        } catch {
          // A stale or platform-incompatible cookie must not block the rest of the valid session.
        }
      }
      return restored
    })
  }

  async snapshot(account: AccountConfig, cookieStore: SessionCookieStore): Promise<number> {
    return this.enqueue(account.account_id, async () => {
      if (!this.encryption.isAvailable()) return 0
      const now = Date.now() / 1000
      const cookies = (await cookieStore.get({}))
        .filter((cookie): cookie is DomainCookie => Boolean(
          cookie.domain &&
          isAllowedCookieDomain(cookie.domain, account.allowed_hosts) &&
          (cookie.session || !cookie.expirationDate || cookie.expirationDate > now)
        ))
        .slice(0, MAX_COOKIE_COUNT)
        .map(toSessionCookieRecord)
      const snapshot: SessionCookieSnapshot = {
        version: SNAPSHOT_VERSION,
        account_id: account.account_id,
        captured_at: new Date().toISOString(),
        cookies
      }
      const encrypted = this.encryption.encrypt(JSON.stringify(snapshot))
      if (encrypted.byteLength > MAX_SNAPSHOT_BYTES) throw new Error('Encrypted session cookie snapshot is too large')

      const directory = this.snapshotDirectory()
      await mkdir(directory, { recursive: true })
      const target = this.snapshotPath(account.account_id)
      const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, encrypted, { flag: 'wx', mode: 0o600 })
        await rename(temporary, target)
      } finally {
        await rm(temporary, { force: true }).catch(() => undefined)
      }
      return cookies.length
    })
  }

  private snapshotDirectory(): string {
    return resolve(this.environmentDataRoot, 'Session Cookie Snapshots')
  }

  private snapshotPath(accountId: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(accountId)) throw new Error('Unsafe account id for session cookie snapshot')
    return resolve(this.snapshotDirectory(), `${accountId}.bin`)
  }

  private async enqueue<T>(accountId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.pending.get(accountId) ?? Promise.resolve()
    const current = previous.catch(() => undefined).then(operation)
    this.pending.set(accountId, current)
    try {
      return await current
    } finally {
      if (this.pending.get(accountId) === current) this.pending.delete(accountId)
    }
  }
}

export function isAllowedCookieDomain(domain: string, allowedHosts: readonly string[]): boolean {
  const normalizedDomain = domain.trim().toLowerCase().replace(/^\.+/, '')
  return allowedHosts.some((allowedHost) => {
    const normalizedAllowed = allowedHost.trim().toLowerCase().replace(/^\.+/, '')
    return normalizedDomain === normalizedAllowed || normalizedDomain.endsWith(`.${normalizedAllowed}`)
  })
}

function toSessionCookieRecord(cookie: DomainCookie): SessionCookieRecord {
  const domain = cookie.domain.trim().toLowerCase()
  const host = domain.replace(/^\.+/, '')
  const path = cookie.path?.startsWith('/') ? cookie.path : '/'
  const record: SessionCookieRecord = {
    url: `${cookie.secure ? 'https' : 'http'}://${host}${path}`,
    name: cookie.name,
    value: cookie.value,
    domain,
    path,
    secure: cookie.secure ?? false,
    httpOnly: cookie.httpOnly ?? false,
    sameSite: cookie.sameSite
  }
  if (!cookie.session && typeof cookie.expirationDate === 'number' && Number.isFinite(cookie.expirationDate)) {
    record.expirationDate = cookie.expirationDate
  }
  return record
}

function parseSnapshot(value: string, accountId: string, allowedHosts: readonly string[]): SessionCookieSnapshot | LegacySessionCookieSnapshot {
  const candidate: unknown = JSON.parse(value)
  if (!isRecord(candidate) || !Array.isArray(candidate['cookies'])) {
    throw new Error('Invalid session cookie snapshot')
  }
  const version = candidate['version']
  if (version !== SNAPSHOT_VERSION && version !== LEGACY_SNAPSHOT_VERSION) throw new Error('Invalid session cookie snapshot')
  if (version === SNAPSHOT_VERSION && candidate['account_id'] !== accountId) throw new Error('Session cookie snapshot account mismatch')
  if (candidate['cookies'].length > MAX_COOKIE_COUNT) throw new Error('Session cookie snapshot contains too many cookies')
  const cookies = candidate['cookies'].map(parseCookieRecord)
  if (cookies.some((cookie) => !isAllowedCookieDomain(cookie.domain, allowedHosts))) {
    throw new Error('Session cookie snapshot contains a disallowed domain')
  }
  return version === SNAPSHOT_VERSION
    ? { version, account_id: accountId, captured_at: requireString(candidate, 'captured_at'), cookies }
    : { version, cookies }
}

function parseCookieRecord(value: unknown): SessionCookieRecord {
  if (!isRecord(value)) throw new Error('Invalid session cookie record')
  const sameSite = value['sameSite']
  if (!['unspecified', 'no_restriction', 'lax', 'strict'].includes(String(sameSite))) {
    throw new Error('Invalid session cookie same-site policy')
  }
  const expirationDate = value['expirationDate']
  if (expirationDate !== undefined && (typeof expirationDate !== 'number' || !Number.isFinite(expirationDate) || expirationDate <= 0)) {
    throw new Error('Invalid session cookie expiration date')
  }
  const record: SessionCookieRecord = {
    url: requireString(value, 'url'),
    name: requireString(value, 'name'),
    value: requireString(value, 'value'),
    domain: requireString(value, 'domain'),
    path: requireString(value, 'path'),
    secure: requireBoolean(value, 'secure'),
    httpOnly: requireBoolean(value, 'httpOnly'),
    sameSite: sameSite as Cookie['sameSite']
  }
  if (typeof expirationDate === 'number') record.expirationDate = expirationDate
  const url = new URL(record.url)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Invalid session cookie URL')
  if (record.name.length > 4096 || record.value.length > 16_384 || record.domain.length > 253 || record.path.length > 2048) {
    throw new Error('Session cookie record exceeds safe limits')
  }
  return record
}

function isExpired(cookie: SessionCookieRecord): boolean {
  return typeof cookie.expirationDate === 'number' && cookie.expirationDate <= Date.now() / 1000
}

function requireString(value: Record<string, unknown>, key: string): string {
  const field = value[key]
  if (typeof field !== 'string') throw new Error(`Invalid session cookie ${key}`)
  return field
}

function requireBoolean(value: Record<string, unknown>, key: string): boolean {
  const field = value[key]
  if (typeof field !== 'boolean') throw new Error(`Invalid session cookie ${key}`)
  return field
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error['code'] === 'ENOENT'
}
