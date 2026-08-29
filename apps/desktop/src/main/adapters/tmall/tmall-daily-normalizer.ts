import type { AccountConfig, ReportDataset } from '@ecommerce/shared'
import type { TmallDailySnapshot } from '../../browser/browser-profile-manager.js'

export interface NormalizedDataset {
  schema_version: '1.0.0'
  dataset: string
  platform: 'tmall'
  shop_id: string
  shop_name: string
  account_id: string
  biz_date: string
  timezone: 'Asia/Shanghai'
  captured_at: string
  source_pages: string[]
  capture_method: 'network_json'
  dimensions: string[]
  rows: Array<Record<string, string | number | null>>
  quality: { status: 'complete' | 'partial'; warnings: string[] }
}

export interface TmallNormalizedResult {
  datasets: NormalizedDataset[]
  report: ReportDataset
}

export const TMALL_NORMALIZER_VERSION = 'tmall-0.5.3'

const BASE_COVERAGE_WARNINGS = [
  '流量来源与搜索词来自生意参谋 Top 列表，未能证明覆盖全部分页。',
  '广告仅有账户级汇总，尚未接入直通车/万相台计划级明细。',
  '支付宝结算数据尚未接入。'
]

export function normalizeTmallDaily(snapshot: TmallDailySnapshot, account: AccountConfig): TmallNormalizedResult {
  const captureToday = shanghaiDate(new Date(snapshot.capturedAt))
  const captureYesterday = shanghaiDate(new Date(new Date(snapshot.capturedAt).getTime() - 86_400_000))
  const isToday = snapshot.bizDate === captureToday
  const isYesterday = snapshot.bizDate === captureYesterday
  const trade = isYesterday ? bestRecord(endpointBody(snapshot, 'trade', '/ipoll/live/yesterday/getYesterdayTrade.json'), ['payAmt', 'payOrdCnt', 'payByrCnt']) : {}
  const tradeFlow = isYesterday ? bestRecord(endpointBody(snapshot, 'trade', '/ipoll/live/yesterday/getYesterdayFlow.json'), ['uv', 'pv', 'itmUv']) : {}
  const flow = bestRecord(endpointBody(snapshot, 'flow', '/flow/new/guide/trend/overview.json'), ['uv', 'pv', 'payAmt', 'bounceRate'])
  const homeBody = endpointBody(snapshot, 'store', '/portal/live/new/index/overview/v3.json')
  const home = isToday ? findNamedRecord(homeBody, 'today') ?? {} : isYesterday ? findNamedRecord(homeBody, 'yestday') ?? {} : {}
  // 当天首页是实时主口径；流量看板可能仍在产出并暂时返回全 0，只用于补齐首页没有的字段。
  const store = isToday ? { ...flow, ...home } : { ...home, ...tradeFlow, ...flow, ...trade }
  // getYesterdayTrade.json returns payAmt in fen; portal/flow and all normalized datasets use yuan.
  const ad = bestRecord(endpointBody(snapshot, 'store', '/portal/board/grow/factor/overview.json'), ['totalPromoSpend', 'clicks', 'portalAdPayAmt', 'tROI'])
  const itemRows = bestRows(endpointBody(snapshot, 'item', '/cc/item/view/top.json'), ['itemId', 'title', 'payAmt', 'itmUv'])
  const itemPayAmt = itemRows.reduce((sum, row) => sum + numberOrZero(metric(row, 'payAmt')), 0)
  const payAmtYuan = isToday
    ? metric(home, 'payAmt') ?? metric(flow, 'payAmt') ?? itemPayAmt
    : (isYesterday ? fenMetric(trade, 'payAmt') : null) ?? metric(flow, 'payAmt') ?? metric(home, 'payAmt') ?? itemPayAmt
  const itemRefundValues = itemRows.map((row) => metric(row, 'sucRefundAmt')).filter((value): value is number => value !== null)
  // 商品接口只返回 Top 列表：全为 0 不能证明全店退款为 0；仅在出现正退款时作为部分覆盖的下限值。
  const itemRefundAmt = itemRefundValues.some((value) => value > 0) ? itemRefundValues.reduce((sum, value) => sum + value, 0) : null
  const storeRefundAmt = firstMetric(home, ['rfdSucAmt', 'portalShopSucRfdAmt'])
  const refundAmt = storeRefundAmt ?? itemRefundAmt
  const refundRate = firstMetric(home, ['payAmtRfdRate']) ?? (refundAmt !== null && payAmtYuan > 0 ? refundAmt / payAmtYuan : null)
  const sourceRows = bestRows(endpointBody(snapshot, 'flow', '/flow/v3/overview/shopFlowSourceTop/v4.json'), ['uv', 'pv', 'payAmt'], ['sourceName', 'sourceName1', 'pageName'])
  const keywordRows = bestRows(endpointBody(snapshot, 'flow', '/flow/new/overview/keywordTop.json'), ['keyword', 'uv', 'pv'])
  const serviceOverview = bestRows(endpointBody(snapshot, 'service', '/csp/api/core/monitor/overview/list'), [], ['name', 'indexName', 'title'])
  const serviceList = bestRows(endpointBody(snapshot, 'service', '/csp/api/core/monitor/list'), ['date'], [])
  const delayedFlowMessage = endpointBusinessErrorMessage(endpointBody(snapshot, 'flow', '/flow/v3/overview/shopFlowSourceTop/v4.json'))
  const todayFlowConflict = isToday && sourceHasNonZeroRealtimeMetric(home) && sourceHasOnlyZeroCoreMetrics(flow)
  const sourceWarnings: string[] = []
  if (todayFlowConflict) sourceWarnings.push('今日流量接口返回 0，但首页实时数据非零；当前采用首页实时数据，流量来源等明细可能仍在产出。')
  if (delayedFlowMessage && !todayFlowConflict) sourceWarnings.push(`流量接口返回“${delayedFlowMessage}”，相关明细按缺失处理。`)

  const storeRow = {
    biz_date: snapshot.bizDate,
    pay_amt: payAmtYuan,
    pay_order_count: firstMetric(store, ['payOrderCnt', 'payOrdCnt']),
    pay_buyer_count: firstMetric(store, ['payBuyerCnt', 'payByrCnt']),
    pay_item_count: firstMetric(store, ['payItemQty', 'payItmCnt']),
    visitor_count: metric(store, 'uv'),
    page_view_count: metric(store, 'pv'),
    item_visitor_count: metric(store, 'itmUv'),
    pay_rate: metric(store, 'payRate'),
    cart_buyer_count: firstMetric(store, ['addCartBuyerCnt', 'cartByrCnt']),
    favorite_buyer_count: firstMetric(store, ['favBuyerCnt', 'cltByrCnt']),
    bounce_rate: metric(store, 'bounceRate'),
    average_page_views: metric(store, 'avgPv'),
    average_stay_seconds: metric(store, 'stayTime'),
    new_visitor_count: metric(store, 'newUv'),
    returning_visitor_count: metric(store, 'oldUv'),
    refund_amt: refundAmt,
    refund_rate: refundRate
  }
  const normalizedItems = itemRows.map((row) => {
    const item = isRecord(row['item']) ? row['item'] : {}
    return {
    biz_date: snapshot.bizDate,
    item_id: textMetric(row, ['itemId', 'item_id']) ?? textMetric(item, ['itemId']),
    item_title: textMetric(row, ['title', 'itemTitle', 'itemName']) ?? textMetric(item, ['title', 'itemTitle', 'itemName']),
    item_status: textMetric(row, ['itemStatus', 'status']),
    pay_amt: metric(row, 'payAmt'),
    refund_amt: metric(row, 'sucRefundAmt'),
    pay_item_count: metric(row, 'payItmCnt'),
    pay_buyer_count: metric(row, 'payByrCnt'),
    pay_rate: metric(row, 'payRate'),
    visitor_count: metric(row, 'itmUv'),
    page_view_count: metric(row, 'itmPv'),
    search_visitor_count: metric(row, 'seGuideUv'),
    cart_buyer_count: metric(row, 'itemCartByrCnt'),
    favorite_buyer_count: metric(row, 'itemCltByrCnt'),
    average_stay_seconds: metric(row, 'itmStayTime'),
    bounce_rate: metric(row, 'itmBounceRate'),
    ad_spend: metric(row, 'fCharge'),
    ad_roi: metric(row, 'pDROI')
  }})
  const normalizedSources = sourceRows.map((row) => ({
    biz_date: snapshot.bizDate,
    source_name: textMetric(row, ['sourceName', 'sourceName1', 'pageName', 'name']),
    visitor_count: metric(row, 'uv'),
    page_view_count: metric(row, 'pv'),
    cart_buyer_count: metric(row, 'cartByrCnt'),
    pay_buyer_count: firstMetric(row, ['itmPayByrCnt', 'payByrCnt']),
    pay_amt: metric(row, 'payAmt'),
    pay_rate: metric(row, 'payRate')
  }))
  const normalizedKeywords = keywordRows.map((row) => ({
    biz_date: snapshot.bizDate,
    keyword: textMetric(row, ['keyword', 'searchWord', 'word']),
    visitor_count: metric(row, 'uv'),
    page_view_count: metric(row, 'pv'),
    cart_buyer_count: firstMetric(row, ['crtByrCnt', 'cartByrCnt']),
    cart_rate: firstMetric(row, ['crtRate', 'cartRate']),
    pay_amt: metric(row, 'payAmt')
  }))
  const normalizedService = [...serviceOverview, ...serviceList].map((row) => flattenMetricRow(row, snapshot.bizDate))
  const adRow = {
    biz_date: snapshot.bizDate,
    campaign_name: '生意参谋广告汇总（非计划级）',
    spend: metric(ad, 'totalPromoSpend'),
    clicks: metric(ad, 'clicks'),
    attributed_pay_amt: firstMetric(ad, ['portalAdPayAmt', 'payAmt']),
    roi: firstMetric(ad, ['tROI', 'roi'])
  }
  const refundRow = {
    biz_date: snapshot.bizDate,
    success_refund_amt: refundAmt,
    refund_rate: refundRate,
    source: storeRefundAmt !== null ? '生意参谋店铺汇总' : itemRefundAmt !== null ? '生意参谋商品 Top 退款下限' : '生意参谋未返回店铺级退款汇总'
  }
  const refundWarning = refundAmt === null
    ? '所选日期未返回店铺级成功退款汇总；商品 Top 列表不能证明全店退款为 0，当前按缺失处理。'
    : '已采集成功退款金额汇总；订单与退款售后明细尚未接入千牛导出。'
  const coverageWarnings = [...sourceWarnings, BASE_COVERAGE_WARNINGS[0]!, refundWarning, ...BASE_COVERAGE_WARNINGS.slice(1)]

  const definitions: Array<[string, string[], Array<Record<string, string | number | null>>, string[]]> = [
    ['store_daily', ['biz_date'], [storeRow], sourceWarnings],
    ['item_daily', ['biz_date', 'item_id'], normalizedItems, []],
    ['traffic_source_daily', ['biz_date', 'source_name'], normalizedSources, ['Top 列表，可能不含全部来源。']],
    ['search_keyword_daily', ['biz_date', 'keyword'], normalizedKeywords, ['Top 列表，可能不含全部搜索词。']],
    ['service_daily', ['biz_date'], normalizedService, ['部分客服指标为延迟统计。']],
    ['ad_account_daily', ['biz_date'], [adRow], ['仅账户级汇总，不代表广告计划明细。']],
    ['refund_summary_daily', ['biz_date'], [refundRow], [refundWarning]]
  ]
  const datasets = definitions.map(([name, dimensions, rows, warnings]) => dataset(account, snapshot, name, dimensions, rows, warnings))
  const payAmt = numberOrZero(storeRow.pay_amt)
  const visitorCount = numberOrZero(storeRow.visitor_count)
  const payBuyerCount = numberOrZero(storeRow.pay_buyer_count)
  const payRate = nullableNumber(storeRow.pay_rate) ?? (visitorCount > 0 ? payBuyerCount / visitorCount : 0)
  const adSpend = numberOrZero(adRow.spend)
  const adPayAmt = numberOrZero(adRow.attributed_pay_amt)
  const generatedAt = new Date().toISOString()
  const report: ReportDataset = {
    schema_version: '1.0.0',
    report_type: 'tmall_daily_dashboard',
    dataset_id: `tmall_${account.shop_id}_${snapshot.bizDate.replaceAll('-', '')}`,
    filters: { reportType: 'tmall_daily_dashboard', dateStart: snapshot.bizDate, dateEnd: snapshot.bizDate, platforms: ['tmall'], shopIds: [account.shop_id], ownerIds: [] },
    meta: {
      shop_name: account.shop_name,
      date_range: snapshot.bizDate,
      updated_at: generatedAt,
      biz_date: snapshot.bizDate,
      data_status: 'real',
      collection_status: 'completed',
      normalizer_version: TMALL_NORMALIZER_VERSION,
      data_finality: isToday ? 'realtime' : 'final'
    },
    summary: {
      pay_amt: payAmt,
      pay_order_count: numberOrZero(storeRow.pay_order_count),
      pay_buyer_count: payBuyerCount,
      pay_item_count: numberOrZero(storeRow.pay_item_count),
      visitor_count: visitorCount,
      page_view_count: numberOrZero(storeRow.page_view_count),
      pay_rate: payRate,
      customer_unit_price: payBuyerCount > 0 ? payAmt / payBuyerCount : 0,
      refund_amt: refundAmt,
      refund_rate: refundRate,
      ad_spend: adSpend,
      ad_pay_amt: adPayAmt,
      ad_roi: adSpend > 0 ? payAmt / adSpend : null,
      platform_ad_roi: nullableNumber(adRow.roi)
    },
    trend: [{ date: snapshot.bizDate, pay_amt: payAmt, refund_amt: refundAmt, visitor_count: visitorCount, pay_order_count: numberOrZero(storeRow.pay_order_count), ad_spend: adSpend }],
    shop_rows: normalizedItems,
    sections: {
      channels: normalizedSources,
      keywords: normalizedKeywords,
      campaigns: [adRow],
      alerts: buildAlerts(visitorCount, payAmt, refundAmt, adSpend),
      service: normalizedService
    },
    quality: { complete_shop_count: 0, missing_shop_count: 1, warning_count: coverageWarnings.length, status: 'partial', dataset_count: datasets.length, warnings: coverageWarnings },
    source_paths: [],
    generated_at: generatedAt
  }
  return { datasets, report }
}

