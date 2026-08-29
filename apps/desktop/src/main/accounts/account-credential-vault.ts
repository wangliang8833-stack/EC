import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const CREDENTIAL_VERSION = 1
const MAX_ENCRYPTED_BYTES = 64 * 1024

export interface AccountCredential {
  username: string
  password: string
}

export interface CredentialEncryption {
  isAvailable(): boolean
  encrypt(value: string): Buffer
  decrypt(value: Buffer): string
}

interface PersistedCredential extends AccountCredential {
  version: typeof CREDENTIAL_VERSION
}

export class AccountCredentialVault {
  constructor(
    private readonly environmentDataRoot: string,
    private readonly encryption: CredentialEncryption
  ) {}

  async save(accountId: string, credential: AccountCredential): Promise<string> {
    if (!this.encryption.isAvailable()) throw new Error('系统安全存储不可用，拒绝以明文保存登录凭据')
    assertCredential(credential)
    const credentialRef = credentialReference(accountId)
    const encrypted = this.encryption.encrypt(JSON.stringify({
      version: CREDENTIAL_VERSION,
      username: credential.username,
      password: credential.password
    } satisfies PersistedCredential))
    if (encrypted.byteLength > MAX_ENCRYPTED_BYTES) throw new Error('加密登录凭据超过安全大小限制')

    const directory = this.directory()
    await mkdir(directory, { recursive: true })
    const target = this.path(credentialRef)
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, encrypted, { flag: 'wx', mode: 0o600 })
      await rename(temporary, target)
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined)
    }
    return credentialRef
  }

  async load(credentialRef: string | null): Promise<AccountCredential | null> {
    if (!credentialRef) return null
    if (!this.encryption.isAvailable()) return null
    let encrypted: Buffer
    try {
      encrypted = await readFile(this.path(credentialRef))
    } catch (error) {
      if (isMissingFile(error)) return null
      throw error
    }
    if (encrypted.byteLength > MAX_ENCRYPTED_BYTES) throw new Error('加密登录凭据超过安全大小限制')
    const candidate: unknown = JSON.parse(this.encryption.decrypt(encrypted))
    if (!isRecord(candidate) || candidate['version'] !== CREDENTIAL_VERSION) throw new Error('登录凭据格式无效')
    const credential = { username: candidate['username'], password: candidate['password'] }
    assertCredential(credential)
    return credential
  }

  private directory(): string {
    return resolve(this.environmentDataRoot, 'Credential Vault')
  }

  private path(credentialRef: string): string {
    if (!/^credential_[A-Za-z0-9_-]{3,128}$/.test(credentialRef)) throw new Error('登录凭据引用不安全')
    return resolve(this.directory(), `${credentialRef}.bin`)
  }
}

function credentialReference(accountId: string): string {
  if (!/^[A-Za-z0-9_-]{3,128}$/.test(accountId)) throw new Error('账号标识不安全')
  return `credential_${createHash('sha256').update(accountId).digest('hex')}`
}

function assertCredential(value: unknown): asserts value is AccountCredential {
  if (!isRecord(value)) throw new Error('登录凭据格式无效')
  const username = value['username']
  const password = value['password']
  if (typeof username !== 'string' || username.trim() !== username || username.length < 1 || username.length > 320) {
    throw new Error('登录用户名格式无效')
  }
  if (typeof password !== 'string' || password.length < 1 || password.length > 1024) {
    throw new Error('登录密码格式无效')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMissingFile(error: unknown): boolean {
  return isRecord(error) && error['code'] === 'ENOENT'
}
