import { describe, expect, it } from 'vitest'
import { calculateMonthlyCashflow, calculateRoi, defaultRoiCalculatorInput, validateRoiCalculatorInput } from './roi-calculator-model.js'

describe('ROI calculator model', () => {
  it('reproduces the source calculator monthly LTV/CAC cashflow model', () => {
    const result = calculateRoi(defaultRoiCalculatorInput)

    expect(result.grossMarginRate).toBeCloseTo(2 / 3)
    expect(result.lifetimeValue).toBeCloseTo(25)
    expect(result.acquisitionCost).toBeCloseTo(30 / 1.3)
    expect(result.monthly[0]).toMatchObject({ month: 1, newCustomers: 6000, repurchaseCustomers: 0, revenue: 180000, grossProfit: 120000 })
    expect(result.monthly[0]?.advertisingCost).toBeCloseTo(138461.53846153847)
    expect(result.monthly[2]).toMatchObject({ month: 3, repurchaseCustomers: 1200, revenue: 216000, grossProfit: 144000 })
  })

  it('finds the no-repurchase break-even ROAS from unit contribution margin', () => {
    const result = calculateRoi({ ...defaultRoiCalculatorInput, repurchaseRate: 0, repurchaseCycle: 0, targetRoas: 2, forecastMonths: 12 })
    expect(result.minimumProfitableRoas).toBeCloseTo(1.5, 8)
    expect(result.firstProfitableMonth).toBe(1)
  })

  it('does not invent a minimum profitable ROAS when there are no new customers', () => {
    const result = calculateRoi({ ...defaultRoiCalculatorInput, dailyNewCustomers: 0 })
    expect(result.minimumProfitableRoas).toBeNull()
    expect(result.firstProfitableMonth).toBeNull()
    expect(result.monthly.every((row) => row.netProfit === 0)).toBe(true)
  })

  it('validates unsafe and unsupported input ranges before calculating', () => {
    const errors = validateRoiCalculatorInput({ ...defaultRoiCalculatorInput, price: 0, cost: -1, repurchaseRate: 100, forecastMonths: 241 })
    expect(errors).toEqual(expect.arrayContaining(['产品售价必须大于 0', '产品成本不能为负数', '复购率必须在 0%（含）到 100%（不含）之间', '预测月数必须是 1 到 240 之间的整数']))
  })

  it('keeps the source calculator recurring repurchase cohort behavior', () => {
    const rows = calculateMonthlyCashflow({ ...defaultRoiCalculatorInput, forecastMonths: 5 }, 1.3)
    expect(rows.map(({ repurchaseCustomers }) => repurchaseCustomers)).toEqual([0, 0, 1200, 1200, 1440])
  })
})