function dataset(account: AccountConfig, snapshot: TmallDailySnapshot, name: string, dimensions: string[], rows: Array<Record<string, string | number | null>>, warnings: string[]): NormalizedDataset {
  return {
    schema_version: '1.0.0', dataset: name, platform: 'tmall', shop_id: account.shop_id, shop_name: account.shop_name,
    account_id: account.account_id, biz_date: snapshot.bizDate, timezone: 'Asia/Shanghai', captured_at: snapshot.capturedAt,
    source_pages: snapshot.pages.map((page) => page.sourceUrl), capture_method: 'network_json', dimensions, rows,
    quality: { status: warnings.length > 0 ? 'partial' : 'complete', warnings }
  }
}

function sourceHasNonZeroRealtimeMetric(source: Record<string, unknown>): boolean {
  return ['payAmt', 'uv', 'pv', 'payByrCnt', 'payOrdCnt'].some((key) => {
    const value = metric(source, key)
    return value !== null && value > 0
  })
}

function sourceHasOnlyZeroCoreMetrics(source: Record<string, unknown>): boolean {
  const values = ['payAmt', 'uv', 'pv', 'payByrCnt', 'payRate'].map((key) => metric(source, key)).filter((value): value is number => value !== null)
  return values.length > 0 && values.every((value) => value === 0)
}

