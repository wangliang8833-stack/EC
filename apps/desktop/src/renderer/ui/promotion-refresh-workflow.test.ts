import type { DataUpdateResult, ReportDataset } from '@ecommerce/shared'
import { describe, expect, it, vi } from 'vitest'
import { buildPromotionRefreshCompletedNotice, buildPromotionRefreshStageNotice, PromotionRefreshQueryError, refreshPromotionSummary } from './promotion-refresh-workflow.js'

describe('promotion report refresh workflow', () => {
  it('forces source collection and returns the newly queried promotion dataset', async () => {
    const updateResult = updateResultFixture()
    const refreshedDataset = datasetFixture(268.5)
    const update = vi.fn(async () => updateResult)
    const query = vi.fn(async () => refreshedDataset)
    const stages: string[] = []

    const result = await refreshPromotionSummary({ update, query }, { bizDate: '2026-08-31', shopIds: ['TEST_SHOP_1'] }, (stage) => stages.push(stage))

    expect(update).toHaveBeenCalledWith({ bizDate: '2026-08-31', platforms: ['tmall'], shopIds: ['TEST_SHOP_1'], forceRefresh: true })
    expect(query).toHaveBeenCalledWith({ reportType: 'tmall_promotion_report', dateStart: '2026-08-31', dateEnd: '2026-08-31', platforms: ['tmall'], shopIds: ['TEST_SHOP_1'], ownerIds: [] })
    expect(result.dataset?.summary['spend']).toBe(268.5)
    expect(stages).toEqual(['collecting', 'querying'])
  })

  it('preserves the completed collection result when the follow-up report query fails', async () => {
    const updateResult = updateResultFixture()
    const promise = refreshPromotionSummary({ update: async () => updateResult, query: async () => { throw new Error('report read failed') } }, { bizDate: '2026-08-31', shopIds: ['TEST_SHOP_1'] })

    await expect(promise).rejects.toMatchObject({ name: 'PromotionRefreshQueryError', update: updateResult })
    await expect(promise).rejects.toBeInstanceOf(PromotionRefreshQueryError)
  })

  it('builds visible progress and completion details for the report page', () => {
    expect(buildPromotionRefreshStageNotice('collecting', '2026-08-31', 4)).toMatchObject({ type: 'info', title: '正在更新推广汇总 · 2026-08-31' })

    const notice = buildPromotionRefreshCompletedNotice(updateResultFixture(), datasetFixture(268.5))
    expect(notice.type).toBe('success')
    expect(notice.title).toBe('推广汇总已更新 · 2026-08-31')
    expect(notice.description).toContain('报表已读取 1 家账户，广告消耗 ¥268.50')
    expect(notice.description).toContain('示例店铺1：更新成功')
  })
})

function updateResultFixture(): DataUpdateResult {
  return {
    bizDate: '2026-08-31', timezone: 'Asia/Shanghai', startedAt: '2026-09-01T01:00:00.000Z', completedAt: '2026-09-01T01:00:01.000Z',
    total: 1, updated: 1, skipped: 0, needLogin: 0, failed: 0,
    shops: [{ accountId: 'acc_xian', shopId: 'TEST_SHOP_1', shopName: '示例店铺1', platform: 'tmall', status: 'SUCCESS', warning: null }]
  }
}

function datasetFixture(spend: number): ReportDataset {
  return {
    schema_version: '1.0.0', report_type: 'tmall_promotion_report', dataset_id: 'promotion-after-refresh',
    filters: { reportType: 'tmall_promotion_report', dateStart: '2026-08-31', dateEnd: '2026-08-31', platforms: ['tmall'], shopIds: ['TEST_SHOP_1'], ownerIds: [] },
    meta: { shop_name: '示例店铺1', date_range: '2026-08-31', updated_at: '2026-09-01T01:00:01.000Z', biz_date: '2026-08-31', data_status: 'real', collection_status: 'completed', data_finality: 'final' },
    summary: { spend }, trend: [{ date: '2026-08-31', spend }], shop_rows: [], sections: { channels: [], keywords: [], campaigns: [], alerts: [], service: [], promotion_accounts: [{ shop_id: 'TEST_SHOP_1', shop_name: '示例店铺1', spend }] },
    quality: { complete_shop_count: 1, missing_shop_count: 0, warning_count: 0, status: 'complete', dataset_count: 1, warnings: [] }, source_paths: [], generated_at: '2026-09-01T01:00:01.000Z'
  }
}
