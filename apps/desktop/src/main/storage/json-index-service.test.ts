import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { JsonIndexService } from './json-index-service.js'
import { JsonStorageService } from './json-storage-service.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('JsonIndexService', () => {
  it('serializes concurrent shop updates without losing entries', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ecommerce-index-'))
    roots.push(root)
    const storage = new JsonStorageService(root)
    await storage.initialize()
    const index = new JsonIndexService(storage)

    await Promise.all([
      index.updateLatest('shop_001', {
        latest_date: '2026-08-26',
        shop_daily_path: 'data/normalized/shop_001.json',
        sku_daily_path: null,
        quality_status: 'passed'
      }),
      index.updateLatest('shop_002', {
        latest_date: '2026-08-26',
        shop_daily_path: 'data/normalized/shop_002.json',
        sku_daily_path: null,
        quality_status: 'passed_with_warning'
      })
    ])

    expect(Object.keys((await index.read()).shops).sort()).toEqual(['shop_001', 'shop_002'])
  })

  it('does not replace a newer index entry with an older date', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ecommerce-index-'))
    roots.push(root)
    const storage = new JsonStorageService(root)
    await storage.initialize()
    const index = new JsonIndexService(storage)
    await index.updateLatest('shop_001', {
      latest_date: '2026-08-26',
      shop_daily_path: 'new.json',
      sku_daily_path: null,
      quality_status: 'passed'
    })
    await index.updateLatest('shop_001', {
      latest_date: '2026-08-25',
      shop_daily_path: 'old.json',
      sku_daily_path: null,
      quality_status: 'passed'
    })
    expect((await index.read()).shops.shop_001?.shop_daily_path).toBe('new.json')
  })
})

