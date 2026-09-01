import { useMemo, useState } from 'react'
import { Alert, Button, InputNumber } from 'antd'
import { EChart, type DashboardChartOption } from './EChart.js'
import { calculateRoi, defaultRoiCalculatorInput, validateRoiCalculatorInput, type RoiCalculatorInput, type RoiCalculatorResult } from './roi-calculator-model.js'
import './roi-calculator.css'

type NumericInputKey = keyof RoiCalculatorInput

const inputFields: Array<{ key: NumericInputKey; label: string; suffix: string; hint: string; min: number; max?: number; step: number; precision: number }> = [
  { key: 'price', label: '产品售价', suffix: '元', hint: '每次成交的商品销售价', min: 0.01, step: 1, precision: 2 },
  { key: 'cost', label: '产品成本', suffix: '元', hint: '不包含推广费的单件成本', min: 0, step: 1, precision: 2 },
  { key: 'repurchaseRate', label: '复购率', suffix: '%', hint: '每个复购周期的客户复购比例', min: 0, max: 99.99, step: 1, precision: 2 },
  { key: 'repurchaseCycle', label: '复购周期', suffix: '月', hint: '填 0 表示不计算复购', min: 0, max: 240, step: 1, precision: 0 },
  { key: 'dailyNewCustomers', label: '每日拉新', suffix: '人', hint: '按每月 30 天换算新增客户', min: 0, step: 10, precision: 0 },
  { key: 'targetRoas', label: '目标 ROAS', suffix: '', hint: '推广成交金额 ÷ 广告消耗', min: 0.01, step: 0.1, precision: 2 },
  { key: 'forecastMonths', label: '预测月数', suffix: '月', hint: '支持 1–240 个月', min: 1, max: 240, step: 1, precision: 0 }
]

