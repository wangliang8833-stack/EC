import { dashboardColumns, dashboardMoney, type DashboardDetail } from './dashboard-report-model.js'

export function DashboardReportTable({ rows, detail, multipleShops, multipleDays = false }: {
  rows: Array<Record<string, string | number | null>>
  detail: DashboardDetail
  multipleShops: boolean
  multipleDays?: boolean
}): React.JSX.Element {
  if (rows.length === 0) return <div className="report-empty">本次未返回记录</div>
  const columns = dashboardColumns(detail, multipleShops, multipleDays)
  return <div className="ranking-table-wrap"><table className="ranking-table">
    <thead><tr>{columns.map(([key, label]) => <th key={key}>{label}</th>)}</tr></thead>
    <tbody>{rows.map((row, index) => <tr key={index}>{columns.map(([key]) => <td key={key} title={String(row[key] ?? '')}>{key.includes('amt') ? dashboardMoney(row[key]) : String(row[key] ?? '—')}</td>)}</tr>)}</tbody>
  </table></div>
}
