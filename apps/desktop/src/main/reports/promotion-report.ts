import { randomUUID } from 'node:crypto'
import type { ReportDataset, ReportQuery } from '@ecommerce/shared'
import type { PromotionDetailBundle } from './promotion-detail-loader.js'

export interface PromotionShopRef {
  shopId: string
  shopName: string
  platform: string
}

export function buildPromotionReport(
  query: ReportQuery,
  expectedShopCount: number,
  reports: ReportDataset[],
  shopRefs: PromotionShopRef[] = [],
  details: PromotionDetailBundle = emptyDetails()
): ReportDataset | null {
  if (reports.length === 0) return null
  const generatedAt = new Date().toISOString()
  const shopById = new Map(shopRefs.map((shop) => [shop.shopId, shop]))
  const summaryAccounts = reports.map((report) => accountRow(report, shopById.get(report.filters.shopIds[0] ?? '')))
  const accounts = details.accounts.length > 0 ? details.accounts : summaryAccounts
  const summaryCampaigns = reports.flatMap((report) => {
    const shop = shopById.get(report.filters.shopIds[0] ?? '')
    return (report.sections.campaigns ?? []).map((row) => ({
      ...row,
      shop_id: shop?.shopId ?? report.filters.shopIds[0] ?? null,
      shop_name: shop?.shopName ?? report.meta.shop_name,
      platform: shop?.platform ?? report.filters.platforms[0] ?? 'tmall',
      data_level: String(row['campaign_name'] ?? '').includes('非计划级') ? 'account_summary' : 'campaign'
    }))
  })
  const campaigns = details.campaigns.length > 0
    ? details.campaigns.map((row) => ({ ...row, data_level: 'campaign' }))
    : summaryCampaigns
  const spend = sumKnown(accounts, 'spend') ?? 0
  const clicks = sumKnown(accounts, 'clicks')
  const attributedPayAmt = sumKnown(accounts, 'transaction_amount')
  const weightedPlatformRoi = weightedAverage(accounts, 'platform_roi', 'spend')
  const warnings = new Set<string>()
  for (const report of reports) for (const warning of report.quality.warnings) warnings.add(warning)
  for (const warning of details.warnings) warnings.add(warning)
  if (campaigns.length === 0 || campaigns.every((row) => row['data_level'] === 'account_summary')) {
    warnings.add('万相台计划级明细尚未接入；当前只展示生意参谋广告账户汇总。')
  }
  if (attributedPayAmt === 0 && weightedPlatformRoi !== null && weightedPlatformRoi > 0) {
    warnings.add('广告引导成交金额为 0，但平台广告 ROI 大于 0，归因字段口径不一致，需由万相台明细核对。')
  }
  const missingShopCount = Math.max(0, expectedShopCount - reports.length)
  const qualityWarnings = [...warnings]
  const alerts: Array<Record<string, string | number | null>> = qualityWarnings.map((detail, index) => ({
    level: index === qualityWarnings.length - 1 && detail.includes('口径不一致') ? 'warning' : 'info',
    title: detail.includes('口径不一致') ? '归因口径待核对' : detail.includes('计划级') ? '推广明细待接入' : '数据覆盖说明',
    detail
  }))
  const trend = reports.map((report) => ({
    date: report.meta.biz_date,
    spend: nullable(report.summary['ad_spend']),
    clicks: campaignClicks(report),
    transaction_amount: nullable(report.summary['ad_pay_amt']),
    platform_roi: nullable(report.summary['platform_ad_roi'])
  }))

  return {
    schema_version: '1.0.0',
    report_type: query.reportType,
    dataset_id: `promotion_${randomUUID().replaceAll('-', '')}`,
    filters: query,
    meta: {
      shop_name: reports.length === 1 ? reports[0]!.meta.shop_name : `${reports.length} 家店铺`,
      date_range: query.dateStart === query.dateEnd ? query.dateEnd : `${query.dateStart}—${query.dateEnd}`,
      updated_at: generatedAt,
      biz_date: query.dateEnd,
      data_status: 'real',
      collection_status: 'completed',
      normalizer_version: 'promotion-0.1.0',
      data_finality: reports.every((report) => report.meta.data_finality === 'final') ? 'final' : 'realtime'
    },
    summary: {
      spend,
      clicks,
      impressions: null,
      ctr: null,
      cpc: clicks !== null && clicks > 0 ? spend / clicks : null,
      transaction_amount: attributedPayAmt,
      transaction_order_count: null,
      conversion_rate: null,
      roi: weightedPlatformRoi,
      store_pay_amt: sumKnown(reports.map(({ summary }) => summary), 'pay_amt'),
      store_order_count: sumKnown(reports.map(({ summary }) => summary), 'pay_order_count'),
      account_count: accounts.length,
      campaign_detail_count: campaigns.filter((row) => row['data_level'] === 'campaign').length
    },
    trend,
    shop_rows: campaigns,
    sections: {
      channels: [],
      keywords: [],
      campaigns,
      alerts,
      service: [],
      promotion_accounts: accounts,
      promotion_campaigns: campaigns,
      promotion_items: details.items,
      promotion_keywords: details.keywords,
      promotion_crowds: details.crowds,
      promotion_creatives: details.creatives,
      promotion_regions: details.regions,
      promotion_hourly: details.hourly
    },
    quality: {
      complete_shop_count: reports.length,
      missing_shop_count: missingShopCount,
      warning_count: qualityWarnings.length,
      status: missingShopCount === 0 && campaigns.some((row) => row['data_level'] === 'campaign') ? 'complete' : 'partial',
      dataset_count: 1 + Number(campaigns.length > 0),
      warnings: qualityWarnings
    },
    source_paths: [...new Set([...reports.flatMap((report) => report.source_paths), ...details.sourcePaths])],
    generated_at: generatedAt
  }
}

