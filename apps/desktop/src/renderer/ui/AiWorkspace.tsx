import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Empty, Modal, Select, Space, Spin, Table, Tag, message } from 'antd'
import type { AccountSummary, AiDecisionRecord, AiModelSettings, ReportDataset } from '@ecommerce/shared'
import { buildOperationProposals, buildSelectionOpportunities, type OperationProposalRow, type SelectionOpportunityRow } from './ai-workspace-model.js'

interface AiPageProps {
  accounts: AccountSummary[]
  isPreview: boolean
  settings: AiModelSettings | null
  model: string | null
  onModelChange: (model: string) => void
  onOpenSettings: () => void
}

interface LoadedReports { business: ReportDataset; promotion: ReportDataset }

export function AiModelStatus({ settings, model, onModelChange, onOpenSettings }: Pick<AiPageProps, 'settings' | 'model' | 'onModelChange' | 'onOpenSettings'>): React.JSX.Element {
  const connected = Boolean(settings?.apiKeyConfigured && settings.models.length > 0)
  return <div className={`ai-model-status ${connected ? 'connected' : 'disconnected'}`}>
    <span className="ai-model-dot" />
    {connected ? <>
      <span>大模型：</span>
      {settings!.models.length > 1 ? <Select size="small" value={model ?? settings!.defaultModel ?? null} options={settings!.models.map((value) => ({ value, label: value }))} onChange={onModelChange} popupMatchSelectWidth={false} /> : <strong>{settings!.models[0]}</strong>}
    </> : <strong>未接入AI模型</strong>}
    <Button size="small" type="link" onClick={onOpenSettings}>{connected ? '管理' : '前往设置'}</Button>
  </div>
}

