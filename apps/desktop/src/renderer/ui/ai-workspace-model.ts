import type { ReportDataset } from '@ecommerce/shared'

export type OpportunityGrade = 'S' | 'A' | 'B' | 'C' | 'D'

export interface SelectionOpportunityRow {
  id: string
  title: string
  shopName: string
  itemId: string
  marketScore: number
  storeFitScore: number
  riskScore: number
  overallScore: number
  grade: OpportunityGrade
  visitorCount: number
  conversionRate: number | null
  payAmount: number
  refundRate: number | null
  confidence: number
  sourceSnapshotIds: string[]
}

export interface OperationProposalRow {
  id: string
  target: string
  shopName: string
  problemCode: 'BUDGET_LIMITED_HIGH_ROAS' | 'SPEND_UP_ROAS_DOWN' | 'HIGH_TRAFFIC_LOW_CONVERSION' | 'REFUND_RISK'
  summary: string
  action: string
  risk: 'LOW' | 'MEDIUM' | 'HIGH'
  confidence: number
  currentValue: number | null
  suggestedValue: number | null
  sourceSnapshotIds: string[]
}

export function buildSelectionOpportunities(report: ReportDataset): SelectionOpportunityRow[] {
  const rows = report.shop_rows
    .map((row, index) => normalizeProduct(row, index, report))
    .filter((row) => row.title && (row.payAmount > 0 || row.visitorCount > 0))
  const payAmounts = rows.map((row) => row.payAmount)
  const visitors = rows.map((row) => row.visitorCount)
  const conversionRates = rows.map((row) => row.conversionRate ?? 0)

  return rows.map((row) => {
    const demand = percentileRank(row.payAmount, payAmounts)
    const traffic = percentileRank(row.visitorCount, visitors)
    const conversion = percentileRank(row.conversionRate ?? 0, conversionRates)
    const marketScore = round(100 * (0.45 * demand + 0.35 * traffic + 0.2 * conversion))
    const refundSafety = row.refundRate === null ? null : clamp(1 - row.refundRate * 3, 0, 1)
    const knownFit: Array<[number | null, number]> = [[conversion, 0.45], [demand, 0.35], [refundSafety, 0.2]]
    const storeFitScore = round(100 * weightedKnown(knownFit))
    const riskScore = round(100 * weightedKnown([[refundSafety, 0.55], [row.payAmount > 0 ? Math.min(1, row.payAmount / 1000) : null, 0.2], [report.quality.status === 'complete' ? 1 : 0.65, 0.25]]))
    const overallScore = round(marketScore * 0.45 + storeFitScore * 0.4 + riskScore * 0.15)
    const knownFields = [row.conversionRate, row.refundRate, row.payAmount > 0 ? row.payAmount : null, row.visitorCount > 0 ? row.visitorCount : null].filter((value) => value !== null).length
    return { ...row, marketScore, storeFitScore, riskScore, overallScore, grade: grade(overallScore), confidence: round(Math.min(1, 0.45 + knownFields * 0.12), 2) }
  }).sort((left, right) => right.overallScore - left.overallScore)
}

export function buildOperationProposals(report: ReportDataset, promotion: ReportDataset): OperationProposalRow[] {
  const proposals: OperationProposalRow[] = []
  for (const [index, row] of (promotion.sections.promotion_campaigns ?? promotion.sections.campaigns).entries()) {
    const spend = number(row['spend'])
    const roi = nullableNumber(row['platform_roi'] ?? row['roi'])
    const budgetUtilization = nullableNumber(row['budget_utilization'])
    const target = text(row['campaign_name']) || text(row['item_title']) || `推广对象 ${index + 1}`
    const shopName = text(row['shop_name']) || promotion.meta.shop_name
    if (roi !== null && roi >= 5 && (budgetUtilization ?? 0) >= 0.9) {
      proposals.push(proposal(index, target, shopName, 'BUDGET_LIMITED_HIGH_ROAS', `ROAS ${roi.toFixed(2)} 且预算利用率 ${percent(budgetUtilization)}，规则判断存在增量空间。`, '建议人工审批后将日预算上调 10%', 'LOW', budgetUtilization, round((number(row['budget']) || spend) * 1.1), promotion))
    } else if (spend >= 100 && roi !== null && roi < 3) {
      proposals.push(proposal(index, target, shopName, 'SPEND_UP_ROAS_DOWN', `已消耗 ¥${spend.toFixed(2)}，ROAS 仅 ${roi.toFixed(2)}，低于默认安全线。`, '建议检查搜索词与人群，暂不自动调整', 'MEDIUM', roi, null, promotion))
    }
  }
  for (const [index, row] of report.shop_rows.entries()) {
    const visitors = number(row['visitor_count'])
    const conversion = nullableNumber(row['pay_rate']) ?? ratio(number(row['pay_buyer_count']), visitors)
    const payAmount = number(row['pay_amt'])
    const refund = nullableNumber(row['refund_amt'])
    const title = text(row['item_title']) || `商品 ${index + 1}`
    const shopName = text(row['shop_name']) || report.meta.shop_name
    if (visitors >= 50 && (conversion ?? 0) < 0.03) proposals.push(proposal(index + 10_000, title, shopName, 'HIGH_TRAFFIC_LOW_CONVERSION', `访客 ${visitors}，支付转化率 ${percent(conversion)}。`, '建议检查价格、详情页、评价与库存', 'LOW', conversion, null, report))
    if (refund !== null && payAmount > 0 && refund / payAmount >= 0.1) proposals.push(proposal(index + 20_000, title, shopName, 'REFUND_RISK', `退款影响率 ${percent(refund / payAmount)}，超过 10% 风险线。`, '建议排查退款原因，禁止自动加投', 'HIGH', refund / payAmount, null, report))
  }
  return proposals.slice(0, 50)
}