function endpointBusinessErrorMessage(value: unknown): string | null {
  let result: string | null = null
  walk(value, (candidate) => {
    if (result !== null) return
    const code = toNumber(candidate['code'])
    const message = unwrap(candidate['message'])
    if (code !== null && code !== 0 && typeof message === 'string' && message.trim()) result = message.trim()
  })
  return result
}

function endpointBody(snapshot: TmallDailySnapshot, pageKey: TmallDailySnapshot['pages'][number]['key'], path: string): unknown {
  const endpoint = snapshot.pages.find((page) => page.key === pageKey)?.endpoints[path]
  if (!isRecord(endpoint) || endpoint['ok'] !== true) return null
  return endpoint['body']
}

function bestRecord(value: unknown, keys: string[]): Record<string, unknown> {
  let winner: Record<string, unknown> = {}
  let score = -1
  walk(value, (candidate) => {
    const nextScore = keys.reduce((total, key) => total + (key in candidate ? 1 : 0), 0)
    if (nextScore > score) { winner = candidate; score = nextScore }
  })
  return winner
}

function findNamedRecord(value: unknown, name: string): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const entry of value) { const found = findNamedRecord(entry, name); if (found) return found }
    return null
  }
  if (!isRecord(value)) return null
  if (isRecord(value[name])) return value[name]
  for (const entry of Object.values(value)) { const found = findNamedRecord(entry, name); if (found) return found }
  return null
}

