import type { QualityStatus } from '@ecommerce/shared'
import type { JsonStorageService } from './json-storage-service.js'

export interface LatestShopEntry {
  latest_date: string
  shop_daily_path: string
  sku_daily_path: string | null
  quality_status: QualityStatus
}

export interface LatestByShopIndex {
  schema_version: '1.0.0'
  index_type: 'latest_by_shop'
  updated_at: string
  shops: Record<string, LatestShopEntry>
}

export class JsonIndexService {
  private updateQueue: Promise<void> = Promise.resolve()
  private readonly indexPath = 'data/indexes/latest-by-shop.json'

  constructor(private readonly storage: JsonStorageService) {}

  updateLatest(shopId: string, entry: LatestShopEntry): Promise<void> {
    const update = this.updateQueue.then(async () => {
      const index = await this.readOrCreate()
      const existing = index.shops[shopId]
      if (existing && existing.latest_date > entry.latest_date) return
      index.shops[shopId] = { ...entry }
      index.updated_at = new Date().toISOString()
      await this.storage.writeJson(this.indexPath, index)
    })
    this.updateQueue = update.catch(() => undefined)
    return update
  }

  async read(): Promise<LatestByShopIndex> {
    await this.updateQueue
    return this.readOrCreate()
  }

  private async readOrCreate(): Promise<LatestByShopIndex> {
    try {
      return await this.storage.readJson<LatestByShopIndex>(this.indexPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return {
        schema_version: '1.0.0',
        index_type: 'latest_by_shop',
        updated_at: new Date(0).toISOString(),
        shops: {}
      }
    }
  }
}

