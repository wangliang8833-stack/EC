import { randomUUID } from 'node:crypto'
import type { AiDecisionInput, AiDecisionModule, AiDecisionRecord } from '@ecommerce/shared'
import type { JsonStorageService } from '../storage/json-storage-service.js'

export class AiDecisionRepository {
  constructor(private readonly storage: JsonStorageService) {}

  async list(module: AiDecisionModule): Promise<AiDecisionRecord[]> {
    assertModule(module)
    try {
      const value = await this.storage.readJson<unknown>(this.path(module))
      return Array.isArray(value) ? value.filter(isDecisionRecord) : []
    } catch (error) {
      if (isMissing(error)) return []
      throw error
    }
  }

  async save(input: AiDecisionInput): Promise<AiDecisionRecord> {
    assertDecision(input)
    const records = await this.list(input.module)
    const existing = records.find((record) => record.entityId === input.entityId && record.action === input.action)
    if (existing) return existing
    const record: AiDecisionRecord = { ...input, decisionId: `decision_${randomUUID().replaceAll('-', '')}`, createdAt: new Date().toISOString() }
    await this.storage.writeJson(this.path(input.module), [record, ...records].slice(0, 5000))
    return record
  }

  private path(module: AiDecisionModule): string { return `data/ai/state/${module}-decisions.json` }
}

function assertModule(value: unknown): asserts value is AiDecisionModule {
  if (value !== 'selection' && value !== 'operations') throw new TypeError('AI 决策模块无效。')
}

function assertDecision(value: AiDecisionInput): void {
  if (!value || typeof value !== 'object') throw new TypeError('AI 决策格式无效。')
  assertModule(value.module)
  if (typeof value.entityId !== 'string' || value.entityId.length < 1 || value.entityId.length > 500) throw new TypeError('决策对象无效。')
  if (!['ADD_TO_POOL', 'WATCH', 'REJECT', 'SUBMIT_FOR_APPROVAL', 'APPROVE', 'DECLINE'].includes(value.action)) throw new TypeError('决策动作无效。')
  if (typeof value.summary !== 'string' || value.summary.length < 1 || value.summary.length > 1000) throw new TypeError('决策摘要无效。')
  const serialized = JSON.stringify(value.payload)
  if (serialized.length > 128_000 || /"(?:password|cookie|authorization|apiKey)"\s*:/i.test(serialized)) throw new TypeError('决策快照包含不安全字段或超过大小限制。')
}

function isDecisionRecord(value: unknown): value is AiDecisionRecord {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && typeof (value as Record<string, unknown>)['decisionId'] === 'string' && typeof (value as Record<string, unknown>)['entityId'] === 'string')
}

function isMissing(error: unknown): boolean { return Boolean(error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'ENOENT') }
