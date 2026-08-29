import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CollectionCancelledError,
  CollectionTimeoutError,
  runCollectionSequence
} from './collection-execution.js'

afterEach(() => {
  vi.useRealTimers()
})

describe('runCollectionSequence', () => {
  it('fails a page whose capture promise never settles instead of hanging the run', async () => {
    vi.useFakeTimers()
    const stopped: string[] = []
    const progress: string[] = []
    const pending = runCollectionSequence({
      definitions: [{ key: 'store' }, { key: 'trade' }],
      navigate: async (definition) => definition.key,
      capture: async (definition) => definition.key === 'store'
        ? { key: definition.key }
        : await new Promise<never>(() => undefined),
      navigationTimeoutMs: 30,
      captureTimeoutMs: 50,
      onStop: (phase, definition) => { stopped.push(`${phase}:${definition.key}`) },
      onProgress: (phase, definition) => { progress.push(`${phase}:${definition.key}`) }
    })

    const assertion = expect(pending).rejects.toMatchObject({
      name: 'CollectionTimeoutError',
      phase: 'capture',
      timeoutMs: 50
    })
    await vi.advanceTimersByTimeAsync(50)
    await assertion
    expect(stopped).toEqual(['capture:trade'])
    expect(progress).toEqual([
      'navigating:store', 'capturing:store', 'page_completed:store',
      'navigating:trade', 'capturing:trade'
    ])
  })

  it('cancels an in-flight navigation and invokes the stop hook', async () => {
    const controller = new AbortController()
    const stopped: string[] = []
    const pending = runCollectionSequence({
      definitions: [{ key: 'store' }],
      navigate: async () => await new Promise<never>(() => undefined),
      capture: async () => ({ key: 'store' }),
      navigationTimeoutMs: 30_000,
      captureTimeoutMs: 30_000,
      signal: controller.signal,
      onStop: (phase, definition) => { stopped.push(`${phase}:${definition.key}`) }
    })

    await Promise.resolve()
    await Promise.resolve()
    controller.abort()
    await expect(pending).rejects.toBeInstanceOf(CollectionCancelledError)
    expect(stopped).toEqual(['navigate:store'])
  })

  it('ignores a late operation result after its deadline has already won', async () => {
    vi.useFakeTimers()
    let resolveCapture: ((value: { key: string }) => void) | undefined
    const pending = runCollectionSequence({
      definitions: [{ key: 'store' }],
      navigate: async () => undefined,
      capture: async () => await new Promise<{ key: string }>((resolve) => { resolveCapture = resolve }),
      navigationTimeoutMs: 30,
      captureTimeoutMs: 50
    })

    const assertion = expect(pending).rejects.toBeInstanceOf(CollectionTimeoutError)
    await vi.advanceTimersByTimeAsync(50)
    await assertion
    resolveCapture?.({ key: 'store' })
    await Promise.resolve()
  })
})
