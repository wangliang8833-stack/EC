import { describe, expect, it } from 'vitest'
import { InvalidJobTransitionError, JobStateMachine } from './job-state-machine.js'

describe('JobStateMachine', () => {
  it('supports the successful execution path', () => {
    const machine = new JobStateMachine()
    machine.transition('QUEUED', 'scheduled')
    machine.transition('RUNNING', 'worker acquired account lock')
    machine.transition('SUCCESS', 'all data persisted')

    expect(machine.status).toBe('SUCCESS')
    expect(machine.history.map(({ to }) => to)).toEqual(['QUEUED', 'RUNNING', 'SUCCESS'])
  })

  it('supports retry followed by dead-letter', () => {
    const machine = new JobStateMachine('RUNNING')
    machine.transition('DOWNLOAD_FAILED', 'download timed out')
    machine.transition('RETRYING', 'retry policy has attempts remaining')
    machine.transition('DEAD_LETTER', 'attempts exhausted')
    expect(machine.status).toBe('DEAD_LETTER')
  })

  it('rejects impossible and terminal transitions', () => {
    const machine = new JobStateMachine()
    expect(() => machine.transition('SUCCESS', 'skipped execution')).toThrow(InvalidJobTransitionError)

    machine.transition('CANCELLED', 'cancelled by user')
    expect(() => machine.transition('QUEUED', 'cannot reopen terminal task')).toThrow(InvalidJobTransitionError)
  })
})

