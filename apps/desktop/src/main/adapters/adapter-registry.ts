import type { PlatformAdapter } from '@ecommerce/shared'

export class AdapterRegistry {
  private readonly adapters = new Map<string, PlatformAdapter>()

  register(adapter: PlatformAdapter): void {
    if (this.adapters.has(adapter.platform)) {
      throw new Error(`Adapter already registered for platform ${adapter.platform}`)
    }
    this.adapters.set(adapter.platform, adapter)
  }

  get(platform: string): PlatformAdapter {
    const adapter = this.adapters.get(platform)
    if (!adapter) throw new Error(`No adapter registered for platform ${platform}`)
    return adapter
  }

  list(): ReadonlyArray<{ platform: string; version: string }> {
    return [...this.adapters.values()]
      .map(({ platform, version }) => ({ platform, version }))
      .sort((left, right) => left.platform.localeCompare(right.platform))
  }
}