function normalizeProduct(row: Record<string, string | number | null>, index: number, report: ReportDataset): Omit<SelectionOpportunityRow, 'marketScore' | 'storeFitScore' | 'riskScore' | 'overallScore' | 'grade' | 'confidence'> {
  const payAmount = number(row['pay_amt'])
  const visitorCount = number(row['visitor_count'])
  const refundAmount = nullableNumber(row['refund_amt'])
  const itemId = text(row['item_id']) || `row-${index + 1}`
  return {
    id: `${report.dataset_id}:${itemId}`,
    title: text(row['item_title']),
    shopName: text(row['shop_name']) || report.meta.shop_name,
    itemId,
    visitorCount,
    conversionRate: nullableNumber(row['pay_rate']) ?? ratio(number(row['pay_buyer_count']), visitorCount),
    payAmount,
    refundRate: refundAmount === null || payAmount <= 0 ? null : refundAmount / payAmount,
    sourceSnapshotIds: sourceIds(report)
  }
}

function proposal(index: number, target: string, shopName: string, problemCode: OperationProposalRow['problemCode'], summary: string, action: string, risk: OperationProposalRow['risk'], currentValue: number | null, suggestedValue: number | null, report: ReportDataset): OperationProposalRow {
  return { id: `${report.dataset_id}:${problemCode}:${index}`, target, shopName, problemCode, summary, action, risk, confidence: report.quality.status === 'complete' ? 0.88 : 0.66, currentValue, suggestedValue, sourceSnapshotIds: sourceIds(report) }
}

function sourceIds(report: ReportDataset): string[] {
  return report.source_paths.length > 0 ? report.source_paths : [report.dataset_id]
}

function weightedKnown(values: Array<[number | null, number]>): number {
  const known = values.filter((entry): entry is [number, number] => entry[0] !== null)
  const weight = known.reduce((sum, entry) => sum + entry[1], 0)
  return weight > 0 ? known.reduce((sum, [value, itemWeight]) => sum + value * itemWeight, 0) / weight : 0
}

function percentileRank(value: number, values: number[]): number {
  if (values.length <= 1) return value > 0 ? 1 : 0
  const below = values.filter((candidate) => candidate < value).length
  const equal = values.filter((candidate) => candidate === value).length
  return (below + Math.max(0, equal - 1) / 2) / (values.length - 1)
}

function grade(score: number): OpportunityGrade { return score >= 90 ? 'S' : score >= 80 ? 'A' : score >= 70 ? 'B' : score >= 60 ? 'C' : 'D' }
function nullableNumber(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null }
function number(value: unknown): number { return nullableNumber(value) ?? 0 }
function text(value: unknown): string { return typeof value === 'string' ? value.trim() : '' }
function ratio(numerator: number | null, denominator: number | null): number | null { return numerator !== null && denominator !== null && denominator > 0 ? numerator / denominator : null }
function clamp(value: number, min: number, max: number): number { return Math.max(min, Math.min(max, value)) }
function round(value: number, digits = 1): number { const factor = 10 ** digits; return Math.round(value * factor) / factor }
function percent(value: number | null): string { return value === null ? '数据不足' : `${(value * 100).toFixed(1)}%` }
