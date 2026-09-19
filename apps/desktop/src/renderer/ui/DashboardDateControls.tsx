import { Button } from 'antd'
import { dashboardPreset, dashboardRangeLabel, type DashboardDateRange, type DashboardPeriod, type ReportDataset } from '@ecommerce/shared'

export function DashboardDateControls({ range, period, today, disabled, onChange, children }: {
  range: DashboardDateRange; period: DashboardPeriod; today: string; disabled: boolean
  children?: React.ReactNode
  onChange: (range: DashboardDateRange, period: DashboardPeriod) => void
}): React.JSX.Element {
  return <div className="dashboard-date-control">
    <label htmlFor="dashboard-date-start">数据日期</label>
    <input id="dashboard-date-start" aria-label="销售总览开始日期" type="date" value={range.dateStart} max={today} disabled={disabled} onChange={event => onChange({ ...range, dateStart: event.target.value }, 'custom')} />
    <span>至</span>
    <input id="dashboard-biz-date" aria-label="销售总览结束日期" type="date" value={range.dateEnd} max={today} disabled={disabled} onChange={event => onChange({ ...range, dateEnd: event.target.value }, 'custom')} />
    <div className="dashboard-date-shortcuts">{(['today', 'yesterday', 'week', 'month'] as const).map(value => <Button key={value} size="small" type={period === value ? 'primary' : 'default'} disabled={disabled} onClick={() => onChange(dashboardPreset(value, range.dateEnd, today), value)}>
      {{ today: '今天', yesterday: '昨日', week: '周', month: '月' }[value]}{period === value && (value === 'week' || value === 'month') ? `（${dashboardRangeLabel(range)}）` : ''}
    </Button>)}{children}</div>
  </div>
}

export function DashboardCoverageNotice({ dataset, loading, error, emptyScope, preview }: {
  dataset: Pick<ReportDataset, 'dashboard_coverage'> | null; loading: boolean; error: boolean; emptyScope: boolean; preview: boolean
}): React.JSX.Element {
  const coverage = dataset?.dashboard_coverage
  if (preview || emptyScope || loading || error || !coverage) return <span className="dashboard-coverage-neutral" role="status">{preview ? '演示数据不参与完整性检查' : emptyScope ? '请选择有效店铺' : error ? '无法检查当前范围的数据完整性' : '正在检查所选范围数据…'}</span>
  const missing = coverage.shops.filter(shop => shop.missingDates.length || shop.incompleteDates.length)
  return <details className={`dashboard-coverage-dropdown ${missing.length ? 'dashboard-coverage-missing' : 'dashboard-coverage-complete'}`}>
    <summary><span role="status">{missing.length ? '数据有缺失' : '数据完整'}</span><span className="dashboard-coverage-arrow" aria-hidden="true">▼</span></summary>
    <div className="dashboard-coverage-details">
      <strong>{missing.length ? `${missing.length} 家店铺数据有缺失` : '所选店铺各日总览核心指标完整'}</strong>
      <p>已读取 {coverage.reportedShopDays}/{coverage.expectedShopDays} 个店铺日。完整性检查：支付金额、订单数、买家数、访客数、浏览量、退款金额和广告消耗；Top 与客服明细覆盖另见下方说明。</p>
      {missing.map(shop => <div key={`${shop.platform}/${shop.shopId}`}><strong>{shop.shopName}（{shop.platform}）</strong>
        {shop.missingDates.length ? <p>缺少日报：{shop.missingDates.join('、')}</p> : null}
        {shop.incompleteDates.map(day => <p key={day.date}>{day.date}：{day.metrics.join('、')}</p>)}
      </div>)}
    </div>
  </details>
}
