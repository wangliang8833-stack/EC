import { isAllowedAccountUrl } from '../security/navigation-policy.js'

export const MAX_WORKSPACE_TABS = 12

export function canOpenWorkspacePopup(url: string, allowedHosts: readonly string[], currentTabCount: number): boolean {
  if (!Number.isSafeInteger(currentTabCount) || currentTabCount < 1 || currentTabCount >= MAX_WORKSPACE_TABS) return false
  return url === 'about:blank' || isAllowedAccountUrl(url, [...allowedHosts])
}

export function nextWorkspaceTabId(tabIds: readonly string[], closedIndex: number): string | null {
  if (tabIds.length === 0) return null
  const nextIndex = Math.min(Math.max(0, closedIndex), tabIds.length - 1)
  return tabIds[nextIndex] ?? null
}