export function AiSelectionView(props: AiPageProps): React.JSX.Element {
  const { reports, loading, error, reload } = useAiReports(props.accounts, props.isPreview)
  const [selected, setSelected] = useState<SelectionOpportunityRow | null>(null)
  const [aiOutput, setAiOutput] = useState<Record<string, unknown> | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [decisions, setDecisions] = useState<AiDecisionRecord[]>([])
  const rows = useMemo(() => reports ? buildSelectionOpportunities(reports.business) : [], [reports])
  const [messageApi, context] = message.useMessage()
  const top = rows[0]
  useEffect(() => { if (window.desktopApi && !props.isPreview) void window.desktopApi.ai.listDecisions('selection').then(setDecisions).catch(() => undefined) }, [props.isPreview])

  async function analyze(row: SelectionOpportunityRow): Promise<void> {
    if (!canUseModel(props.settings, props.model)) { props.onOpenSettings(); return }
    setSelected(row); setAnalyzing(true); setAiOutput(null)
    try {
      const result = await window.desktopApi.ai.generate({
        task: 'product_selection_analysis', model: props.model!,
        systemPrompt: '你是电商选品分析师。只能解释程序已经计算出的候选分数和证据，不得重新计算分数或虚构市场数据。输出 recommendation、summary、reason_codes、main_risks、test_plan、unknowns 和 confidence。',
        input: { score_version: 'selection-score-v1.0.0', opportunity: row, data_quality: reports?.business.quality }
      })
      setAiOutput(result.output)
    } catch (reason) { messageApi.error(errorMessage(reason)) } finally { setAnalyzing(false) }
  }

  async function saveSelectionDecision(action: 'ADD_TO_POOL' | 'WATCH' | 'REJECT'): Promise<void> {
    if (!selected || props.isPreview || !window.desktopApi) { messageApi.info('浏览器预览不会保存业务决策。'); return }
    try {
      const decision = await window.desktopApi.ai.saveDecision({ module: 'selection', entityId: selected.id, action, summary: `${selected.title} · ${action}`, payload: { opportunity: selected, score_version: 'selection-score-v1.0.0', ai_analysis: aiOutput } })
      setDecisions((previous) => previous.some(({ decisionId }) => decisionId === decision.decisionId) ? previous : [decision, ...previous])
      messageApi.success(action === 'ADD_TO_POOL' ? '已加入候选池并保存评分快照。' : action === 'WATCH' ? '已加入持续观察。' : '已保存暂不考虑决策。')
    } catch (reason) { messageApi.error(errorMessage(reason)) }
  }

  return <section className="ai-workspace-page">
    {context}<AiModelStatus {...props} />
    <div className="ai-kpi-grid">
      <AiKpi label="经营机会" value={String(rows.length)} note="来自已采集商品事实" />
      <AiKpi label="候选商品池" value={String(decisions.filter(({ action }) => action === 'ADD_TO_POOL').length)} note="已保存人工决策" tone="success" />
      <AiKpi label="最高综合分" value={top ? top.overallScore.toFixed(1) : '—'} note={top?.title ?? '等待商品数据'} tone="accent" />
      <AiKpi label="数据质量" value={reports?.business.quality.status ?? '—'} note={reports ? `${reports.business.quality.warning_count} 条警告` : '尚未读取'} />
    </div>
    <AiDataState loading={loading} error={error} empty={!reports || rows.length === 0} onReload={reload} emptyText="尚无可用于选品评分的商品明细，请先完成店铺数据采集。">
      <div className="ai-panel">
        <div className="ai-panel-heading"><div><h2>商品经营机会榜</h2><p>市场分、本店适配分与风险分由确定性规则计算；AI 只解释榜单候选。</p></div><Tag color="blue">selection-score-v1.0.0</Tag></div>
        <Table rowKey="id" size="small" pagination={{ pageSize: 10 }} dataSource={rows} scroll={{ x: 980 }} onRow={(row) => ({ onClick: () => setSelected(row) })} columns={[
          { title: '商品', dataIndex: 'title', width: 240, render: (value: string, row) => <div className="ai-table-primary"><strong>{value}</strong><span>{row.shopName} · {row.itemId}</span></div> },
          { title: '经营机会分', dataIndex: 'marketScore', sorter: (a, b) => a.marketScore - b.marketScore },
          { title: '本店适配分', dataIndex: 'storeFitScore', sorter: (a, b) => a.storeFitScore - b.storeFitScore },
          { title: '风险安全分', dataIndex: 'riskScore' },
          { title: '综合分', dataIndex: 'overallScore', render: (value: number) => <strong>{value.toFixed(1)}</strong>, sorter: (a, b) => a.overallScore - b.overallScore, defaultSortOrder: 'descend' },
          { title: '等级', dataIndex: 'grade', render: (value: string) => <Tag color={gradeColor(value)}>{value}</Tag> },
          { title: '转化率', dataIndex: 'conversionRate', render: formatPercent },
          { title: '退款影响率', dataIndex: 'refundRate', render: formatPercent },
          { title: '置信度', dataIndex: 'confidence', render: formatPercent },
          { title: '操作', fixed: 'right', width: 92, render: (_, row) => <Button size="small" type="link" onClick={(event) => { event.stopPropagation(); void analyze(row) }}>AI分析</Button> }
        ]} />
      </div>
    </AiDataState>
    <Modal width={700} open={selected !== null} title={selected ? `机会详情 · ${selected.title}` : '机会详情'} onCancel={() => { setSelected(null); setAiOutput(null) }} footer={<Space><Button onClick={() => void saveSelectionDecision('REJECT')}>暂不考虑</Button><Button onClick={() => void saveSelectionDecision('WATCH')}>持续观察</Button><Button onClick={() => void saveSelectionDecision('ADD_TO_POOL')}>加入候选池</Button>{selected ? <Button type="primary" loading={analyzing} onClick={() => void analyze(selected)}>生成 AI 分析</Button> : null}</Space>}>
      {selected ? <><div className="ai-score-strip"><span>综合分 <strong>{selected.overallScore}</strong></span><span>等级 <strong>{selected.grade}</strong></span><span>置信度 <strong>{formatPercent(selected.confidence)}</strong></span></div><EvidenceList rows={selected.sourceSnapshotIds} />{analyzing ? <div className="ai-loading"><Spin /><span>正在基于有限候选证据生成结构化分析…</span></div> : aiOutput ? <StructuredOutput value={aiOutput} /> : <Alert type="info" showIcon title="确定性评分已完成" description="点击生成 AI 分析后，模型将给出推荐理由、风险和测款建议；不会自动采购、上架或投放。" />}</> : null}
    </Modal>
  </section>
}

