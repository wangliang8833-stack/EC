import { isBusinessDate, shiftBusinessDate } from './history-backfill.js'

export interface DashboardDateRange { dateStart: string; dateEnd: string }
export type DashboardPeriod = 'today' | 'yesterday' | 'week' | 'month' | 'custom'
export interface DashboardCoverage {
  expectedShopDays: number
  reportedShopDays: number
  completeShopCount: number
  shops: Array<{
    platform: string
    shopId: string
    shopName: string
    missingDates: string[]
    incompleteDates: Array<{ date: string; metrics: string[] }>
  }>
}

// Querying saved reports is independent of the 30-day collection window.
export function dashboardDates(start: string, end: string): string[] {
  if (!isBusinessDate(start) || !isBusinessDate(end) || start > end) throw new TypeError('请选择有效且开始不晚于结束的日期范围')
  const count = (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 + 1
  if (count > 366) throw new RangeError('销售总览单次最多查询 366 天')
  return Array.from({ length: count }, (_, index) => shiftBusinessDate(start, index))
}

export function dashboardPreset(period: Exclude<DashboardPeriod, 'custom'>, anchor: string, today: string): DashboardDateRange {
  const yesterday = shiftBusinessDate(today, -1)
  if (period === 'today' || period === 'yesterday') {
    const date = period === 'today' ? today : yesterday
    return { dateStart: date, dateEnd: date }
  }
  const date = isBusinessDate(anchor) && anchor < today ? anchor : yesterday
  if (!isBusinessDate(date)) throw new TypeError('日期无效')
  const day = new Date(`${date}T00:00:00Z`)
  const start = period === 'week' ? shiftBusinessDate(date, -((day.getUTCDay() + 6) % 7)) : `${date.slice(0, 7)}-01`
  const end = period === 'week' ? shiftBusinessDate(start, 6) : new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0)).toISOString().slice(0, 10)
  return { dateStart: start, dateEnd: end < today ? end : yesterday }
}

export function dashboardRangeLabel(range: DashboardDateRange): string {
  const label = (date: string): string => `${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日`
  const crossYear = range.dateStart.slice(0, 4) !== range.dateEnd.slice(0, 4)
  return crossYear ? `${range.dateStart}—${range.dateEnd}` : `${label(range.dateStart)}—${label(range.dateEnd)}`
}
