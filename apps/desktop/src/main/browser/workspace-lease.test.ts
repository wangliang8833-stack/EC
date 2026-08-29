import { describe, expect, it } from 'vitest'
import { OpeningWorkspaceLease, ownsWorkspaceLease } from './workspace-lease.js'

describe('workspace lease ownership', () => {
  it('ignores stale StrictMode cleanup while allowing the owner and explicit navigation to close', () => {
    expect(ownsWorkspaceLease('lease-current', 'lease-stale')).toBe(false)
    expect(ownsWorkspaceLease('lease-current', 'lease-current')).toBe(true)
    expect(ownsWorkspaceLease('lease-current')).toBe(true)
  })

  it('cancels an opening workspace before it can attach after the renderer has navigated away', () => {
    const opening = new OpeningWorkspaceLease()
    opening.begin('lease-opening')

    opening.cancel('lease-opening')

    expect(opening.isActive('lease-opening')).toBe(false)
  })

  it('does not let stale cleanup cancel a newer opening workspace', () => {
    const opening = new OpeningWorkspaceLease()
    opening.begin('lease-current')

    opening.cancel('lease-stale')

    expect(opening.isActive('lease-current')).toBe(true)
    opening.finish('lease-current')
    expect(opening.isActive('lease-current')).toBe(false)
  })
})
