import { describe, expect, it } from 'vitest'
import { canOpenWorkspacePopup, MAX_WORKSPACE_TABS, nextWorkspaceTabId } from './workspace-tab-policy.js'

describe('workspace tab policy', () => {
  it('allows only account-whitelisted HTTPS popups and controlled blank tabs', () => {
    const allowedHosts = ['taobao.com', 'tmall.com']
    expect(canOpenWorkspacePopup('https://sycm.taobao.com/', allowedHosts, 1)).toBe(true)
    expect(canOpenWorkspacePopup('about:blank', allowedHosts, 1)).toBe(true)
    expect(canOpenWorkspacePopup('http://sycm.taobao.com/', allowedHosts, 1)).toBe(false)
    expect(canOpenWorkspacePopup('https://taobao.com.evil.example/', allowedHosts, 1)).toBe(false)
  })

  it('enforces the per-account tab cap', () => {
    expect(canOpenWorkspacePopup('https://sycm.taobao.com/', ['taobao.com'], MAX_WORKSPACE_TABS - 1)).toBe(true)
    expect(canOpenWorkspacePopup('https://sycm.taobao.com/', ['taobao.com'], MAX_WORKSPACE_TABS)).toBe(false)
  })

  it('selects the adjacent tab after an active tab closes', () => {
    expect(nextWorkspaceTabId(['a', 'c'], 1)).toBe('c')
    expect(nextWorkspaceTabId(['a', 'b'], 2)).toBe('b')
    expect(nextWorkspaceTabId([], 0)).toBeNull()
  })
})