export function AiOperationsView(props: AiPageProps): React.JSX.Element {
  const { reports, loading, error, reload } = useAiReports(props.accounts, props.isPreview)
  const proposals = useMemo(() => reports ? buildOperationProposals(reports.business, reports.promotion) : [], [reports])
  const [selected, setSelected] = useState<OperationProposalRow | null>(null)
  const [aiOutput, setAiOutput] = useState<Record<string, unknown> | null>(null)
  const [running, setRunning] = useState(false)
  const [decisions, setDecisions] = useState<AiDecisionRecord[]>([])
  const [messageApi, context] = message.useMessage()
  useEffect(() => { if (window.desktopApi && !props.isPreview) void window.desktopApi.ai.listDecisions('operations').then(setDecisions).catch(() => undefined) }, [props.isPreview])

  async function createStrategy(row: OperationProposalRow): Promise<void> {
    if (!canUseModel(props.settings, props.model)) { props.onOpenSettings(); return }
    setSelected(row); setRunning(true); setAiOutput(null)
    try {
      const result = await window.desktopApi.ai.generate({
        task: 'ecommerce_operation_strategy', model: props.model!,
        systemPrompt: '你是电商运营策略分析师。只可基于给定 Signal 形成建议，不得执行动作。输出 summary、recommended_action、expected_effect、risk_level、evidence_refs、unknowns 和 confidence。涉及预算、出价、暂停或上架的动作必须标记 APPROVAL_REQUIRED。',
        input: { automation_level: 'L1', policy: { human_approval_required: true, max_budget_change_ratio: 0.1, emergency_stop: false }, signal: row }
      })
      setAiOutput(result.output)
    } catch (reason) { messageApi.error(errorMessage(reason)) } finally { setRunning(false) }
  }

  async function submitForApproval(): Promise<void> {
    if (!selected || !aiOutput || props.isPreview || !window.desktopApi) return
    try {
      const decision = await window.desktopApi.ai.saveDecision({ module: 'operations', entityId: selected.id, action: 'SUBMIT_FOR_APPROVAL', summary: `${selected.target} · ${selected.action}`, payload: { signal: selected, strategy: aiOutput, policy_version: 'operations-policy-v1.0.0' } })
      setDecisions((previous) => previous.some(({ decisionId }) => decisionId === decision.decisionId) ? previous : [decision, ...previous])
      messageApi.success('已提交审批中心；不会自动执行平台写操作。')
    } catch (reason) { messageApi.error(errorMessage(reason)) }
  }

  return <section className="ai-workspace-page">
    {context}<AiModelStatus {...props} />
    <Alert className="ai-safety-banner" type="info" showIcon title="当前自动化等级：L1（AI 建议 + 人工审批）" description="规则引擎先发现问题，模型只生成建议。任何平台写操作都不会绕过策略校验和人工审批；当前版本未启用无人值守写操作。" />
    <div className="ai-kpi-grid">
      <AiKpi label="问题与机会" value={String(proposals.length)} note="确定性 Signal" />
      <AiKpi label="低风险建议" value={String(proposals.filter(({ risk }) => risk === 'LOW').length)} note="仍需人工审批" tone="success" />
      <AiKpi label="高风险拦截" value={String(proposals.filter(({ risk }) => risk === 'HIGH').length)} note="禁止自动执行" tone="danger" />
      <AiKpi label="待审批动作" value={String(decisions.filter(({ action }) => action === 'SUBMIT_FOR_APPROVAL').length)} note="持久化审批队列" />
    </div>
    <AiDataState loading={loading} error={error} empty={!reports || proposals.length === 0} onReload={reload} emptyText="当前数据未触发运营规则，或尚未采集推广/商品明细。">
      <div className="ai-panel"><div className="ai-panel-heading"><div><h2>问题与机会</h2><p>每条建议都包含规则证据、数据快照和风险等级。</p></div><Tag color="geekblue">Policy L1</Tag></div>
        <Table rowKey="id" size="small" dataSource={proposals} pagination={{ pageSize: 10 }} columns={[
          { title: '对象', dataIndex: 'target', width: 210, render: (value: string, row) => <div className="ai-table-primary"><strong>{value}</strong><span>{row.shopName}</span></div> },
          { title: '问题', dataIndex: 'summary', width: 330 },
          { title: '规则建议', dataIndex: 'action', width: 240 },
          { title: '风险', dataIndex: 'risk', render: (value: string) => <Tag color={value === 'HIGH' ? 'red' : value === 'MEDIUM' ? 'orange' : 'green'}>{value}</Tag> },
          { title: '置信度', dataIndex: 'confidence', render: formatPercent },
          { title: '操作', width: 110, render: (_, row) => <Button type="link" size="small" onClick={() => void createStrategy(row)}>生成 AI 策略</Button> }
        ]} />
      </div>
    </AiDataState>
    <Modal width={720} open={selected !== null} title="AI 运营策略" onCancel={() => { setSelected(null); setAiOutput(null) }} footer={<Space><Button onClick={() => setSelected(null)}>关闭</Button><Button type="primary" disabled={!aiOutput} onClick={() => void submitForApproval()}>提交人工审批</Button></Space>}>
      {selected ? <><Alert type="warning" showIcon title="策略仅供审批，不会直接执行" description={`${selected.target} · ${selected.action}`} /><EvidenceList rows={selected.sourceSnapshotIds} />{running ? <div className="ai-loading"><Spin /><span>正在生成结构化策略…</span></div> : aiOutput ? <StructuredOutput value={aiOutput} /> : null}</> : null}
    </Modal>
  </section>
}