function accountRow(report: ReportDataset, shop?: PromotionShopRef): Record<string, string | number | null> {
  return {
    biz_date: report.meta.biz_date,
    shop_id: shop?.shopId ?? report.filters.shopIds[0] ?? null,
    shop_name: shop?.shopName ?? report.meta.shop_name,
    platform: shop?.platform ?? report.filters.platforms[0] ?? 'tmall',
    biz_code: 'account',
    attribution_type: null,
    effect_days: null,
    data_finality: report.meta.data_finality ?? null,
    spend: nullable(report.summary['ad_spend']),
    clicks: campaignClicks(report),
    impressions: null,
    ctr: null,
    cpc: campaignClicks(report) !== null && campaignClicks(report)! > 0 && nullable(report.summary['ad_spend']) !== null
      ? nullable(report.summary['ad_spend'])! / campaignClicks(report)!
      : null,
    transaction_amount: nullable(report.summary['ad_pay_amt']),
    transaction_order_count: null,
    conversion_rate: null,
    platform_roi: nullable(report.summary['platform_ad_roi']),
    store_pay_amt: nullable(report.summary['pay_amt']),
    store_order_count: nullable(report.summary['pay_order_count']),
    source_level: 'sycm_account_summary'
  }
}

function campaignClicks(report: ReportDataset): number | null {
  return sumKnown(report.sections.campaigns ?? [], 'clicks')
}

function sumKnown(rows: Array<Record<string, unknown>>, key: string): number | null {
  let total = 0
  let known = false
  for (const row of rows) {
    const value = nullable(row[key])
    if (value === null) continue
    known = true
    total += value
  }
  return known ? total : null
}

function weightedAverage(rows: Array<Record<string, unknown>>, valueKey: string, weightKey: string): number | null {
  let weighted = 0
  let weightTotal = 0
  for (const row of rows) {
    const value = nullable(row[valueKey]) ?? (valueKey === 'platform_roi' ? nullable(row['roi']) : null)
    const weight = nullable(row[weightKey])
    if (value === null || weight === null || weight <= 0) continue
    weighted += value * weight
    weightTotal += weight
  }
  return weightTotal > 0 ? weighted / weightTotal : null
}

function nullable(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function emptyDetails(): PromotionDetailBundle {
  return { accounts: [], campaigns: [], items: [], keywords: [], crowds: [], creatives: [], regions: [], hourly: [], sourcePaths: [], warnings: [] }
}
