import type { WorkspaceBrowserState } from '@ecommerce/shared'

export function mergeWorkspaceBrowserState(
  current: WorkspaceBrowserState | null,
  incoming: WorkspaceBrowserState
): WorkspaceBrowserState {
  if (
    current &&
    current.leaseId === incoming.leaseId &&
    current.accountId === incoming.accountId &&
    current.revision > incoming.revision
  ) return current
  return incoming
}
