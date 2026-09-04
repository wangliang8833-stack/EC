import { createHash, randomUUID } from 'node:crypto'
import type { AiConnectionTestResult, AiGenerateRequest, AiGenerateResult } from '@ecommerce/shared'
import type pino from 'pino'
import type { AiModelSettingsRepository } from './ai-model-settings-repository.js'
import type { JsonStorageService } from '../storage/json-storage-service.js'

const MAX_INPUT_BYTES = 256 * 1024
const TASKS = new Set(['product_selection_analysis', 'ecommerce_operation_strategy', 'analytics_explanation', 'analytics_question_planning'])

export class LlmProvider {
  constructor(private readonly settings: AiModelSettingsRepository, private readonly storage: JsonStorageService, private readonly logger: pino.Logger) {}

  async test(modelOverride?: string): Promise<AiConnectionTestResult> {
    const settings = await this.settings.get()
    const model = resolveModel(settings.models, settings.defaultModel, modelOverride)
    await this.request(model, [
      { role: 'system', content: 'Return only valid JSON.' },
      { role: 'user', content: '{"task":"connection_test","response":{"ok":true}}' }
    ], 20_000)
    return { connected: true, model, message: '模型服务连接成功', checkedAt: new Date().toISOString() }
  }

  async generate(input: AiGenerateRequest): Promise<AiGenerateResult> {
    assertGenerateRequest(input)
    const settings = await this.settings.get()
    const model = resolveModel(settings.models, settings.defaultModel, input.model)
    const serialized = JSON.stringify(input.input)
    if (Buffer.byteLength(serialized, 'utf8') > MAX_INPUT_BYTES) throw new Error('AI 输入超过 256KB 限制，请缩小店铺或时间范围。')
    const started = Date.now()
    const requestId = `ai_${randomUUID().replaceAll('-', '')}`
    const output = await this.request(model, [
      { role: 'system', content: `${input.systemPrompt}\n严格输出一个 JSON 对象，不要输出 Markdown。不得编造输入之外的数字。` },
      { role: 'user', content: serialized }
    ], 60_000)
    const result: AiGenerateResult = {
      requestId,
      task: input.task,
      provider: settings.provider,
      model,
      output,
      generatedAt: new Date().toISOString(),
      durationMs: Date.now() - started
    }
    await this.storage.writeJson(`data/ai/runs/${requestId}.json`, {
      schema_version: '1.0.0', request_id: requestId, task: input.task, provider: settings.provider, model,
      prompt_version: 'ai-workspace-v1.0.0', input_hash: createHash('sha256').update(serialized).digest('hex'),
      output, generated_at: result.generatedAt, duration_ms: result.durationMs
    })
    this.logger.info({ requestId, task: input.task, model, durationMs: result.durationMs, inputHash: createHash('sha256').update(serialized).digest('hex') }, 'structured AI request completed')
    return result
  }

  private async request(model: string, messages: Array<{ role: 'system' | 'user'; content: string }>, timeoutMs: number): Promise<Record<string, unknown>> {
    const settings = await this.settings.get()
    if (!settings.apiKeyConfigured) throw new Error('未接入AI模型')
    const apiKey = await this.settings.getApiKey()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(`${settings.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, messages, temperature: 0.2, response_format: { type: 'json_object' } }),
        signal: controller.signal
      })
      const body: unknown = await response.json().catch(() => null)
      if (!response.ok) throw new Error(`模型服务返回 ${response.status}：${readErrorMessage(body)}`)
      const content = readContent(body)
      const parsed: unknown = JSON.parse(stripJsonFence(content))
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('模型未返回 JSON 对象。')
      return parsed as Record<string, unknown>
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw new Error('模型请求超时。')
      throw error
    } finally {
      clearTimeout(timeout)
    }
  }
}

function resolveModel(models: string[], defaultModel: string | null, requested?: string): string {
  const model = requested?.trim() || defaultModel
  if (!model || !models.includes(model)) throw new Error('请选择系统设置中已配置的模型。')
  return model
}

function assertGenerateRequest(value: AiGenerateRequest): void {
  if (!value || typeof value !== 'object' || !TASKS.has(value.task)) throw new TypeError('不支持的 AI 任务。')
  if (typeof value.model !== 'string' || value.model.length < 1 || value.model.length > 160) throw new TypeError('模型名无效。')
  if (typeof value.systemPrompt !== 'string' || value.systemPrompt.length < 20 || value.systemPrompt.length > 12_000) throw new TypeError('系统提示词无效。')
  if (!value.input || typeof value.input !== 'object' || Array.isArray(value.input)) throw new TypeError('AI 输入必须是对象。')
}

function readContent(value: unknown): string {
  const record = value as { choices?: Array<{ message?: { content?: unknown } }> }
  const content = record?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) throw new Error('模型响应中没有可用内容。')
  return content
}

function readErrorMessage(value: unknown): string {
  const message = (value as { error?: { message?: unknown } } | null)?.error?.message
  return typeof message === 'string' ? message.slice(0, 500) : '请求失败'
}

function stripJsonFence(value: string): string {
  return value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
}
