import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Segmented, Select, Tag } from 'antd'
import type { AccountSummary, DataUpdateResult, ReportDataset } from '@ecommerce/shared'
import { EChart, type DashboardChartOption } from './EChart.js'
import type { NotificationInput } from './notifications.js'
import { buildPromotionRefreshCompletedNotice, buildPromotionRefreshStageNotice, PromotionRefreshQueryError, refreshPromotionSummary, type PromotionNotice } from './promotion-refresh-workflow.js'
import './promotion-report.css'

type PromotionView = 'overview' | 'campaigns' | 'quality'

export function PromotionReport({ accounts, isPreview, onNotify }: { accounts: AccountSummary[]; isPreview: boolean; onNotify: (notification: NotificationInput) => void }): React.JSX.Element {
  const [dataset, setDataset] = useState<ReportDataset | null>(null)
  const [selectedDate, setSelectedDate] = useState(shanghaiYesterday)
  const [shopFilter, setShopFilter] = useState('all')
  const [view, setView] = useState<PromotionView>('overview')
  const [loading, setLoading] = useState(!isPreview)
  const [updating, setUpdating] = useState(false)
  const [queryNotice, setQueryNotice] = useState<PromotionNotice | null>(null)
  const [updateNotice, setUpdateNotice] = useState<PromotionNotice | null>(null)
  const querySequence = useRef(0)
  const today = shanghaiToday()
  const tmallAccounts = useMemo(() => [...new Map(accounts.filter(({ enabled, platform }) => enabled && platform === 'tmall').map((account) => [account.shopId, account])).values()], [accounts])
  const filteredAccounts = shopFilter === 'all' ? tmallAccounts : tmallAccounts.filter(({ accountId }) => `shop:${accountId}` === shopFilter)
  const accountSignature = filteredAccounts.map(({ accountId, shopId }) => `${accountId}:${shopId}`).sort().join('|')
  const filterOptions = [
    { value: 'all', label: `所有天猫店铺（${tmallAccounts.length} 家）` },
    ...tmallAccounts.map((account) => ({ value: `shop:${account.accountId}`, label: account.shopName }))
  ]

  useEffect(() => {
    if (shopFilter !== 'all' && filteredAccounts.length === 0) setShopFilter('all')
  }, [accountSignature, shopFilter])
  useEffect(() => { setQueryNotice(null); setUpdateNotice(null) }, [selectedDate, shopFilter])
  useEffect(() => {
    const sequence = ++querySequence.current
    if (isPreview) { setDataset(previewDataset()); setLoading(false); return }
    if (!window.desktopApi || filteredAccounts.length === 0) { setDataset(null); setLoading(false); return }
    setLoading(true)
    window.desktopApi.reports.query({
      reportType: 'tmall_promotion_report', dateStart: selectedDate, dateEnd: selectedDate,
      platforms: ['tmall'], shopIds: filteredAccounts.map(({ shopId }) => shopId), ownerIds: []
    }).then((nextDataset) => { if (sequence === querySequence.current) setDataset(nextDataset) }).catch((reason: unknown) => {
      if (sequence !== querySequence.current) return
      const description = errorMessage(reason)
      setQueryNotice({ type: 'error', title: `推广数据读取失败 · ${selectedDate}`, description })
      onNotify({ id: `promotion-report:query:${selectedDate}:${shopFilter}`, tone: 'error', title: '推广报表读取失败', description })
    }).finally(() => { if (sequence === querySequence.current) setLoading(false) })
    return () => { if (sequence === querySequence.current) querySequence.current += 1 }
  }, [accountSignature, isPreview, selectedDate])

  async function refreshSummary(): Promise<void> {
    if (isPreview || !window.desktopApi || filteredAccounts.length === 0) return
    setUpdating(true)
    querySequence.current += 1
    setQueryNotice(null)
    setUpdateNotice(buildPromotionRefreshStageNotice('collecting', selectedDate, filteredAccounts.length))
    try {
      const shopIds = filteredAccounts.map(({ shopId }) => shopId)
      const refreshed = await refreshPromotionSummary(window.desktopApi.reports, { bizDate: selectedDate, shopIds }, (stage, update) => setUpdateNotice(buildPromotionRefreshStageNotice(stage, selectedDate, filteredAccounts.length, update)))
      setDataset(refreshed.dataset)
      const notice = buildPromotionRefreshCompletedNotice(refreshed.update, refreshed.dataset)
      setUpdateNotice(notice)
      onNotify({ id: `promotion-report:update:${selectedDate}:${shopFilter}`, tone: notice.type === 'success' ? 'success' : notice.type === 'error' ? 'error' : 'warning', title: notice.title, description: notice.description })
    } catch (reason) {
      const description = errorMessage(reason)
      const title = reason instanceof PromotionRefreshQueryError ? `采集完成，但推广报表刷新失败 · ${selectedDate}` : `推广汇总更新失败 · ${selectedDate}`
      const statusDescription = reason instanceof PromotionRefreshQueryError ? `${updateCountText(reason.update)}。${description}` : description
      setUpdateNotice({ type: 'error', title, description: statusDescription })
      onNotify({ id: `promotion-report:update-error:${selectedDate}:${shopFilter}`, tone: 'error', title, description: statusDescription })
    } finally {
      setUpdating(false)
    }
  }

  const rows = dataset?.sections.promotion_campaigns ?? dataset?.sections.campaigns ?? []
  const accountRows = dataset?.sections.promotion_accounts ?? []
  const summary = dataset?.summary ?? {}
  const detailCount = number(summary['campaign_detail_count']) ?? 0
  const coverage = dataset?.quality.status ?? 'empty'

  return <div className="promotion-report-page">
    <section className="promotion-toolbar">
      <div className="promotion-filter"><label htmlFor="promotion-shop">店铺筛选</label><Select id="promotion-shop" value={shopFilter} options={filterOptions} disabled={updating || tmallAccounts.length === 0} onChange={setShopFilter} /></div>
      <div className="promotion-filter promotion-date"><label htmlFor="promotion-date">数据日期</label><input id="promotion-date" type="date" value={selectedDate} max={today} disabled={updating} onChange={(event) => event.target.value && setSelectedDate(event.target.value)} /><Button size="small" disabled={updating || selectedDate === today} onClick={() => setSelectedDate(today)}>今天</Button><Button size="small" disabled={updating || selectedDate === shanghaiYesterday()} onClick={() => setSelectedDate(shanghaiYesterday())}>昨天</Button></div>
      <Button type="primary" loading={updating} disabled={isPreview || loading || filteredAccounts.length === 0} onClick={() => void refreshSummary()}>更新推广汇总</Button>
    </section>
    {updateNotice ? <Alert className="promotion-alert" type={updateNotice.type} showIcon closable={!updating} title={updateNotice.title} description={updateNotice.description} onClose={() => setUpdateNotice(null)} /> : null}
    {queryNotice ? <Alert className="promotion-alert" type={queryNotice.type} showIcon closable title={queryNotice.title} description={queryNotice.description} onClose={() => setQueryNotice(null)} /> : null}
    <div className={`promotion-coverage ${coverage}`}>
      <strong>数据口径</strong><span className="promotion-source real">生意参谋真实汇总</span><span>{accountRows.length} 家账户</span><span className="promotion-source pending">万相台待接入</span><span>计划、商品、关键词、人群、创意、地域、小时明细</span>
    </div>
    <Segmented<PromotionView> className="promotion-switch" block value={view} options={[{ label: '决策总览', value: 'overview' }, { label: `计划明细${detailCount > 0 ? `（${detailCount}）` : ''}`, value: 'campaigns' }, { label: '数据质量', value: 'quality' }]} onChange={setView} />
    {loading ? <PromotionEmpty title={`正在读取 ${selectedDate} 推广数据…`} description="数据仅从本地报表数据集加载。" /> : tmallAccounts.length === 0 && !isPreview ? <PromotionEmpty title="尚未配置可用天猫店铺" description="请先添加并启用天猫账号。" /> : !dataset || dataset.meta.data_status === 'empty' ? <PromotionEmpty title={`${selectedDate} 尚无推广汇总`} description="点击“更新推广汇总”采集所选店铺数据。" /> : view === 'overview' ? <Overview dataset={dataset} /> : view === 'campaigns' ? <Campaigns rows={rows} /> : <Quality dataset={dataset} />}
  </div>
}

