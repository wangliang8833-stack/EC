import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Empty, Select, Spin } from 'antd'
import type { AccountSummary } from '@ecommerce/shared'
import { ANALYSIS_TEMPLATES, analysisYesterday, buildCommerceAnalysis, loadAnalysisCells, type AnalysisScope, type AnalysisTemplate, type CommerceAnalysis } from './commerce-analysis-model.js'
import { CommerceAnalysisReport, renderCommerceAnalysisHtml } from './CommerceAnalysisReport.js'
import { HistoryBackfillPanel, useHistoryRevision } from './HistoryBackfillPanel.js'

export function CommerceAnalyticsView({ accounts, isPreview }: { accounts: AccountSummary[]; isPreview: boolean }): React.JSX.Element {
  const historyRevision = useHistoryRevision()
  const eligible = [...new Map(accounts.filter(a => a.enabled && a.platform === 'tmall').map(a => [a.shopId, { shopId: a.shopId, shopName: a.shopName }])).values()]
  const accountKey = JSON.stringify(eligible)
  const [shopIds, setShopIds] = useState<string[]>([])
  const [date, setDate] = useState(analysisYesterday)
  const [days, setDays] = useState<1 | 7 | 30>(1)
  const [template, setTemplate] = useState<AnalysisTemplate>('overview')
  const [report, setReport] = useState<CommerceAnalysis | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  // Invalidate synchronously on control changes; no previous scope can update/export this page.
  const invalidate = (): void => { generation.current++; setReport(null); setError(null); setLoading(false) }
  useEffect(() => {
    invalidate()
    setShopIds(previous => previous.filter(id => eligible.some(shop => shop.shopId === id)))
    return () => { generation.current++ }
  }, [accountKey, isPreview, historyRevision])

  async function generate(): Promise<void> {
    const id = ++generation.current
    setLoading(true); setError(null); setReport(null)
    try {
      if (isPreview || !window.desktopApi) throw new Error('浏览器预览没有本地业务数据，请在桌面程序中生成报告。')
      const scope: AnalysisScope = { endDate: date, days, template, shops: shopIds.length ? eligible.filter(s => shopIds.includes(s.shopId)) : eligible }
      const cells = await loadAnalysisCells(scope, q => window.desktopApi.reports.query(q), () => generation.current !== id)
      if (generation.current === id) setReport(buildCommerceAnalysis(scope, cells))
    } catch (reason) {
      if (generation.current === id) setError(reason instanceof Error ? reason.message : String(reason))
    } finally { if (generation.current === id) setLoading(false) }
  }

  function download(): void {
    if (!report || loading) return
    const url = URL.createObjectURL(new Blob([renderCommerceAnalysisHtml(report)], { type: 'text/html;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = `店铺数据分析_${report.scope.template}_${report.scope.endDate}_${report.scope.days}天.html`
    document.body.appendChild(anchor); anchor.click(); anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }

  return <section className="ai-workspace-page">
    <p className="commerce-analysis-intro">参照电商分析专家 Skill 制作的本地分析模板：证据 → 判断 → 经营影响 → 动作 → 验证。选择范围后生成，可导出离线 HTML。</p>
    <div className="commerce-analysis-controls">
      <label>分析模板<Select value={template} style={{ minWidth: 200 }} options={ANALYSIS_TEMPLATES.map(t => ({ value: t.id, label: t.name }))} onChange={(v: AnalysisTemplate) => { invalidate(); setTemplate(v) }} /></label>
      <label>店铺（留空为全部有效天猫店）<Select mode="multiple" allowClear value={shopIds.filter(id => eligible.some(s => s.shopId === id))} placeholder={`全部 ${eligible.length} 家店`} style={{ minWidth: 250, maxWidth: 420 }} options={eligible.map(s => ({ value: s.shopId, label: s.shopName }))} onChange={v => { invalidate(); setShopIds(v) }} /></label>
      <label>截止日期<input type="date" aria-label="分析截止日期" value={date} max={analysisYesterday()} onChange={e => { invalidate(); setDate(e.target.value) }} /></label>
      <label>周期<Select value={days} style={{ minWidth: 130 }} options={[{ value: 1, label: '单日诊断' }, { value: 7, label: '近 7 天复盘' }, { value: 30, label: '近 30 天复盘' }]} onChange={(v: 1 | 7 | 30) => { invalidate(); setDays(v) }} /></label>
      <Button type="primary" loading={loading} disabled={isPreview || eligible.length === 0} onClick={() => void generate()}>生成分析报告</Button>
      <HistoryBackfillPanel accounts={accounts} isPreview={isPreview} compact initialShopIds={shopIds.length ? shopIds : eligible.map(shop => shop.shopId)} initialDate={date} />
      {loading ? <Button onClick={invalidate}>取消生成</Button> : null}
    </div>
    <p className="commerce-analysis-intro">{ANALYSIS_TEMPLATES.find(t => t.id === template)?.description}。自动对照前一等长周期；不完整日期保留缺失，明细展示截止日 Top 样本。</p>
    {error ? <Alert type="error" showIcon title="生成失败" description={error} /> : null}
    {loading ? <div className="commerce-analysis-status"><Spin /><p>正在读取两个周期的本地日报并计算模板结果…</p></div> : report ? <>
      <div className="commerce-analysis-result-actions"><span>已生成 · 有效日报 {report.available}/{report.expected} 店铺日</span><Button disabled={report.available === 0} onClick={download}>导出 HTML 报告</Button></div>
      <CommerceAnalysisReport report={report} />
    </> : !error ? <div className="commerce-analysis-status"><Empty description={isPreview ? '桌面程序连接真实采集数据后即可生成，不使用模拟数据。' : eligible.length === 0 ? '暂无启用的天猫店铺，请先配置店铺并采集数据。' : '请选择店铺、日期和模板，生成可追溯的经营报告。'} /></div> : null}
  </section>
}
