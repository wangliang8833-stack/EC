import { tmpdir } from 'node:os'
import { join } from 'node:path'
import pino from 'pino'
import { describe, expect, it, vi } from 'vitest'
import { JsonStorageService } from '../storage/json-storage-service.js'
import { AiModelSettingsRepository } from './ai-model-settings-repository.js'
import { LlmProvider } from './llm-provider.js'

describe('retired analytics AI tasks', () => {
  it.each(['analytics_explanation', 'analytics_question_planning'])('rejects %s before reading model credentials or accessing the network', async (task) => {
    const directory = join(tmpdir(), 'commerce-analysis-no-ai-test')
    const storage = new JsonStorageService(directory)
    const settings = new AiModelSettingsRepository(storage, directory, {
      isAvailable: () => false, encrypt: () => { throw new Error('must not encrypt') }, decrypt: () => { throw new Error('must not decrypt') }
    })
    const readSettings = vi.spyOn(settings, 'get')
    const provider = new LlmProvider(settings, storage, pino({ enabled: false }))
    // IPC can receive untyped historical requests, even after the shared union is narrowed.
    const input = JSON.parse(JSON.stringify({ task, model: 'unused', systemPrompt: 'unused', input: {} }))
    await expect(provider.generate(input)).rejects.toThrow('不支持的 AI 任务')
    expect(readSettings).not.toHaveBeenCalled()
  })
})
