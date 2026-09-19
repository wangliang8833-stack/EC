import type { ReportDataset, ReportQuery } from '@ecommerce/shared'

export const ANALYSIS_VERSION = 'commerce-template-1.0.0'
export const ANALYSIS_TEMPLATES = [
  { id: 'overview', name: '综合经营诊断', description: '经营变化、店铺贡献、商品与流量、广告退款、执行计划' },
  { id: 'merchandise', name: '商品与流量诊断', description: '成交集中度、商品承接、来源转化与验证动作' },
  { id: 'advertising', name: '广告与退款核查', description: '消耗压力、归因口径、退款覆盖与成本缺口' }
] as const
export type AnalysisTemplate = typeof ANALYSIS_TEMPLATES[number]['id']
export interface AnalysisShop { shopId: string; shopName: string }
export interface AnalysisScope { endDate: string; days: 1 | 7 | 30; shops: AnalysisShop[]; template: AnalysisTemplate }
export interface AnalysisCell { shopId: string; date: string; report: ReportDataset | null; error: string | null }
export interface AnalysisMetric { key: string; label: string; value: number | null; reported: number; expected: number; format: 'money' | 'count' | 'percent' | 'ratio'; definition: string }
export interface AnalysisFinding {
  id: string; priority: 'P0' | 'P1' | 'P2'; title: string; evidence: string; interpretation: string; impact: string
  action: string; validation: string; owner: string; confidence: '高' | '中'; effort: '低' | '中'; horizon: string; refs: string[]
}
export interface ShopAnalysis extends AnalysisShop {
  availableDays: number; pay: number | null; spend: number | null; visitors: number | null; buyers: number | null
  conversion: number | null; ticket: number | null; refund: number | null; roi: number | null
  delta: number | null; deltaRatio: number | null
}
export interface AnalysisDetail { shopId: string; shopName: string; date: string; values: Record<string, string | number | null> }
export interface CommerceAnalysis {
  version: string; scope: AnalysisScope; dates: string[]; previousDates: string[]; generatedAt: string; dataAsOf: string | null
  available: number; expected: number; metrics: AnalysisMetric[]; shops: ShopAnalysis[]; findings: AnalysisFinding[]
  comparison: { shopCount: number; current: number | null; previous: number | null; delta: number | null; ratio: number | null }
  trend: Array<{ date: string; pay: number | null; coverage: number; expected: number }>
  products: AnalysisDetail[]; channels: AnalysisDetail[]; advertisements: AnalysisDetail[]; cells: AnalysisCell[]
  warnings: string[]; sources: string[]; normalizerVersions: string[]
}

export function analysisDateShift(date: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('请选择有效日期。')
  const value = new Date(`${date}T00:00:00Z`)
  if (!Number.isFinite(value.getTime()) || value.toISOString().slice(0, 10) !== date) throw new Error('请选择有效日期。')
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

export function analysisDates(end: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => analysisDateShift(end, i - days + 1))
}

export function analysisYesterday(): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  return analysisDateShift(today, -1)
}

export function validateAnalysisScope(scope: AnalysisScope): void {
  analysisDateShift(scope.endDate, 0)
  if (scope.endDate > analysisYesterday()) throw new Error('请使用昨日或更早的完整自然日。')
  if (![1, 7, 30].includes(scope.days)) throw new Error('分析周期仅支持 1、7、30 天。')
  if (!scope.shops.length || new Set(scope.shops.map(s => s.shopId)).size !== scope.shops.length) throw new Error('请选择不重复的有效店铺。')
  if (!ANALYSIS_TEMPLATES.some(t => t.id === scope.template)) throw new Error('请选择有效模板。')
}