function Overview({ dataset }: { dataset: ReportDataset }): React.JSX.Element {
  const summary = dataset.summary
  const trendOption = promotionTrendOption(dataset)
  const campaignDetailCount = number(summary['campaign_detail_count']) ?? 0
  return <>
    <section className="promotion-kpis">
      <PromotionKpi label="广告消耗" value={money(summary['spend'])} note="账户级汇总" accent />
      <PromotionKpi label="点击量" value={integerNullable(summary['clicks'])} note={`平均点击花费 ${money(summary['cpc'])}`} />
      <PromotionKpi label="平台广告 ROI" value={decimal(summary['roi'])} note="保留平台原始口径" />
      <PromotionKpi label="广告成交金额" value={money(summary['transaction_amount'])} note={hasAttributionConflict(summary) ? '与平台 ROI 口径不一致' : '平台归因成交'} danger={hasAttributionConflict(summary)} />
      <PromotionKpi label="展现量" value={integerNullable(summary['impressions'])} note="万相台接入后提供" muted />
      <PromotionKpi label="成交笔数" value={integerNullable(summary['transaction_order_count'])} note="与店铺支付子订单分开" muted />
    </section>
    <section className="promotion-overview-grid">
      <article className="promotion-panel"><PromotionPanelHead title="消耗与推广成交趋势" note={`${dataset.meta.date_range} · 缺失值不会显示为 0`} /><EChart option={trendOption} height={280} ariaLabel="推广消耗与成交趋势图" /></article>
      <article className="promotion-panel"><PromotionPanelHead title="数据覆盖状态" note="先确认数据能回答哪些问题" /><div className="promotion-coverage-list">
        <CoverageRow label="账户汇总" description="消耗、点击、平台 ROI" status="已接入" progress={100} tone="success" />
        <CoverageRow label="计划 / 单元" description={campaignDetailCount > 0 ? `${campaignDetailCount} 条真实计划` : '不能定位具体计划消耗与撞线'} status={campaignDetailCount > 0 ? '已接入' : '待接入'} progress={campaignDetailCount > 0 ? 100 : 8} tone={campaignDetailCount > 0 ? 'success' : 'muted'} />
        <CoverageRow label="商品 / 定向 / 创意" description="尚不能将效果归因到投放对象" status="待接入" progress={5} tone="muted" />
        <CoverageRow label="归因口径" description={hasAttributionConflict(summary) ? '广告成交为 0，但平台 ROI 大于 0' : '当前字段未发现明显矛盾'} status={hasAttributionConflict(summary) ? '待核对' : '正常'} progress={hasAttributionConflict(summary) ? 45 : 100} tone={hasAttributionConflict(summary) ? 'warning' : 'success'} />
      </div></article>
    </section>
  </>
}

