import type {
  AccountContext,
  DataTarget,
  DateRange,
  PlatformAdapter,
  RawCollectionResult,
  ValidationResult
} from '@ecommerce/shared'
import type { AtomicWriteResult, JsonStorageService } from '../storage/json-storage-service.js'

export type CollectionStep =
  | { type: 'check_login'; timeout_ms: number }
  | { type: 'navigate'; target: DataTarget; timeout_ms: number }
  | { type: 'set_date'; range: DateRange; timeout_ms: number }
  | { type: 'collect'; target: DataTarget; timeout_ms: number }
  | { type: 'validate'; timeout_ms: number }
  | { type: 'persist_raw'; timeout_ms: number }

export interface StepExecution {
  index: number
  type: CollectionStep['type']
  status: 'SUCCESS' | 'FAILED'
  started_at: string
  finished_at: string
  error?: string
}

export interface StepRunResult {
  raw: RawCollectionResult
  validation: ValidationResult
  persisted: AtomicWriteResult
  steps: StepExecution[]
}

export class StepTimeoutError extends Error {
  constructor(type: CollectionStep['type'], timeoutMs: number) {
    super(`Step ${type} exceeded timeout of ${timeoutMs}ms`)
    this.name = 'StepTimeoutError'
  }
}

export class StepRunner {
  constructor(
    private readonly adapter: PlatformAdapter,
    private readonly storage: JsonStorageService
  ) {}

  async run(context: AccountContext, steps: readonly CollectionStep[]): Promise<StepRunResult> {
    let raw: RawCollectionResult | undefined
    let validation: ValidationResult | undefined
    let persisted: AtomicWriteResult | undefined
    const executions: StepExecution[] = []

    for (const [index, step] of steps.entries()) {
      const startedAt = new Date().toISOString()
      try {
        const result = await withTimeout(this.execute(step, context, raw), step.timeout_ms, step.type)
        if (result.kind === 'raw') raw = result.value
        if (result.kind === 'validation') validation = result.value
        if (result.kind === 'persisted') persisted = result.value
        executions.push({
          index,
          type: step.type,
          status: 'SUCCESS',
          started_at: startedAt,
          finished_at: new Date().toISOString()
        })
      } catch (error) {
        executions.push({
          index,
          type: step.type,
          status: 'FAILED',
          started_at: startedAt,
          finished_at: new Date().toISOString(),
          error: error instanceof Error ? error.message : String(error)
        })
        throw error
      }
    }

    if (!raw || !validation || !persisted) {
      throw new Error('Workflow must collect, validate and persist raw data')
    }
    return { raw, validation, persisted, steps: executions }
  }

  private async execute(
    step: CollectionStep,
    context: AccountContext,
    raw: RawCollectionResult | undefined
  ): Promise<
    | { kind: 'none' }
    | { kind: 'raw'; value: RawCollectionResult }
    | { kind: 'validation'; value: ValidationResult }
    | { kind: 'persisted'; value: AtomicWriteResult }
  > {
    switch (step.type) {
      case 'check_login': {
        const state = await this.adapter.checkLogin(context)
        if (state !== 'authenticated') throw new Error(`Account login state is ${state}`)
        return { kind: 'none' }
      }
      case 'navigate':
        await this.adapter.navigate(context, step.target)
        return { kind: 'none' }
      case 'set_date':
        await this.adapter.setDateRange(context, step.range)
        return { kind: 'none' }
      case 'collect':
        return { kind: 'raw', value: await this.adapter.collect(context, step.target) }
      case 'validate': {
        if (!raw) throw new Error('No raw result is available for validation')
        const result = await this.adapter.validate(raw)
        if (!result.valid) throw new Error(`Adapter validation failed: ${result.errors.join('; ')}`)
        return { kind: 'validation', value: result }
      }
      case 'persist_raw': {
        if (!raw) throw new Error('No raw result is available for persistence')
        const [year, month, day] = raw.data_date.split('-')
        const relativePath = [
          'data/raw',
          raw.platform,
          raw.shop_id,
          raw.account_id,
          raw.data_type,
          year,
          month,
          day,
          `${raw.run_id}.json`
        ].join('/')
        return {
          kind: 'persisted',
          value: await this.storage.writeJson(relativePath, raw, 'raw-collection-1.0.0')
        }
      }
    }
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, type: CollectionStep['type']): Promise<T> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) throw new RangeError('Step timeout must be positive')
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new StepTimeoutError(type, timeoutMs)), timeoutMs)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

