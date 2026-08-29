export type CollectionExecutionPhase = 'navigate' | 'capture'
export type CollectionSequenceProgressPhase = 'navigating' | 'capturing' | 'page_completed'

export class CollectionTimeoutError extends Error {
  readonly code = 'COLLECTION_TIMEOUT'

  constructor(
    readonly phase: CollectionExecutionPhase | 'collection',
    readonly timeoutMs: number,
    readonly pageKey?: string
  ) {
    super(`${pageKey ? `页面 ${pageKey} 的` : ''}${phaseLabel(phase)}超过 ${timeoutMs}ms`)
    this.name = 'CollectionTimeoutError'
  }
}

export class CollectionCancelledError extends Error {
  readonly code = 'COLLECTION_CANCELLED'

  constructor(readonly phase: CollectionExecutionPhase | 'collection', readonly pageKey?: string) {
    super(`${pageKey ? `页面 ${pageKey} 的` : ''}采集任务已取消`)
    this.name = 'CollectionCancelledError'
  }
}

export interface CollectionDefinition {
  key: string
}

export interface CollectionSequenceOptions<TDefinition extends CollectionDefinition, TResult> {
  definitions: readonly TDefinition[]
  navigate: (definition: TDefinition, index: number) => Promise<unknown>
  capture: (definition: TDefinition, index: number) => Promise<TResult>
  navigationTimeoutMs: number
  captureTimeoutMs: number
  signal?: AbortSignal | undefined
  onStop?: (phase: CollectionExecutionPhase, definition: TDefinition) => void | Promise<void>
  onProgress?: (phase: CollectionSequenceProgressPhase, definition: TDefinition, index: number, total: number) => void | Promise<void>
}

export async function runCollectionSequence<TDefinition extends CollectionDefinition, TResult>(
  options: CollectionSequenceOptions<TDefinition, TResult>
): Promise<TResult[]> {
  const results: TResult[] = []
  const total = options.definitions.length
  for (const [index, definition] of options.definitions.entries()) {
    throwIfCancelled(options.signal, 'navigate', definition.key)
    await options.onProgress?.('navigating', definition, index, total)
    await runBoundedOperation(
      () => options.navigate(definition, index),
      {
        phase: 'navigate',
        pageKey: definition.key,
        timeoutMs: options.navigationTimeoutMs,
        signal: options.signal,
        onStop: () => options.onStop?.('navigate', definition)
      }
    )

    throwIfCancelled(options.signal, 'capture', definition.key)
    await options.onProgress?.('capturing', definition, index, total)
    const result = await runBoundedOperation(
      () => options.capture(definition, index),
      {
        phase: 'capture',
        pageKey: definition.key,
        timeoutMs: options.captureTimeoutMs,
        signal: options.signal,
        onStop: () => options.onStop?.('capture', definition)
      }
    )
    results.push(result)
    await options.onProgress?.('page_completed', definition, index, total)
  }
  return results
}

export interface BoundedOperationOptions {
  phase: CollectionExecutionPhase | 'collection'
  timeoutMs: number
  pageKey?: string
  signal?: AbortSignal | undefined
  onStop?: () => void | Promise<void>
}

export function runBoundedOperation<T>(operation: () => Promise<T>, options: BoundedOperationOptions): Promise<T> {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw new TypeError('timeoutMs must be a positive finite number')
  if (options.signal?.aborted) return Promise.reject(new CollectionCancelledError(options.phase, options.pageKey))

  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (handler: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', handleAbort)
      handler()
    }
    const stop = (): void => {
      try {
        void Promise.resolve(options.onStop?.()).catch(() => undefined)
      } catch {
        // Stop hooks are best effort and must never hide the terminal state.
      }
    }
    const handleAbort = (): void => finish(() => {
      stop()
      reject(new CollectionCancelledError(options.phase, options.pageKey))
    })
    const timer = setTimeout(() => finish(() => {
      stop()
      reject(new CollectionTimeoutError(options.phase, options.timeoutMs, options.pageKey))
    }), options.timeoutMs)
    options.signal?.addEventListener('abort', handleAbort, { once: true })

    Promise.resolve()
      .then(operation)
      .then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error))
      )
  })
}

function throwIfCancelled(signal: AbortSignal | undefined, phase: CollectionExecutionPhase, pageKey: string): void {
  if (signal?.aborted) throw new CollectionCancelledError(phase, pageKey)
}

function phaseLabel(phase: CollectionExecutionPhase | 'collection'): string {
  if (phase === 'navigate') return '页面跳转'
  if (phase === 'capture') return '接口采集'
  return '完整采集'
}