function Campaigns({ rows }: { rows: Array<Record<string, string | number | null>> }): React.JSX.Element {
  if (rows.length === 0) return <PromotionEmpty title="尚无计划明细" description="万相台采集器接入后将在这里展示计划、预算、消耗、成交和 ROI。" />
  return <article className="promotion-panel"><PromotionPanelHead title="推广计划与账户汇总" note="“账户汇总”不是计划级数据，不用于计划优化" /><div className="promotion-table-wrap"><table className="promotion-table"><thead><tr><th>店铺</th><th>计划/汇总名称</th><th>数据层级</th><th>消耗</th><th>点击</th><th>成交金额</th><th>ROI</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${String(row['shop_id'])}-${String(row['campaign_name'])}-${index}`}><td>{String(row['shop_name'] ?? '—')}</td><td className="strong">{String(row['campaign_name'] ?? '—')}</td><td><Tag color={row['data_level'] === 'campaign' ? 'green' : 'gold'}>{row['data_level'] === 'campaign' ? '计划明细' : '账户汇总'}</Tag></td><td className="number">{money(row['spend'])}</td><td className="number">{integerNullable(row['clicks'])}</td><td className="number">{money(row['attributed_pay_amt'])}</td><td className="number">{decimal(row['roi'])}</td></tr>)}</tbody></table></div></article>
}

function Quality({ dataset }: { dataset: ReportDataset }): React.JSX.Element {
  const summary = dataset.summary
  return <section className="promotion-quality-layout">
    <article className="promotion-panel"><PromotionPanelHead title="数据可信度" note="未知值保留为“—”，不会写成 0" /><div className="promotion-quality-grid"><QualityCard label="账户覆盖" value={`${dataset.quality.complete_shop_count}/${dataset.quality.complete_shop_count + dataset.quality.missing_shop_count}`} note="已生成汇总 / 目标店铺" tone="success" /><QualityCard label="计划明细" value={`${integer(summary['campaign_detail_count'])} 条`} note="万相台真实计划" tone={(number(summary['campaign_detail_count']) ?? 0) > 0 ? 'success' : 'muted'} /><QualityCard label="数据终态" value={dataset.meta.data_finality === 'final' ? '终态' : '实时'} note="按数据日期标记" tone="info" /><QualityCard label="归因一致" value={hasAttributionConflict(summary) ? '异常' : '正常'} note="成交金额与 ROI" tone={hasAttributionConflict(summary) ? 'danger' : 'success'} /></div></article>
    <article className="promotion-panel"><PromotionPanelHead title="覆盖说明与待办" note={`${dataset.quality.warning_count} 项`} /><div className="promotion-warning-list">{dataset.quality.warnings.map((warning, index) => <div key={`${warning}-${index}`}><span>{index + 1}</span><p>{warning}</p></div>)}</div></article>
  </section>
}

function PromotionKpi({ label, value, note, accent = false, danger = false, muted = false }: { label: string; value: string; note: string; accent?: boolean; danger?: boolean; muted?: boolean }): React.JSX.Element {
  return <article className={`promotion-kpi ${accent ? 'accent' : ''} ${danger ? 'danger' : ''} ${muted ? 'muted' : ''}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>
}