/** Query each natural day separately: the current report IPC reads dateEnd only. */
export async function loadAnalysisCells(scope: AnalysisScope, query: (query: ReportQuery) => Promise<ReportDataset>, cancelled: () => boolean = () => false): Promise<AnalysisCell[]> {
  validateAnalysisScope(scope)
  const dates = analysisDates(scope.endDate, scope.days * 2)
  const tasks = dates.flatMap(date => scope.shops.map(shop => ({ date, shopId: shop.shopId })))
  const cells: AnalysisCell[] = []
  let next = 0
  async function worker(): Promise<void> {
    while (!cancelled()) {
      const task = tasks[next++]
      if (!task) return
      try {
        const report = await query({ reportType: 'tmall_daily_dashboard', dateStart: task.date, dateEnd: task.date, platforms: ['tmall'], shopIds: [task.shopId], ownerIds: [] })
        if (cancelled()) return
        const real = report.meta.data_status === 'real' && report.meta.collection_status === 'completed'
        const valid = report.filters.shopIds.length === 1 && report.filters.shopIds[0] === task.shopId && report.meta.biz_date === task.date && report.meta.data_finality !== 'realtime'
        cells.push({ ...task, report: real && valid ? report : null, error: real && !valid ? '日期、店铺或完整自然日校验未通过' : null })
      } catch (error) {
        if (!cancelled()) cells.push({ ...task, report: null, error: error instanceof Error ? error.message : String(error) })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, tasks.length) }, () => worker()))
  return cells.sort((a, b) => a.date.localeCompare(b.date) || a.shopId.localeCompare(b.shopId))
}

const n = (x: unknown): number | null => typeof x === 'number' && Number.isFinite(x) ? x : null
const ratio = (a: number | null, b: number | null): number | null => a !== null && b !== null && b > 0 ? a / b : null
export function analysisFormat(value: number | null, format: AnalysisMetric['format'] = 'money'): string {
  if (value === null || !Number.isFinite(value)) return '—'
  if (format === 'percent') return `${(value * 100).toFixed(2)}%`
  return `${format === 'money' ? '¥' : ''}${value.toLocaleString('zh-CN', { minimumFractionDigits: format === 'count' ? 0 : 2, maximumFractionDigits: format === 'count' ? 0 : 2 })}`
}
function values(cells: AnalysisCell[], key: string): number[] {
  return cells.map(c => n(c.report?.summary[key])).filter((v): v is number => v !== null)
}
function known(cells: AnalysisCell[], key: string): number | null {
  const vs = values(cells, key)
  // Money is accumulated in fen, not rounded floating-point sums.
  return vs.length ? key.endsWith('_amt') || key === 'ad_spend' ? vs.reduce((s, v) => s + Math.round(v * 100), 0) / 100 : vs.reduce((s, v) => s + v, 0) : null
}
function complete(cells: AnalysisCell[], key: string): number | null {
  return cells.length > 0 && values(cells, key).length === cells.length ? known(cells, key) : null
}
function refs(cells: AnalysisCell[]): string[] { return [...new Set(cells.flatMap(c => c.report ? [c.report.dataset_id, ...c.report.source_paths] : []))] }

