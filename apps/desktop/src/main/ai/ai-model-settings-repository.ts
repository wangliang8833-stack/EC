import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { AiModelSettings, AiProviderCode, UpdateAiModelSettingsInput } from '@ecommerce/shared'
import type { CredentialEncryption } from '../accounts/account-credential-vault.js'
import type { JsonStorageService } from '../storage/json-storage-service.js'

interface PersistedAiSettings {
  schema_version: '1.0.0'
  provider: AiProviderCode
  base_url: string
  models: string[]
  default_model: string
  updated_at: string
}

const DEFAULTS: PersistedAiSettings = {
  schema_version: '1.0.0',
  provider: 'openai',
  base_url: 'https://api.openai.com/v1',
  models: [],
  default_model: '',
  updated_at: ''
}

export class AiModelSettingsRepository {
  constructor(
    private readonly storage: JsonStorageService,
    private readonly environmentDataRoot: string,
    private readonly encryption: CredentialEncryption
  ) {}

  async get(): Promise<AiModelSettings> {
    const settings = await this.loadMetadata()
    return this.toResponse(settings, await this.hasApiKey())
  }

  async update(input: UpdateAiModelSettingsInput): Promise<AiModelSettings> {
    assertSettingsInput(input)
    const now = new Date().toISOString()
    const settings: PersistedAiSettings = {
      schema_version: '1.0.0',
      provider: input.provider,
      base_url: normalizeBaseUrl(input.baseUrl),
      models: [...new Set(input.models.map((model) => model.trim()).filter(Boolean))],
      default_model: input.defaultModel.trim(),
      updated_at: now
    }
    if (!settings.models.includes(settings.default_model)) settings.models.unshift(settings.default_model)
    if (input.apiKey !== undefined && input.apiKey !== '') await this.saveApiKey(input.apiKey)
    if (!await this.hasApiKey()) throw new Error('请填写 API Key；系统不会以明文保存密钥。')
    await this.storage.writeJson('config/ai-model-settings.json', settings)
    return this.toResponse(settings, true)
  }

  async getApiKey(): Promise<string> {
    if (!this.encryption.isAvailable()) throw new Error('系统安全存储不可用，无法读取大模型密钥。')
    let encrypted: Buffer
    try {
      encrypted = await readFile(this.secretPath())
    } catch (error) {
      if (isMissing(error)) throw new Error('尚未配置大模型 API Key。')
      throw error
    }
    const value = this.encryption.decrypt(encrypted)
    if (!value || value.length > 4096) throw new Error('大模型 API Key 格式无效。')
    return value
  }

  private async loadMetadata(): Promise<PersistedAiSettings> {
    try {
      const value = await this.storage.readJson<PersistedAiSettings>('config/ai-model-settings.json')
      return isPersistedSettings(value) ? value : DEFAULTS
    } catch (error) {
      return isMissing(error) ? DEFAULTS : Promise.reject(error)
    }
  }

  private async saveApiKey(apiKey: string): Promise<void> {
    if (!this.encryption.isAvailable()) throw new Error('系统安全存储不可用，拒绝以明文保存大模型密钥。')
    const normalized = apiKey.trim()
    if (normalized.length < 8 || normalized.length > 4096) throw new TypeError('API Key 长度无效。')
    const encrypted = this.encryption.encrypt(normalized)
    const directory = resolve(this.environmentDataRoot, 'AI Credential Vault')
    const target = this.secretPath()
    const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`
    await mkdir(directory, { recursive: true })
    try {
      await writeFile(temporary, encrypted, { flag: 'wx', mode: 0o600 })
      await rename(temporary, target)
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined)
    }
  }

  private async hasApiKey(): Promise<boolean> {
    try {
      await readFile(this.secretPath())
      return true
    } catch (error) {
      if (isMissing(error)) return false
      throw error
    }
  }

  private secretPath(): string {
    return resolve(this.environmentDataRoot, 'AI Credential Vault', 'default-api-key.bin')
  }

  private toResponse(value: PersistedAiSettings, apiKeyConfigured: boolean): AiModelSettings {
    return {
      provider: value.provider,
      baseUrl: value.base_url,
      models: value.models,
      defaultModel: value.default_model || null,
      apiKeyConfigured,
      updatedAt: value.updated_at || null
    }
  }
}

export function normalizeBaseUrl(value: string): string {
  const parsed = new URL(value.trim())
  const localHttp = parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)
  if (parsed.protocol !== 'https:' && !localHttp) throw new TypeError('模型服务地址必须使用 HTTPS；仅本机服务允许 HTTP。')
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new TypeError('模型服务地址不能包含凭据、查询参数或锚点。')
  return parsed.toString().replace(/\/$/, '')
}

function assertSettingsInput(input: UpdateAiModelSettingsInput): void {
  if (!input || typeof input !== 'object') throw new TypeError('大模型设置格式无效。')
  if (!['openai', 'deepseek', 'qwen', 'openai_compatible'].includes(input.provider)) throw new TypeError('不支持的大模型服务商。')
  normalizeBaseUrl(input.baseUrl)
  if (!Array.isArray(input.models) || input.models.some((model) => typeof model !== 'string' || model.trim().length < 1 || model.length > 160)) throw new TypeError('模型列表格式无效。')
  if (typeof input.defaultModel !== 'string' || input.defaultModel.trim().length < 1 || input.defaultModel.length > 160) throw new TypeError('默认模型不能为空。')
  if (input.apiKey !== undefined && typeof input.apiKey !== 'string') throw new TypeError('API Key 格式无效。')
}

function isPersistedSettings(value: unknown): value is PersistedAiSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record['schema_version'] === '1.0.0' && typeof record['provider'] === 'string' && typeof record['base_url'] === 'string' && Array.isArray(record['models']) && typeof record['default_model'] === 'string' && typeof record['updated_at'] === 'string'
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'ENOENT')
}
