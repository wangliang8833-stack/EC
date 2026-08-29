import type { WorkspaceBrowserState } from '@ecommerce/shared'
import { describe, expect, it } from 'vitest'
import { mergeWorkspaceBrowserState } from './workspace-browser-state.js'

function state(revision: number, loading: boolean): WorkspaceBrowserState {
  return {
    leaseId: 'lease_1',
    accountId: 'account_1',
    revision,
    activeTabId: 'tab_1',
    tabs: [{
      tabId: 'tab_1',
      title: '天猫商家中心',
      active: true,
      canGoBack: false,
      canGoForward: false,
      loading,
      closable: false
    }]
  }
}

describe('mergeWorkspaceBrowserState', () => {
  it('does not let an older IPC response overwrite a newer loading-complete event', () => {
    const completedEvent = state(3, false)
    const staleOpenResponse = state(2, true)

    expect(mergeWorkspaceBrowserState(completedEvent, staleOpenResponse)).toBe(completedEvent)
  })

  it('accepts the next revision for the same workspace', () => {
    const loading = state(2, true)
    const completed = state(3, false)

    expect(mergeWorkspaceBrowserState(loading, completed)).toBe(completed)
  })
})
