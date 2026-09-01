import type { DataUpdateRequest, DataUpdateResult, ReportDataset, ReportQuery } from '@ecommerce/shared'

export interface PromotionRefreshApi {
  update: (request: DataUpdateRequest) => Promise<DataUpdateResult>
  query: (query: ReportQuery) => Promise<ReportDataset>
}

export interface PromotionRefreshInput {
  bizDate: string
  shopIds: string[]
}

export interface PromotionRefreshOutput {
  update: DataUpdateResult
  dataset: ReportDataset
}

export type PromotionRefreshStage = 'collecting' | 'querying'
export type PromotionNotice = { type: 'success' | 'info' | 'warning' | 'error'; title: string; description: string }

export class PromotionRefreshQueryError extends Error {
  constructor(readonly update: DataUpdateResult, cause: unknown) {
    super(`采集已完成，但推广报表重新读取失败：${cause instanceof Error ? cause.message : String(cause)}`, { cause })
    this.name = 'PromotionRefreshQueryError'
  }
}

export function buildPromotionRefreshStageNotice(stage: PromotionRefreshStage, bizDate: string, shopCount: number, update?: DataUpdateResult): PromotionNotice {
  if (stage === 'collecting') {
    return { type: 'info', title: `正在更新推广汇总 · ${bizDate}`, description: `正在强制重新采集 ${shopCount} 家天猫店铺，请保持账号登录并等待任务完成。` }
  }
  return {
    type: 'info',
    title: `采集完成，正在刷新报表 · ${bizDate}`,
    description: `采集结果：更新 ${update?.updated ?? 0}、跳过 ${update?.skipped ?? 0}、待登录 ${update?.needLogin ?? 0}、失败 ${update?.failed ?? 0}。正在重新读取推广数据。`
  }
}

export function buildPromotionRefreshCompletedNotice(update: DataUpdateResult, dataset: ReportDataset): PromotionNotice {
  const accountCount = dataset.sections.promotion_accounts?.length ?? 0
  const spend = finiteNumber(dataset.summary['spend'])
  const shopDetails = update.shops.map((shop) => `${shop.shopName}：${updateStatusLabel(shop.status)}${shop.warning ? `（${shop.warning}）` : ''}`).join('；')
  const counts = `更新 ${update.updated}、跳过 ${update.skipped}、待登录 ${update.needLogin}、失败 ${update.failed}`
  const report = `报表已读取 ${accountCount} 家账户，广告消耗 ${spend === null ? '—' : formatMoney(spend)}，生成时间 ${formatTimestamp(dataset.generated_at)}。`
  if (update.total === 0) return { type: 'warning', title: `未找到可更新店铺 · ${update.bizDate}`, description: `${counts}。请确认所选店铺已启用且平台为天猫。${report}` }
  if (update.failed > 0 || update.needLogin > 0) return { type: 'warning', title: `推广汇总部分更新 · ${update.bizDate}`, description: `${counts}。${report}${shopDetails ? ` ${shopDetails}` : ''}` }
  if (update.updated === 0 || accountCount === 0) return { type: 'warning', title: `推广汇总未产生新数据 · ${update.bizDate}`, description: `${counts}。${report}${shopDetails ? ` ${shopDetails}` : ''}` }
  return { type: 'success', title: `推广汇总已更新 · ${update.bizDate}`, description: `${counts}。${report}${shopDetails ? ` ${shopDetails}` : ''}` }
}

export async function refreshPromotionSummary(
  api: PromotionRefreshApi,
  input: PromotionRefreshInput,
  onStage?: (stage: PromotionRefreshStage, update?: DataUpdateResult) => void
): Promise<PromotionRefreshOutput> {
  onStage?.('collecting')
  const update = await api.update({ bizDate: input.bizDate, platforms: ['tmall'], shopIds: input.shopIds, forceRefresh: true })
  onStage?.('querying', update)
  let dataset: ReportDataset
  try {
    dataset = await api.query({
      reportType: 'tmall_promotion_report',
      dateStart: input.bizDate,
      dateEnd: input.bizDate,
      platforms: ['tmall'],
      shopIds: input.shopIds,
      ownerIds: []
    })
  } catch (error) {
    throw new PromotionRefreshQueryError(update, error)
  }
  return { update, dataset }
}

function updateStatusLabel(status: DataUpdateResult['shops'][number]['status']): string {
  if (status === 'SUCCESS') return '更新成功'
  if (status === 'ALREADY_COLLECTED') return '已有数据'
  if (status === 'NEED_HUMAN_LOGIN') return '需要登录'
  return '更新失败'
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function formatMoney(value: number): string {
  return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value)
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString('zh-CN', { hour12: false }) : value
}
