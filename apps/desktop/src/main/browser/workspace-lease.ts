export function ownsWorkspaceLease(currentLeaseId: string, requestedLeaseId?: string): boolean {
  return requestedLeaseId === undefined || currentLeaseId === requestedLeaseId
}

export class OpeningWorkspaceLease {
  private leaseId: string | undefined

  begin(leaseId: string): void {
    this.leaseId = leaseId
  }

  cancel(requestedLeaseId?: string): void {
    if (this.leaseId && ownsWorkspaceLease(this.leaseId, requestedLeaseId)) this.leaseId = undefined
  }

  isActive(leaseId: string): boolean {
    return this.leaseId === leaseId
  }

  finish(leaseId: string): void {
    if (this.leaseId === leaseId) this.leaseId = undefined
  }
}
