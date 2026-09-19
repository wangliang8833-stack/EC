import { CollectionCancelledError } from '../adapters/tmall/collection-execution.js'

interface Waiter {
  keys: string[]
  priority: number
  start: () => void
  cancel: () => void
}

/** One admission point for manual, scheduled and historical collection. */
export class CollectionCoordinator {
  private readonly busy = new Set<string>()
  private readonly queue: Waiter[] = []
  private stopped = false

  async run<T>(keys: string[], operation: () => Promise<T>, signal?: AbortSignal, priority = 1): Promise<T> {
    if (this.stopped || signal?.aborted) throw new CollectionCancelledError('collection')
    const release = await new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = {
        keys: [...new Set(keys)], priority,
        start: () => {
          signal?.removeEventListener('abort', waiter.cancel)
          for (const key of waiter.keys) this.busy.add(key)
          resolve(() => {
            for (const key of waiter.keys) this.busy.delete(key)
            this.drain()
          })
        },
        cancel: () => {
          const index = this.queue.indexOf(waiter)
          if (index !== -1) this.queue.splice(index, 1)
          signal?.removeEventListener('abort', waiter.cancel)
          reject(new CollectionCancelledError('collection'))
        }
      }
      signal?.addEventListener('abort', waiter.cancel, { once: true })
      this.queue.push(waiter)
      this.queue.sort((left, right) => right.priority - left.priority)
      this.drain()
    })
    try {
      if (signal?.aborted || this.stopped) throw new CollectionCancelledError('collection')
      return await operation()
    } finally { release() }
  }

  stop(): void {
    this.stopped = true
    for (const waiter of [...this.queue]) waiter.cancel()
  }

  private drain(): void {
    if (this.stopped) return
    for (const waiter of [...this.queue]) {
      if (waiter.keys.some(key => this.busy.has(key))) continue
      this.queue.splice(this.queue.indexOf(waiter), 1)
      waiter.start()
    }
  }
}