export function buildCommerceAnalysis(scope: AnalysisScope, input: AnalysisCell[], generatedAt = new Date().toISOString()): CommerceAnalysis {
  validateAnalysisScope(scope)
  const dates = analysisDates(scope.endDate, scope.days), previousDates = analysisDates(analysisDateShift(dates[0]!, -1), scope.days)
  // Build a complete shop-day grid; missing/duplicate/mismatched cells never become zero.
  const cells = [...previousDates, ...dates].flatMap(date => scope.shops.map(shop => {
    const matches = input.filter(c => c.shopId === shop.shopId && c.date === date)
    if (matches.length !== 1) return { shopId: shop.shopId, date, report: null, error: matches.length > 1 ? '重复店铺日记录，已排除' : null }
    const cell = matches[0]!, r = cell.report
    if (r && (r.meta.data_status !== 'real' || r.meta.collection_status !== 'completed' || r.meta.data_finality === 'realtime' || r.meta.biz_date !== date || r.filters.shopIds.length !== 1 || r.filters.shopIds[0] !== shop.shopId)) return { ...cell, report: null, error: '店铺、日期或数据状态不匹配，已排除' }
    return cell
  }))
  const current = cells.filter(c => dates.includes(c.date)), previous = cells.filter(c => previousDates.includes(c.date))
  const definitions: Array<[string, string, AnalysisMetric['format'], string]> = [
    ['pay_amt', '支付金额', 'money', '已知店铺日支付金额之和；不是净收入'],
    ['visitor_count', scope.days === 1 ? '访客合计' : '日访客合计', 'count', '各店各日 UV 之和，未跨店或跨日去重'],
    ['pay_buyer_count', scope.days === 1 ? '支付买家合计' : '日支付买家合计', 'count', '各店各日买家之和，未跨店或跨日去重'],
    ['ad_spend', '广告消耗', 'money', '已知店铺日广告账户消耗之和'],
    ['refund_amt', '成功退款金额', 'money', '店铺级成功退款；不使用商品 Top 退款补全']
  ]
  const metrics: AnalysisMetric[] = definitions.map(([key, label, format, definition]) => ({ key, label, format, definition, value: known(current, key), reported: values(current, key).length, expected: current.length }))
  for (const [key, label, a, b, format, definition] of [
    ['conversion', '买家转化率', 'pay_buyer_count', 'visitor_count', 'percent', '买家合计 / 访客合计；相关字段完整覆盖才计算'],
    ['ticket', '买家客单价', 'pay_amt', 'pay_buyer_count', 'money', '支付金额 / 支付买家；零分母为缺失'],
    ['store_roi', '全店投产比', 'pay_amt', 'ad_spend', 'ratio', '全店支付 / 广告消耗；不是广告归因 ROI 或利润率']
  ] as const) metrics.push({ key, label, format, definition, value: ratio(complete(current, a), complete(current, b)), reported: current.filter(c => n(c.report?.summary[a]) !== null && n(c.report?.summary[b]) !== null).length, expected: current.length })
  const comparable = scope.shops.filter(shop => {
    const c = current.filter(x => x.shopId === shop.shopId), p = previous.filter(x => x.shopId === shop.shopId)
    return complete(c, 'pay_amt') !== null && complete(p, 'pay_amt') !== null
  })
  const ids = new Set(comparable.map(s => s.shopId)), cc = current.filter(c => ids.has(c.shopId)), pc = previous.filter(c => ids.has(c.shopId))
  const cPay = complete(cc, 'pay_amt'), pPay = complete(pc, 'pay_amt'), delta = cPay !== null && pPay !== null ? Math.round((cPay - pPay) * 100) / 100 : null
  const shops: ShopAnalysis[] = scope.shops.map(shop => {
    const c = current.filter(x => x.shopId === shop.shopId), p = previous.filter(x => x.shopId === shop.shopId)
    const a = complete(c, 'pay_amt'), b = complete(p, 'pay_amt'), change = a !== null && b !== null ? Math.round((a - b) * 100) / 100 : null
    return { ...shop, availableDays: c.filter(x => x.report).length, pay: known(c, 'pay_amt'), spend: known(c, 'ad_spend'), visitors: known(c, 'visitor_count'), buyers: known(c, 'pay_buyer_count'), refund: known(c, 'refund_amt'), conversion: ratio(complete(c, 'pay_buyer_count'), complete(c, 'visitor_count')), ticket: ratio(a, complete(c, 'pay_buyer_count')), roi: ratio(a, complete(c, 'ad_spend')), delta: change, deltaRatio: ratio(change, b) }
  })
  const latest = current.filter(c => c.date === scope.endDate && c.report)
  function details(kind: 'products' | 'channels' | 'advertisements'): AnalysisDetail[] {
    return latest.flatMap(c => (kind === 'products' ? c.report!.shop_rows : kind === 'channels' ? c.report!.sections.channels : [c.report!.summary]).map(row => ({ shopId: c.shopId, shopName: scope.shops.find(s => s.shopId === c.shopId)!.shopName, date: c.date, values: row })))
  }
  const products = details('products').sort((a, b) => (n(b.values['pay_amt']) ?? -1) - (n(a.values['pay_amt']) ?? -1)), channels = details('channels'), advertisements = details('advertisements')
  const findings: AnalysisFinding[] = []
  const add = (f: AnalysisFinding): void => { findings.push(f) }
  if (delta !== null) add({ id: 'sales-change', priority: 'P1', title: '可比店铺支付变化', evidence: `${comparable.length} 家店在两个完整周期均有支付数据：${analysisFormat(pPay)} → ${analysisFormat(cPay)}，变化 ${analysisFormat(delta)}（${analysisFormat(ratio(delta, pPay), 'percent')}）。`, interpretation: '这是固定店铺集合的数值变化，不能单凭金额变化认定需求、投放或商品的因果影响。', impact: '先确认波动来源，再决定预算与商品动作。', action: '按店铺变化额排序，核对变化最大的商品、买家数与件数；识别集中成交后另列复盘。', validation: '各可比店铺支付变化额之和与总变化额一致；基期为 0 时不计算增长百分比。', owner: '运营负责人（建议）', confidence: '高', effort: '低', horizon: '7 天内', refs: refs([...cc, ...pc]) })
  for (const shop of shops) {
    const c = current.filter(x => x.shopId === shop.shopId), pay = complete(c, 'pay_amt'), spend = complete(c, 'ad_spend')
    if (pay !== null && spend !== null && spend > pay) add({ id: `spend:${shop.shopId}`, priority: 'P0', title: `${shop.shopName}：消耗高于支付`, evidence: `同周期支付 ${analysisFormat(pay)}，广告消耗 ${analysisFormat(spend)}，消耗高出 ${analysisFormat(spend - pay)}。`, interpretation: '这是支出压力信号；未计入成本，也未把全店支付归因给广告。', impact: '需优先核查低效消耗，避免依据高流量继续扩量。', action: '核对同窗计划级成交、预算和大件数订单；核实前不提高预算。', validation: '确认同一归因窗的计划成交与消耗，成本后贡献为正再评估扩量；连续完整日支付仍低于消耗则继续限额检查。', owner: '投放负责人（建议）', confidence: '高', effort: '中', horizon: '7 天内', refs: refs(c) })
    const p = previous.filter(x => x.shopId === shop.shopId), cu = complete(c, 'visitor_count'), pu = complete(p, 'visitor_count'), cb = complete(c, 'pay_buyer_count'), pb = complete(p, 'pay_buyer_count'), cr = ratio(cb, cu), pr = ratio(pb, pu)
    if (cu !== null && pu !== null && cu > pu && cr !== null && pr !== null && cr < pr) add({ id: `traffic:${shop.shopId}`, priority: 'P1', title: `${shop.shopName}：流量增长、转化下降`, evidence: `日访客合计 ${analysisFormat(pu, 'count')} → ${analysisFormat(cu, 'count')}；买家转化 ${analysisFormat(pr, 'percent')} → ${analysisFormat(cr, 'percent')}。`, interpretation: '优先假设是流量结构或商品承接变化；也可能受归因延迟、活动阶段影响，尚无因果证据。', impact: '访客增加未等比例转为买家，扩流之前需要定位效率损失。', action: '按相同来源、商品、人群对照完整日数据，一次验证一个变量。', validation: '比较可比来源的买家/访客与成本后贡献；贡献转负或样本不足时不扩大试验。', owner: '店铺运营（建议）', confidence: '中', effort: '中', horizon: '7 天内', refs: refs([...c, ...p]) })
  }
  // Concentration uses one shop/day denominator; never sum Top UV or buyers across products.
  for (const c of latest) {
    const pay = n(c.report!.summary['pay_amt']), candidates = products.filter(p => p.shopId === c.shopId), top = candidates[0], share = ratio(n(top?.values['pay_amt']), pay)
    if (top && share !== null && share >= 0.5 && share <= 1) add({ id: `concentration:${c.shopId}`, priority: 'P1', title: `${top.shopName}：成交集中于单品`, evidence: `${scope.endDate} 商品 ${String(top.values['item_id'] ?? '未提供 ID')} 支付 ${analysisFormat(n(top.values['pay_amt']))}，占当日全店支付 ${analysisFormat(share, 'percent')}。`, interpretation: '达到模板观察阈值 50%（非行业标准），提示成交集中；不等于利润爆款或稳定需求。', impact: '核心商品波动可能显著影响店铺总支付。', action: '核查该商品件数、买家、订单性质、履约及库存；将集中成交与常态成交分开。', validation: '取得订单与成本、库存证据后再确定补货或放量；不依据 Top 榜单断言全商品排名。', owner: '商品运营（建议）', confidence: '高', effort: '中', horizon: '7 天内', refs: refs([c]) })
  }
  const mismatch = latest.filter(c => { const s = c.report!.summary, spend = n(s['ad_spend']), raw = ratio(n(s['ad_pay_amt']), spend), platform = n(s['platform_ad_roi']); return raw !== null && platform !== null && Math.abs(raw - platform) > 0.01 })
  if (mismatch.length) add({ id: 'attribution', priority: 'P0', title: '广告归因字段与平台 ROI 不一致', evidence: `${mismatch.length} 家店在 ${scope.endDate} 的“归因成交字段 / 消耗”与平台 ROI 原值相差超过 0.01（仅为对账容差）。`, interpretation: '可能存在归因窗或统计范围差异；不能选择较高数值证明投放有效。', impact: '未对齐的数据会误导预算分配。', action: '逐店核对广告统计范围、归因窗与成交字段，保留两种原始口径。', validation: '差异有可复核解释后才用于跨店比较；否则仅展示，不给放量结论。', owner: '数据 + 投放负责人（建议）', confidence: '高', effort: '中', horizon: '7 天内', refs: refs(mismatch) })
  const warnings = [...new Set(cells.flatMap(c => [...(c.error ? [`${c.shopId} / ${c.date}：${c.error}`] : []), ...(c.report?.quality.warnings ?? [])]))]
  const available = current.filter(c => c.report).length
  if (available < current.length || metrics.some(m => m.reported < m.expected) || warnings.length) add({ id: 'coverage', priority: 'P0', title: '补齐数据与统计口径', evidence: `本期有效日报 ${available}/${current.length} 个店铺日；支付覆盖 ${metrics[0]!.reported}/${current.length}，退款覆盖 ${values(current, 'refund_amt').length}/${current.length}。`, interpretation: '部分汇总只代表已知范围；缺失不能当 0，Top 明细不能补作全店汇总。', impact: '部分覆盖下的增长、退款率和投产判断可能失真。', action: '核查缺失日期、登录状态和接口返回；优先补齐所选店铺日及退款口径。', validation: '所选店铺日逐一有明确状态；两期相关字段完整且店铺一致才比较，未知继续保留为空。', owner: '数据负责人（建议）', confidence: '高', effort: '低', horizon: '7 天内', refs: refs(current) })
  const order = { P0: 0, P1: 1, P2: 2 }
  const domainFindings = findings.filter(f => scope.template === 'overview' || ['coverage', 'sales-change'].includes(f.id) || (scope.template === 'merchandise' ? /^(traffic|concentration):/.test(f.id) : /^(spend:|attribution)/.test(f.id)))
  return { version: ANALYSIS_VERSION, scope, dates, previousDates, generatedAt, dataAsOf: cells.flatMap(c => c.report ? [c.report.meta.updated_at] : []).sort().at(-1) ?? null,
    available, expected: current.length, metrics, shops, findings: domainFindings.sort((a, b) => order[a.priority] - order[b.priority]),
    comparison: { shopCount: comparable.length, current: cPay, previous: pPay, delta, ratio: ratio(delta, pPay) },
    trend: dates.map(date => { const cs = current.filter(c => c.date === date); return { date, pay: known(cs, 'pay_amt'), coverage: values(cs, 'pay_amt').length, expected: scope.shops.length } }),
    products, channels, advertisements, cells, warnings, sources: refs(cells), normalizerVersions: [...new Set(cells.flatMap(c => c.report ? [c.report.meta.normalizer_version ?? '未标注'] : []))] }
}