export function RoiCalculator(): React.JSX.Element {
  const [draft, setDraft] = useState<RoiCalculatorInput>({ ...defaultRoiCalculatorInput })
  const [applied, setApplied] = useState<RoiCalculatorInput>({ ...defaultRoiCalculatorInput })
  const [errors, setErrors] = useState<string[]>([])
  const result = useMemo(() => calculateRoi(applied), [applied])
  const cumulativeOption = useMemo(() => cumulativeProfitOption(result), [result])
  const monthlyProfitOption = useMemo(() => monthlyProfitOptionFor(result), [result])
  const cashflowOption = useMemo(() => cashflowTrendOption(result), [result])

  function updateInput(key: NumericInputKey, value: number | null): void {
    setDraft((current) => ({ ...current, [key]: value ?? 0 }))
  }

  function recalculate(): void {
    const nextErrors = validateRoiCalculatorInput(draft)
    setErrors(nextErrors)
    if (nextErrors.length === 0) setApplied({ ...draft })
  }

  function reset(): void {
    setDraft({ ...defaultRoiCalculatorInput })
    setApplied({ ...defaultRoiCalculatorInput })
    setErrors([])
  }

  return <div className="roi-page">
    <section className="roi-input-panel">
      <header className="roi-panel-head"><div><h2>推广测算参数</h2><p>使用 LTV / CAC 复购模型，修改参数后点击“重新计算”</p></div><span className="roi-model-chip">本地计算 · 不上传数据</span></header>
      <div className="roi-input-grid">
        {inputFields.map((field) => <label className="roi-input-field" key={field.key}>
          <span>{field.label}</span>
          <span className={`roi-number-control ${field.suffix ? '' : 'without-suffix'}`}><InputNumber<number> value={draft[field.key]} min={field.min} {...(field.max === undefined ? {} : { max: field.max })} step={field.step} precision={field.precision} controls onChange={(value) => updateInput(field.key, value)} aria-label={field.label} />{field.suffix ? <b>{field.suffix}</b> : null}</span>
          <small>{field.hint}</small>
        </label>)}
      </div>
      {errors.length > 0 ? <Alert className="roi-error" type="error" showIcon title="请检查测算参数" description={errors.join('；')} /> : null}
      <div className="roi-form-actions"><Button type="primary" onClick={recalculate}>重新计算</Button><Button onClick={reset}>恢复示例值</Button><Button onClick={() => exportCsv(applied, result)}>导出逐月 CSV</Button><span>当前结果：售价 {money(applied.price)} · 成本 {money(applied.cost)} · 目标 ROAS {decimal(applied.targetRoas, 2)}</span></div>
    </section>

    <section className="roi-kpi-grid">
      <RoiKpi label="毛利率" value={percent(result.grossMarginRate)} note="（售价 − 成本）÷ 售价" tone="accent" />
      <RoiKpi label="客户终身价值 LTV" value={money(result.lifetimeValue)} note="含持续复购贡献毛利" />
      <RoiKpi label="获客成本 CAC" value={money(result.acquisitionCost)} note="售价 ÷ 目标 ROAS" />
      <RoiKpi label="最小盈利 ROAS" value={nullableDecimal(result.minimumProfitableRoas, 4)} note={`最多检验 ${Math.min(applied.forecastMonths, 120)} 个月`} tone="success" />
      <RoiKpi label="首次盈利月份" value={result.firstProfitableMonth === null ? '预测期内未盈利' : `第 ${result.firstProfitableMonth} 个月`} note="累计利润首次大于 0" tone={result.firstProfitableMonth === null ? 'danger' : 'success'} />
      <RoiKpi label="盈利前广告投入" value={nullableMoney(result.advertisingCostBeforeProfit)} note="截至首次盈利月累计消耗" />
      <RoiKpi label="稳态月利润" value={money(result.steadyMonthlyProfit)} note="预测期最后 6 个月均值" tone={result.steadyMonthlyProfit >= 0 ? 'success' : 'danger'} />
    </section>

    <section className="roi-chart-grid">
      <article className="roi-panel roi-chart-primary"><RoiPanelHead title="累计利润趋势" note="观察项目何时穿过盈亏平衡线" /><EChart option={cumulativeOption} height={300} ariaLabel="累计利润趋势图" /></article>
      <article className="roi-panel roi-model-note"><RoiPanelHead title="当前模型结论" note="结果随上方参数重新计算" /><div className={`roi-conclusion ${result.firstProfitableMonth === null ? 'loss' : 'profit'}`}><strong>{result.firstProfitableMonth === null ? '预测期内未达到盈亏平衡' : `预计第 ${result.firstProfitableMonth} 个月转为累计盈利`}</strong><p>{result.minimumProfitableRoas === null ? '每日拉新为 0，无法计算可执行的保本 ROAS。' : `当前目标 ROAS 为 ${decimal(applied.targetRoas, 2)}，模型测得最小盈利 ROAS 约为 ${decimal(result.minimumProfitableRoas, 4)}。`}</p></div><dl className="roi-formulas"><div><dt>月新增</dt><dd>每日拉新 × 30</dd></div><div><dt>获客成本</dt><dd>售价 ÷ ROAS</dd></div><div><dt>月净利润</dt><dd>新客与复购毛利 − 广告费</dd></div><div><dt>复购递推</dt><dd>新客复购 + 上轮复购再复购</dd></div></dl></article>
      <article className="roi-panel"><RoiPanelHead title="月度净利润" note="绿色为盈利，红色为亏损" /><EChart option={monthlyProfitOption} height={265} ariaLabel="月度净利润图" /></article>
      <article className="roi-panel"><RoiPanelHead title="月度现金流趋势" note="与原工具相同，以月净利润表示净流入或净流出" /><EChart option={cashflowOption} height={265} ariaLabel="月度现金流趋势图" /></article>
    </section>

    <section className="roi-panel roi-table-panel"><RoiPanelHead title="逐月明细数据" note={`${result.monthly.length} 个月 · 金额单位为人民币元`} /><div className="roi-table-wrap"><table className="roi-table"><thead><tr><th>月份</th><th>新增客户</th><th>复购客户</th><th>销售额</th><th>毛利</th><th>广告成本</th><th>净利润</th><th>累计利润</th><th>累计广告</th></tr></thead><tbody>{result.monthly.map((row) => <tr key={row.month} className={row.netProfit >= 0 ? 'profit' : 'loss'}><td>第 {row.month} 月</td><td>{integer(row.newCustomers)}</td><td>{integer(row.repurchaseCustomers)}</td><td>{money(row.revenue)}</td><td>{money(row.grossProfit)}</td><td>{money(row.advertisingCost)}</td><td>{money(row.netProfit)}</td><td>{money(row.cumulativeProfit)}</td><td>{money(row.cumulativeAdvertisingCost)}</td></tr>)}</tbody></table></div></section>
  </div>
}

