import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CredentialEncryption } from '../accounts/account-credential-vault.js'
import { JsonStorageService } from '../storage/json-storage-service.js'
import { AiModelSettingsRepository, normalizeBaseUrl } from './ai-model-settings-repository.js'

const encryption: CredentialEncryption = {
  isAvailable: () => true,
  encrypt: (value) => xor(Buffer.from(value)),
  decrypt: (value) => xor(Buffer.from(value)).toString('utf8')
}

function xor(value: Buffer): Buffer {
  for (let index = 0; index < value.length; index += 1) value[index] = (value[index] ?? 0) ^ 0xa5
  return value
}

describe('AiModelSettingsRepository', () => {
  it('stores metadata separately from the encrypted API key', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-settings-'))
    const environment = await mkdtemp(join(tmpdir(), 'ai-environment-'))
    const storage = new JsonStorageService(root)
    await storage.initialize()
    const repository = new AiModelSettingsRepository(storage, environment, encryption)
    const result = await repository.update({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com/', models: ['deepseek-chat', 'deepseek-reasoner'], defaultModel: 'deepseek-chat', apiKey: 'secret-test-key' })
    expect(result).toMatchObject({ provider: 'deepseek', baseUrl: 'https://api.deepseek.com', apiKeyConfigured: true, defaultModel: 'deepseek-chat' })
    const metadata = await readFile(join(root, 'config', 'ai-model-settings.json'), 'utf8')
    expect(metadata).not.toContain('secret-test-key')
    const secret = await readFile(join(environment, 'AI Credential Vault', 'default-api-key.bin'))
    expect(secret.toString()).not.toContain('secret-test-key')
    await expect(repository.getApiKey()).resolves.toBe('secret-test-key')
  })

  it('allows HTTP only for local model services', () => {
    expect(normalizeBaseUrl('http://localhost:11434/v1/')).toBe('http://localhost:11434/v1')
    expect(() => normalizeBaseUrl('http://example.com/v1')).toThrow(/HTTPS/)
  })
})