function bestRows(value: unknown, metricKeys: string[], identityKeys: string[] = metricKeys): Record<string, unknown>[] {
  let winner: Record<string, unknown>[] = []
  let score = -1
  walkArrays(value, (rows) => {
    const records = rows.filter(isRecord)
    if (records.length === 0) return
    const sample = records[0] ?? {}
    const matches = [...metricKeys, ...identityKeys].reduce((total, key) => total + (key in sample ? 1 : 0), 0)
    const nextScore = matches * 1000 + records.length
    if (nextScore > score) { winner = records; score = nextScore }
  })
  return winner
}

function walk(value: unknown, visit: (record: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) { for (const entry of value) walk(entry, visit); return }
  if (!isRecord(value)) return
  visit(value)
  for (const entry of Object.values(value)) walk(entry, visit)
}

function walkArrays(value: unknown, visit: (rows: unknown[]) => void): void {
  if (Array.isArray(value)) { visit(value); for (const entry of value) walkArrays(entry, visit); return }
  if (isRecord(value)) for (const entry of Object.values(value)) walkArrays(entry, visit)
}

function metric(row: Record<string, unknown>, key: string): number | null { return toNumber(row[key]) }
function fenMetric(row: Record<string, unknown>, key: string): number | null { const value = metric(row, key); return value === null ? null : Math.round(value) / 100 }
function firstMetric(row: Record<string, unknown>, keys: string[]): number | null { for (const key of keys) { const value = metric(row, key); if (value !== null) return value } return null }
function textMetric(row: Record<string, unknown>, keys: string[]): string | null { for (const key of keys) { const value = unwrap(row[key]); if (typeof value === 'string' || typeof value === 'number') return String(value) } return null }
function unwrap(value: unknown): unknown { return isRecord(value) && 'value' in value ? value['value'] : value }
function toNumber(value: unknown): number | null { const unwrapped = unwrap(value); if (typeof unwrapped === 'number' && Number.isFinite(unwrapped)) return unwrapped; if (typeof unwrapped === 'string') { const parsed = Number(unwrapped.replaceAll(',', '').replace('%', '')); return Number.isFinite(parsed) ? parsed : null } return null }
function nullableNumber(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null }
function numberOrZero(value: unknown): number { return nullableNumber(value) ?? 0 }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }

