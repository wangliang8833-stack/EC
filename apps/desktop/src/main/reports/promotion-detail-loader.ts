import type { AccountConfig } from '@ecommerce/shared'
import type { JsonStorageService } from '../storage/json-storage-service.js'

const DATASET_NAMES = [
  'promotion_account_daily',
  'promotion_campaign_daily',
  'promotion_item_daily',
  'promotion_keyword_daily',
  'promotion_crowd_daily',
  'promotion_creative_daily',
  'promotion_region_daily',
  'promotion_account_hourly'
] as const

type PromotionDatasetName = (typeof DATASET_NAMES)[number]

export interface PromotionDetailBundle {
  accounts: Array<Record<string, string | number | null>>
  campaigns: Array<Record<string, string | number | null>>
  items: Array<Record<string, string | number | null>>
  keywords: Array<Record<string, string | number | null>>
  crowds: Array<Record<string, string | number | null>>
  creatives: Array<Record<string, string | number | null>>
  regions: Array<Record<string, string | number | null>>
  hourly: Array<Record<string, string | number | null>>
  sourcePaths: string[]
  warnings: string[]
}

export function mergePromotionDetailBundles(bundles: PromotionDetailBundle[]): PromotionDetailBundle {
  const result = emptyBundle()
  for (const bundle of bundles) {
    result.accounts.push(...bundle.accounts)
    result.campaigns.push(...bundle.campaigns)
    result.items.push(...bundle.items)
    result.keywords.push(...bundle.keywords)
    result.crowds.push(...bundle.crowds)
    result.creatives.push(...bundle.creatives)
    result.regions.push(...bundle.regions)
    result.hourly.push(...bundle.hourly)
    result.sourcePaths.push(...bundle.sourcePaths)
    result.warnings.push(...bundle.warnings)
  }
  result.sourcePaths = [...new Set(result.sourcePaths)]
  result.warnings = [...new Set(result.warnings)]
  return result
}

export async function loadPromotionDetails(storage: Pick<JsonStorageService, 'readJson'>, account: AccountConfig, bizDate: string): Promise<PromotionDetailBundle> {
  const result = emptyBundle()
  const [year, month, day] = bizDate.split('-')
  if (!year || !month || !day) throw new TypeError('bizDate must use YYYY-MM-DD')
  for (const dataset of DATASET_NAMES) {
    const path = ['data/normalized', 'tmall', account.shop_id, account.account_id, year, month, day, `${dataset}.json`].join('/')
    let value: unknown
    try {
      value = await storage.readJson<unknown>(path)
    } catch (error) {
      if (isMissingFile(error)) continue
      result.warnings.push(`${dataset} 读取失败：${error instanceof Error ? error.message : String(error)}`)
      continue
    }
    const validation = validatePromotionDataset(value, dataset, account, bizDate)
    if (!validation.valid) {
      result.warnings.push(`${dataset} 已隔离：${validation.errors.join('；')}`)
      continue
    }
    collection(result, dataset).push(...validation.rows)
    result.sourcePaths.push(path)
    result.warnings.push(...validation.warnings)
  }
  return result
}

export function validatePromotionDataset(value: unknown, expectedDataset: PromotionDatasetName, account: AccountConfig, bizDate: string): { valid: boolean; rows: Array<Record<string, string | number | null>>; warnings: string[]; errors: string[] } {
  const warnings: string[] = []
  const errors: string[] = []
  if (!isRecord(value)) return { valid: false, rows: [], warnings, errors: ['文件根节点必须是对象'] }
  if (value['dataset'] !== expectedDataset) errors.push(`数据集名称应为 ${expectedDataset}`)
  if (value['platform'] !== 'tmall') errors.push('平台必须为 tmall')
  if (value['shop_id'] !== account.shop_id) errors.push('店铺 ID 与目标账号不一致')
  if (value['account_id'] !== account.account_id) errors.push('账号 ID 与目标账号不一致')
  if (value['biz_date'] !== bizDate) errors.push('业务日期与查询日期不一致')
  if (!Array.isArray(value['rows'])) errors.push('rows 必须是数组')
  const rows = Array.isArray(value['rows']) ? value['rows'].filter(isRecord).map(primitiveRow) : []
  if (Array.isArray(value['rows']) && rows.length !== value['rows'].length) warnings.push(`${expectedDataset} 忽略了非对象行`)
  if (isRecord(value['quality']) && Array.isArray(value['quality']['warnings'])) {
    warnings.push(...value['quality']['warnings'].filter((entry): entry is string => typeof entry === 'string'))
  }
  return { valid: errors.length === 0, rows: errors.length === 0 ? rows : [], warnings, errors }
}

function collection(result: PromotionDetailBundle, dataset: PromotionDatasetName): Array<Record<string, string | number | null>> {
  if (dataset === 'promotion_account_daily') return result.accounts
  if (dataset === 'promotion_campaign_daily') return result.campaigns
  if (dataset === 'promotion_item_daily') return result.items
  if (dataset === 'promotion_keyword_daily') return result.keywords
  if (dataset === 'promotion_crowd_daily') return result.crowds
  if (dataset === 'promotion_creative_daily') return result.creatives
  if (dataset === 'promotion_region_daily') return result.regions
  return result.hourly
}

function emptyBundle(): PromotionDetailBundle {
  return { accounts: [], campaigns: [], items: [], keywords: [], crowds: [], creatives: [], regions: [], hourly: [], sourcePaths: [], warnings: [] }
}

function primitiveRow(row: Record<string, unknown>): Record<string, string | number | null> {
  const result: Record<string, string | number | null> = {}
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === 'string' || typeof value === 'number' || value === null) result[key] = value
  }
  return result
}

function isMissingFile(error: unknown): boolean { return isRecord(error) && error['code'] === 'ENOENT' }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
