import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { JsonStorageService } from '../storage/json-storage-service.js'
import { AiDecisionRepository } from './ai-decision-repository.js'

describe('AiDecisionRepository', () => {
  it('persists decisions idempotently with their evidence snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ai-decisions-'))
    const storage = new JsonStorageService(root); await storage.initialize()
    const repository = new AiDecisionRepository(storage)
    const input = { module: 'selection' as const, entityId: 'opportunity-1', action: 'ADD_TO_POOL' as const, summary: '加入候选池', payload: { score_version: 'v1', score: 82 } }
    const first = await repository.save(input)
    const second = await repository.save(input)
    expect(second.decisionId).toBe(first.decisionId)
    await expect(repository.list('selection')).resolves.toHaveLength(1)
  })
})