function useAiReports(accounts: AccountSummary[], isPreview: boolean): { reports: LoadedReports | null; loading: boolean; error: string | null; reload: () => void } {
  const [reports, setReports] = useState<LoadedReports | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let cancelled = false
    async function load(): Promise<void> {
      setLoading(true); setError(null)
      if (isPreview || !window.desktopApi) { setReports(null); setLoading(false); return }
      const eligible = accounts.filter(({ enabled, platform }) => enabled && platform === 'tmall')
      if (eligible.length === 0) { setReports(null); setLoading(false); return }
      const date = shanghaiYesterday()
      const common = { dateStart: date, dateEnd: date, platforms: ['tmall'], shopIds: eligible.map(({ shopId }) => shopId), ownerIds: [] }
      try {
        const [business, promotion] = await Promise.all([
          window.desktopApi.reports.query({ ...common, reportType: 'tmall_daily_dashboard' }),
          window.desktopApi.reports.query({ ...common, reportType: 'tmall_promotion_report' })
        ])
        if (!cancelled) setReports({ business, promotion })
      } catch (reason) { if (!cancelled) setError(errorMessage(reason)) } finally { if (!cancelled) setLoading(false) }
    }
    void load()
    return () => { cancelled = true }
  }, [accounts, isPreview, revision])
  return { reports, loading, error, reload: () => setRevision((value) => value + 1) }
}

function AiDataState({ loading, error, empty, emptyText, onReload, children }: { loading: boolean; error: string | null; empty: boolean; emptyText: string; onReload: () => void; children: React.ReactNode }): React.JSX.Element {
  if (loading) return <div className="ai-empty-state"><Spin /><span>正在读取已采集数据…</span></div>
  if (error) return <Alert type="error" showIcon title="数据读取失败" description={error} action={<Button size="small" onClick={onReload}>重试</Button>} />
  if (empty) return <div className="ai-empty-state"><Empty description={emptyText} /><Button onClick={onReload}>重新读取</Button></div>
  return <>{children}</>
}

function AiKpi({ label, value, note, tone }: { label: string; value: string; note: string; tone?: 'accent' | 'success' | 'danger' | undefined }): React.JSX.Element {
  return <article className={`ai-kpi ${tone ?? ''}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></article>
}

function EvidenceList({ rows }: { rows: string[] }): React.JSX.Element {
  return <div className="ai-evidence"><strong>数据来源</strong>{rows.map((row) => <code key={row}>{row}</code>)}</div>
}

function StructuredOutput({ value }: { value: Record<string, unknown> }): React.JSX.Element {
  return <div className="ai-structured-output">{Object.entries(value).map(([key, item]) => <div key={key}><strong>{labelForKey(key)}</strong><div>{renderStructuredValue(item)}</div></div>)}</div>
}

function renderStructuredValue(value: unknown): React.ReactNode {
  if (Array.isArray(value)) return value.length === 0 ? '—' : <ul>{value.map((item, index) => <li key={index}>{typeof item === 'object' && item !== null ? JSON.stringify(item, null, 2) : String(item)}</li>)}</ul>
  if (typeof value === 'object' && value !== null) return <pre>{JSON.stringify(value, null, 2)}</pre>
  if (value === null || value === undefined || value === '') return '—'
  return String(value)
}

function labelForKey(key: string): string {
  const labels: Record<string, string> = { answer: '结论', summary: '摘要', recommendation: '推荐', reason_codes: '理由', main_risks: '主要风险', test_plan: '测款方案', unknowns: '未知项', confidence: '置信度', recommended_action: '建议动作', expected_effect: '预期效果', risk_level: '风险等级', evidence_refs: '证据', key_findings: '关键发现', evidence: '证据', limitations: '局限', follow_up_suggestions: '后续建议', query_summary: '查询口径' }
  return labels[key] ?? key
}

function canUseModel(settings: AiModelSettings | null, model: string | null): boolean { return Boolean(window.desktopApi && settings?.apiKeyConfigured && model && settings.models.includes(model)) }
function formatPercent(value: number | null): string { return value === null ? '—' : `${(value * 100).toFixed(1)}%` }
function gradeColor(value: string): string { return value === 'S' ? 'magenta' : value === 'A' ? 'green' : value === 'B' ? 'blue' : value === 'C' ? 'orange' : 'default' }
function shanghaiYesterday(): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() - 86_400_000)) }
function errorMessage(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason) }
