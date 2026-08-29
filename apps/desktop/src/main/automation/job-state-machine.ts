import type { JobStatus } from '@ecommerce/shared'

const allowedTransitions: Readonly<Record<JobStatus, readonly JobStatus[]>> = {
  PENDING: ['QUEUED', 'CANCELLED'],
  QUEUED: ['RUNNING', 'CANCELLED'],
  RUNNING: [
    'SUCCESS',
    'PARTIAL_SUCCESS',
    'NEED_HUMAN_LOGIN',
    'PAGE_CHANGED',
    'DOWNLOAD_FAILED',
    'DATA_VALIDATION_FAILED',
    'RETRYING',
    'CANCELLED'
  ],
  SUCCESS: [],
  PARTIAL_SUCCESS: [],
  NEED_HUMAN_LOGIN: ['RETRYING', 'DEAD_LETTER', 'CANCELLED'],
  PAGE_CHANGED: ['RETRYING', 'DEAD_LETTER', 'CANCELLED'],
  DOWNLOAD_FAILED: ['RETRYING', 'DEAD_LETTER', 'CANCELLED'],
  DATA_VALIDATION_FAILED: ['RETRYING', 'DEAD_LETTER', 'CANCELLED'],
  RETRYING: ['QUEUED', 'DEAD_LETTER', 'CANCELLED'],
  CANCELLED: [],
  DEAD_LETTER: []
}

export interface JobStatusChange {
  from: JobStatus
  to: JobStatus
  changedAt: string
  reason: string
}

export class InvalidJobTransitionError extends Error {
  constructor(from: JobStatus, to: JobStatus) {
    super(`Invalid job status transition: ${from} -> ${to}`)
    this.name = 'InvalidJobTransitionError'
  }
}

export class JobStateMachine {
  private current: JobStatus
  private readonly changes: JobStatusChange[] = []

  constructor(initial: JobStatus = 'PENDING') {
    this.current = initial
  }

  get status(): JobStatus {
    return this.current
  }

  get history(): readonly JobStatusChange[] {
    return this.changes.map((change) => ({ ...change }))
  }

  canTransition(to: JobStatus): boolean {
    return allowedTransitions[this.current].includes(to)
  }

  transition(to: JobStatus, reason: string, changedAt = new Date().toISOString()): JobStatusChange {
    if (!this.canTransition(to)) {
      throw new InvalidJobTransitionError(this.current, to)
    }
    const change: JobStatusChange = { from: this.current, to, changedAt, reason }
    this.current = to
    this.changes.push(change)
    return { ...change }
  }
}

