import { describe, expect, it } from 'vitest'
import type { AccountConfig } from '@ecommerce/shared'
import type { JsonStorageService } from '../storage/json-storage-service.js'
import { loadPromotionDetails, validatePromotionDataset } from './promotion-detail-loader.js'

const account: AccountConfig = {
  schema_version: '1.0.0', account_id: 'acc_xian', platform: 'tmall', shop_id: 'TEST_SHOP_1', shop_name: '示例店铺1', subaccount_name: '示例子账号1', owner: '',
  session_partition: 'persist:account-acc_xian', credential_ref: null, login_url: 'https://login.taobao.com', allowed_hosts: ['alimama.com'], enabled: true, login_status: 'authenticated', last_login_checked_at: null,
  created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z'
}

describe('validatePromotionDataset', () => {
  it('accepts a matching normalized dataset and preserves primitive fields', () => {
    const result = validatePromotionDataset(envelope(), 'promotion_campaign_daily', account, '2026-08-31')
    expect(result.valid).toBe(true)
    expect(result.rows).toEqual([{ campaign_id: 'c1', campaign_name: '核心计划', spend: 12.34, nested: null }])
  })

  it('rejects cross-shop and cross-date files', () => {
    const value = envelope()
    value.shop_id = 'T9999'
    value.biz_date = '2026-08-30'
    const result = validatePromotionDataset(value, 'promotion_campaign_daily', account, '2026-08-31')
    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining(['店铺 ID 与目标账号不一致', '业务日期与查询日期不一致']))
    expect(result.rows).toEqual([])
  })
})

describe('loadPromotionDetails', () => {
  it('loads available files and skips missing datasets', async () => {
    const storage: Pick<JsonStorageService, 'readJson'> = { readJson: async <T>(path: string): Promise<T> => {
      if (path.endsWith('/promotion_campaign_daily.json')) return envelope() as T
      throw Object.assign(new Error('missing'), { code: 'ENOENT' })
    } }
    const result = await loadPromotionDetails(storage, account, '2026-08-31')
    expect(result.campaigns).toHaveLength(1)
    expect(result.sourcePaths[0]).toContain('promotion_campaign_daily.json')
    expect(result.warnings).toEqual(['计划数据来自万相台。'])
  })
})

function envelope(): Record<string, unknown> {
  return {
    schema_version: '1.0.0', dataset: 'promotion_campaign_daily', platform: 'tmall', shop_id: 'TEST_SHOP_1', shop_name: '示例店铺1', account_id: 'acc_xian', biz_date: '2026-08-31',
    rows: [{ campaign_id: 'c1', campaign_name: '核心计划', spend: 12.34, nested: null, ignored: { value: 1 } }], quality: { status: 'complete', warnings: ['计划数据来自万相台。'] }
  }
}
