import { describe, expect, it, vi } from 'vitest'
import { flushPersistentSession } from './session-persistence.js'

describe('persistent account session', () => {
  it('flushes the cookie store before flushing DOM storage', async () => {
    const calls: string[] = []
    const flushStore = vi.fn(async () => { calls.push('cookies') })
    const flushStorageData = vi.fn(() => { calls.push('storage') })

    await flushPersistentSession({ cookies: { flushStore } as never, flushStorageData })

    expect(calls).toEqual(['cookies', 'storage'])
    expect(flushStore).toHaveBeenCalledOnce()
    expect(flushStorageData).toHaveBeenCalledOnce()
  })

  it('does not report completion when the cookie store fails to flush', async () => {
    const flushStorageData = vi.fn()

    await expect(flushPersistentSession({
      cookies: { flushStore: vi.fn(async () => { throw new Error('cookie flush failed') }) } as never,
      flushStorageData
    })).rejects.toThrow('cookie flush failed')

    expect(flushStorageData).not.toHaveBeenCalled()
  })
})
