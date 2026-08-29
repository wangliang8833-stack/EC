import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AccountCredentialVault, type CredentialEncryption } from './account-credential-vault.js'

function encryption(available = true): CredentialEncryption {
  return {
    isAvailable: () => available,
    encrypt: (value) => xor(Buffer.from(value, 'utf8')),
    decrypt: (value) => xor(Buffer.from(value)).toString('utf8')
  }
}

function xor(value: Buffer): Buffer {
  for (let index = 0; index < value.length; index += 1) value[index] = (value[index] ?? 0) ^ 0x96
  return value
}

describe('AccountCredentialVault', () => {
  it('stores an encrypted account-bound credential and restores it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'account-credential-'))
    const vault = new AccountCredentialVault(root, encryption())
    const credential = { username: 'shop:user', password: 'not-a-real-password' }

    const reference = await vault.save('acc_test_001', credential)
    expect(reference).toMatch(/^credential_[a-f0-9]{64}$/)
    const bytes = await readFile(join(root, 'Credential Vault', `${reference}.bin`))
    expect(bytes.toString('utf8')).not.toContain(credential.username)
    expect(bytes.toString('utf8')).not.toContain(credential.password)
    await expect(vault.load(reference)).resolves.toEqual(credential)

    await vault.save('acc_test_001', { ...credential, password: 'updated-password' })
    await expect(vault.load(reference)).resolves.toEqual({ ...credential, password: 'updated-password' })
  })

  it('refuses plaintext fallback when encryption is unavailable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'account-credential-disabled-'))
    const vault = new AccountCredentialVault(root, encryption(false))
    await expect(vault.save('acc_test_001', { username: 'user', password: 'password' })).rejects.toThrow('安全存储不可用')
  })
})