function RoiKpi({ label, value, note, tone = '' }: { label: string; value: string; note: string; tone?: 'accent' | 'success' | 'danger' | '' }): React.JSX.Element {
  return <article className={`roi-kpi ${tone}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>
}

function RoiPanelHead({ title, note }: { title: string; note: string }): React.JSX.Element {
  return <header className="roi-panel-head"><div><h2>{title}</h2><p>{note}</p></div></header>
}

function cumulativeProfitOption(result: RoiCalculatorResult): DashboardChartOption {
  const data = result.monthly.map((row) => roundMoney(row.cumulativeProfit / 10000))
  return {
    animationDuration: 400,
    tooltip: { trigger: 'axis', valueFormatter: (value: unknown) => `${Number(value).toLocaleString('zh-CN')} 万元` },
    grid: { left: 58, right: 18, top: 34, bottom: 38 },
    xAxis: { type: 'category', data: result.monthly.map((row) => `${row.month}月`), axisTick: { show: false }, axisLabel: { color: '#88847d' } },
    yAxis: { type: 'value', axisLabel: { color: '#88847d', formatter: (value: number) => `${value}万` }, splitLine: { lineStyle: { color: '#eeece7' } } },
    series: [{ name: '累计利润', type: 'line', smooth: 0.25, symbol: 'circle', symbolSize: 5, data, lineStyle: { color: '#2d7ff9', width: 3 }, itemStyle: { color: '#2d7ff9' }, areaStyle: { color: 'rgba(45,127,249,.10)' }, markLine: { silent: true, symbol: 'none', lineStyle: { color: '#d75c48', type: 'dashed' }, data: [{ yAxis: 0, name: '盈亏平衡' }] } }]
  }
}

function monthlyProfitOptionFor(result: RoiCalculatorResult): DashboardChartOption {
  return {
    tooltip: { trigger: 'axis', valueFormatter: (value: unknown) => `${Number(value).toLocaleString('zh-CN')} 万元` },
    grid: { left: 56, right: 16, top: 30, bottom: 36 },
    xAxis: { type: 'category', data: result.monthly.map((row) => `${row.month}月`), axisTick: { show: false }, axisLabel: { color: '#88847d' } },
    yAxis: { type: 'value', axisLabel: { color: '#88847d', formatter: (value: number) => `${value}万` }, splitLine: { lineStyle: { color: '#eeece7' } } },
    series: [{ name: '月度净利润', type: 'bar', barMaxWidth: 24, data: result.monthly.map((row) => ({ value: roundMoney(row.netProfit / 10000), itemStyle: { color: row.netProfit >= 0 ? '#2f9e54' : '#e05a47', borderRadius: row.netProfit >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4] } })) }]
  }
}

function cashflowTrendOption(result: RoiCalculatorResult): DashboardChartOption {
  return {
    tooltip: { trigger: 'axis', valueFormatter: (value: unknown) => `${Number(value).toLocaleString('zh-CN')} 万元` },
    grid: { left: 56, right: 16, top: 30, bottom: 36 },
    xAxis: { type: 'category', data: result.monthly.map((row) => `${row.month}月`), axisTick: { show: false }, axisLabel: { color: '#88847d' } },
    yAxis: { type: 'value', axisLabel: { color: '#88847d', formatter: (value: number) => `${value}万` }, splitLine: { lineStyle: { color: '#eeece7' } } },
    series: [{ name: '月度现金流', type: 'line', smooth: 0.28, symbol: 'circle', symbolSize: 5, data: result.monthly.map((row) => roundMoney(row.netProfit / 10000)), lineStyle: { color: '#239c77', width: 3 }, itemStyle: { color: '#239c77' }, areaStyle: { color: 'rgba(35,156,119,.10)' } }]
  }
}

function exportCsv(input: RoiCalculatorInput, result: RoiCalculatorResult): void {
  const rows: Array<Array<string | number>> = [
    ['商品推广策划盈亏平衡分析 - 逐月明细数据'],
    ['售价', input.price, '成本', input.cost, '复购率', `${input.repurchaseRate}%`, '复购周期', `${input.repurchaseCycle}个月`],
    ['每日拉新', input.dailyNewCustomers, '目标ROAS', input.targetRoas, '预测月数', input.forecastMonths],
    [],
    ['月份', '新增客户', '复购客户', '销售额(元)', '毛利(元)', '广告成本(元)', '净利润(元)', '累计利润(元)', '累计广告(元)'],
    ...result.monthly.map((row) => [row.month, row.newCustomers, row.repurchaseCustomers, roundMoney(row.revenue), roundMoney(row.grossProfit), roundMoney(row.advertisingCost), roundMoney(row.netProfit), roundMoney(row.cumulativeProfit), roundMoney(row.cumulativeAdvertisingCost)])
  ]
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = '商品推广盈亏分析_逐月明细.csv'
  anchor.click()
  URL.revokeObjectURL(url)
}

function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

function roundMoney(value: number): number { return Math.round(value * 100) / 100 }
function decimal(value: number, digits: number): string { return value.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits }) }
function nullableDecimal(value: number | null, digits: number): string { return value === null ? '—' : decimal(value, digits) }
function money(value: number): string { return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
function nullableMoney(value: number | null): string { return value === null ? '—' : money(value) }
function integer(value: number): string { return Math.round(value).toLocaleString('zh-CN') }
function percent(value: number): string { return `${decimal(value * 100, 2)}%` }