function CoverageRow({ label, description, status, progress, tone }: { label: string; description: string; status: string; progress: number; tone: string }): React.JSX.Element {
  return <div className="promotion-coverage-row"><div><strong>{label}</strong><span>{description}</span></div><b className={`tone-${tone}`}>{status}</b><i><em className={`tone-${tone}`} style={{ width: `${progress}%` }} /></i></div>
}

function QualityCard({ label, value, note, tone }: { label: string; value: string; note: string; tone: string }): React.JSX.Element {
  return <div className="promotion-quality-card"><span>{label}</span><strong className={`tone-${tone}`}>{value}</strong><small>{note}</small></div>
}

function PromotionPanelHead({ title, note }: { title: string; note: string }): React.JSX.Element { return <header className="promotion-panel-head"><div><h2>{title}</h2><p>{note}</p></div></header> }
function PromotionEmpty({ title, description }: { title: string; description: string }): React.JSX.Element { return <div className="promotion-empty"><h2>{title}</h2><p>{description}</p></div> }

function updateCountText(update: DataUpdateResult): string {
  return `采集结果：更新 ${update.updated}、跳过 ${update.skipped}、待登录 ${update.needLogin}、失败 ${update.failed}`
}

function promotionTrendOption(dataset: ReportDataset): DashboardChartOption {
  return {
    tooltip: { trigger: 'axis' as const }, legend: { top: 0, right: 0, data: ['广告消耗', '推广成交金额'] }, grid: { left: 48, right: 18, top: 42, bottom: 34 },
    xAxis: { type: 'category' as const, data: dataset.trend.map((row) => String(row['date'] ?? '')), axisTick: { show: false } }, yAxis: { type: 'value' as const },
    series: [
      { name: '广告消耗', type: 'bar' as const, data: dataset.trend.map((row) => number(row['spend'])), itemStyle: { color: '#2d7ff9', borderRadius: [5, 5, 0, 0] } },
      { name: '推广成交金额', type: 'line' as const, data: dataset.trend.map((row) => number(row['transaction_amount'])), connectNulls: false, lineStyle: { width: 3, color: '#ef7a37' }, itemStyle: { color: '#ef7a37' } }
    ]
  }
}

