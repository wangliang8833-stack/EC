export interface RoiCalculatorInput {
  price: number
  cost: number
  repurchaseRate: number
  repurchaseCycle: number
  dailyNewCustomers: number
  targetRoas: number
  forecastMonths: number
}

export interface RoiMonthlyRow {
  month: number
  newCustomers: number
  repurchaseCustomers: number
  revenue: number
  grossProfit: number
  advertisingCost: number
  netProfit: number
  cumulativeProfit: number
  cumulativeAdvertisingCost: number
}

export interface RoiCalculatorResult {
  grossMarginRate: number
  lifetimeValue: number
  acquisitionCost: number
  minimumProfitableRoas: number | null
  firstProfitableMonth: number | null
  advertisingCostBeforeProfit: number | null
  steadyMonthlyProfit: number
  monthly: RoiMonthlyRow[]
}

export const defaultRoiCalculatorInput: RoiCalculatorInput = {
  price: 30,
  cost: 10,
  repurchaseRate: 20,
  repurchaseCycle: 2,
  dailyNewCustomers: 200,
  targetRoas: 1.3,
  forecastMonths: 24
}

export function validateRoiCalculatorInput(input: RoiCalculatorInput): string[] {
  const errors: string[] = []
  if (!Number.isFinite(input.price) || input.price <= 0) errors.push('产品售价必须大于 0')
  if (!Number.isFinite(input.cost) || input.cost < 0) errors.push('产品成本不能为负数')
  if (Number.isFinite(input.price) && Number.isFinite(input.cost) && input.cost >= input.price) errors.push('产品成本必须小于产品售价')
  if (!Number.isFinite(input.repurchaseRate) || input.repurchaseRate < 0 || input.repurchaseRate >= 100) errors.push('复购率必须在 0%（含）到 100%（不含）之间')
  if (!Number.isInteger(input.repurchaseCycle) || input.repurchaseCycle < 0) errors.push('复购周期必须是非负整数，0 表示不计算复购')
  if (!Number.isFinite(input.dailyNewCustomers) || input.dailyNewCustomers < 0) errors.push('每日拉新不能为负数')
  if (!Number.isFinite(input.targetRoas) || input.targetRoas <= 0) errors.push('目标 ROAS 必须大于 0')
  if (!Number.isInteger(input.forecastMonths) || input.forecastMonths < 1 || input.forecastMonths > 240) errors.push('预测月数必须是 1 到 240 之间的整数')
  return errors
}

export function calculateRoi(input: RoiCalculatorInput): RoiCalculatorResult {
  const errors = validateRoiCalculatorInput(input)
  if (errors.length > 0) throw new Error(errors.join('\n'))

  const profitPerUnit = input.price - input.cost
  const repurchaseRate = input.repurchaseCycle > 0 ? input.repurchaseRate / 100 : 0
  const monthlyNewCustomers = input.dailyNewCustomers * 30
  const monthly = calculateMonthlyCashflow(input, input.targetRoas)
  const firstProfitableMonth = monthly.find((row) => row.cumulativeProfit > 0)?.month ?? null
  const steadyRows = monthly.slice(-Math.min(6, monthly.length))

  return {
    grossMarginRate: profitPerUnit / input.price,
    lifetimeValue: profitPerUnit / (1 - repurchaseRate),
    acquisitionCost: input.price / input.targetRoas,
    minimumProfitableRoas: monthlyNewCustomers > 0 ? findMinimumProfitableRoas(input) : null,
    firstProfitableMonth,
    advertisingCostBeforeProfit: firstProfitableMonth === null ? null : monthly[firstProfitableMonth - 1]?.cumulativeAdvertisingCost ?? null,
    steadyMonthlyProfit: average(steadyRows.map((row) => row.netProfit)),
    monthly
  }
}

export function calculateMonthlyCashflow(input: RoiCalculatorInput, roas: number): RoiMonthlyRow[] {
  const profitPerUnit = input.price - input.cost
  const monthlyNewCustomers = input.dailyNewCustomers * 30
  const acquisitionCost = input.price / roas
  const monthlyAdvertisingCost = monthlyNewCustomers * acquisitionCost
  const hasRepurchase = input.repurchaseCycle > 0 && input.repurchaseRate > 0
  const repurchaseRate = input.repurchaseRate / 100
  const repurchaseBuffer = hasRepurchase ? Array.from({ length: input.repurchaseCycle }, () => 0) : []
  const rows: RoiMonthlyRow[] = []
  let cumulativeProfit = 0
  let cumulativeAdvertisingCost = 0

  for (let month = 1; month <= input.forecastMonths; month += 1) {
    let repurchaseCustomers = 0
    if (hasRepurchase) {
      if (month > input.repurchaseCycle) {
        const previousPosition = (month - 1 - input.repurchaseCycle) % input.repurchaseCycle
        const previousRepurchases = repurchaseBuffer[previousPosition] ?? 0
        repurchaseCustomers = monthlyNewCustomers * repurchaseRate + previousRepurchases * repurchaseRate
      }
      repurchaseBuffer[(month - 1) % input.repurchaseCycle] = repurchaseCustomers
    }

    const grossProfit = (monthlyNewCustomers + repurchaseCustomers) * profitPerUnit
    const revenue = (monthlyNewCustomers + repurchaseCustomers) * input.price
    const netProfit = grossProfit - monthlyAdvertisingCost
    cumulativeProfit += netProfit
    cumulativeAdvertisingCost += monthlyAdvertisingCost
    rows.push({
      month,
      newCustomers: monthlyNewCustomers,
      repurchaseCustomers: Math.round(repurchaseCustomers),
      revenue,
      grossProfit,
      advertisingCost: monthlyAdvertisingCost,
      netProfit,
      cumulativeProfit,
      cumulativeAdvertisingCost
    })
  }
  return rows
}

function findMinimumProfitableRoas(input: RoiCalculatorInput): number | null {
  const searchInput = { ...input, forecastMonths: Math.min(input.forecastMonths, 120) }
  const isProfitable = (roas: number): boolean => calculateMonthlyCashflow(searchInput, roas).some((row) => row.cumulativeProfit > 0)
  if (!isProfitable(50)) return null
  let low = 0.01
  let high = 50
  for (let index = 0; index < 50; index += 1) {
    const middle = (low + high) / 2
    if (isProfitable(middle)) high = middle
    else low = middle
  }
  return high
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length
}