function flattenMetricRow(row: Record<string, unknown>, bizDate: string): Record<string, string | number | null> {
  const result: Record<string, string | number | null> = { biz_date: bizDate }
  for (const [key, raw] of Object.entries(row)) {
    const value = unwrap(raw)
    if (typeof value === 'string' || typeof value === 'number' || value === null) result[key] = value
  }
  return result
}

function buildAlerts(visitorCount: number, payAmt: number, refundAmt: number | null, adSpend: number): Array<Record<string, string | number | null>> {
  const alerts: Array<Record<string, string | number | null>> = []
  if (visitorCount < 10) alerts.push({ level: 'warning', title: '所选日期访客量较低', detail: `生意参谋记录访客 ${visitorCount} 人，请结合店铺实际经营状态核对。` })
  if (adSpend > 0 && payAmt === 0) alerts.push({ level: 'warning', title: '广告有消耗但未归因成交', detail: `所选日期广告消耗 ¥${adSpend.toFixed(2)}，支付金额为 0。` })
  if (refundAmt !== null && refundAmt > 0) alerts.push({ level: 'warning', title: '存在成功退款', detail: `所选日期成功退款金额为 ¥${refundAmt.toFixed(2)}，请结合售后明细核对原因。` })
  alerts.push({ level: 'info', title: '数据尚未完全覆盖', detail: '订单明细、退款售后明细、广告计划明细和结算数据待后续接入。' })
  return alerts
}

function shanghaiDate(value: Date): string {
  if (!Number.isFinite(value.getTime())) throw new TypeError('capturedAt must be a valid ISO timestamp')
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value)
}