function previewDataset(): ReportDataset {
  const generatedAt = new Date().toISOString()
  return {
    schema_version: '1.0.0', report_type: 'tmall_promotion_report', dataset_id: 'preview_promotion',
    filters: { reportType: 'tmall_promotion_report', dateStart: '2026-08-31', dateEnd: '2026-08-31', platforms: ['tmall'], shopIds: ['TEST_SHOP_1'], ownerIds: [] },
    meta: { shop_name: '示例店铺1', date_range: '2026-08-31', updated_at: generatedAt, biz_date: '2026-08-31', data_status: 'real', collection_status: 'completed', data_finality: 'final' },
    summary: { spend: 178.74, clicks: 144, impressions: null, cpc: 1.24125, roi: 0.70700458766924, transaction_amount: 0, transaction_order_count: null, campaign_detail_count: 0 },
    trend: [{ date: '2026-08-31', spend: 178.74, transaction_amount: 0 }], shop_rows: [],
    sections: { channels: [], keywords: [], campaigns: [{ shop_id: 'TEST_SHOP_1', shop_name: '示例店铺1', campaign_name: '生意参谋广告汇总（非计划级）', data_level: 'account_summary', spend: 178.74, clicks: 144, attributed_pay_amt: 0, roi: 0.70700458766924 }], alerts: [], service: [], promotion_accounts: [{ shop_id: 'TEST_SHOP_1' }], promotion_campaigns: [{ shop_id: 'TEST_SHOP_1', shop_name: '示例店铺1', campaign_name: '生意参谋广告汇总（非计划级）', data_level: 'account_summary', spend: 178.74, clicks: 144, attributed_pay_amt: 0, roi: 0.70700458766924 }] },
    quality: { complete_shop_count: 1, missing_shop_count: 0, warning_count: 2, status: 'partial', dataset_count: 2, warnings: ['万相台计划级明细尚未接入；当前只展示生意参谋广告账户汇总。', '广告引导成交金额为 0，但平台广告 ROI 大于 0，归因字段口径不一致，需由万相台明细核对。'] }, source_paths: [], generated_at: generatedAt
  }
}

function hasAttributionConflict(summary: Record<string, string | number | null>): boolean { return number(summary['transaction_amount']) === 0 && (number(summary['roi']) ?? 0) > 0 }
function number(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null }
function money(value: unknown): string { const parsed = number(value); return parsed === null ? '—' : `¥${parsed.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
function integer(value: unknown): string { const parsed = number(value); return parsed === null ? '0' : Math.round(parsed).toLocaleString('zh-CN') }
function integerNullable(value: unknown): string { const parsed = number(value); return parsed === null ? '—' : Math.round(parsed).toLocaleString('zh-CN') }
function decimal(value: unknown): string { const parsed = number(value); return parsed === null ? '—' : parsed.toFixed(2) }
function errorMessage(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason) }
function shanghaiToday(): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) }
function shanghaiYesterday(): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() - 86_400_000)) }
