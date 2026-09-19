import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Input, InputNumber, Modal, Progress, Select, Space, Table, Tag } from 'antd'
import { shanghaiBusinessDate, shiftBusinessDate, type AccountSummary, type HistoryBackfillItem, type HistoryBackfillJob, type HistoryBackfillPreview, type HistoryBackfillRequest } from '@ecommerce/shared'
import './history-backfill.css'

const statusLabels: Record<HistoryBackfillJob['status'], string> = {
  queued: '等待执行', running: '正在补采', pausing: '正在暂停', paused: '已暂停', needs_attention: '需要处理', completed: '已完成', completed_with_gaps: '已处理，仍有数据缺口', cancelled: '已取消'
}
const itemLabels: Record<HistoryBackfillItem['status'], string> = { queued: '待执行', running: '执行中', succeeded: '已处理', skipped: '已有数据', need_login: '待登录', failed: '失败', cancelled: '已取消' }
const inspectionLabels = { ready: '已有有效数据', rebuildable: '可本地重建', missing: '缺失', retryable_partial: '可重试缺口', invalid: '需重新采集' }

interface Props { accounts: AccountSummary[]; isPreview: boolean; compact?: boolean; initialShopIds?: string[]; initialDate?: string; initialDateStart?: string; buttonLabel?: string; primary?: boolean; disabled?: boolean }

export function HistoryBackfillPanel({ accounts, isPreview, compact = false, initialShopIds, initialDate, initialDateStart, buttonLabel = '补齐历史数据', primary = false, disabled = false }: Props): React.JSX.Element {
  const [jobs, setJobs] = useState<HistoryBackfillJob[]>([])
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<string | null>(null)
  const [request, setRequest] = useState<HistoryBackfillRequest>(() => defaultRequest())
  const [preview, setPreview] = useState<HistoryBackfillPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const today = shanghaiBusinessDate()
  const minimum = shiftBusinessDate(today, -30), maximum = shiftBusinessDate(today, -1)
  const shops = [...new Map(accounts.filter(account => account.enabled && account.platform === 'tmall').map(account => [account.shopId, account])).values()]

  useEffect(() => {
    const api = window.desktopApi?.history
    if (isPreview || !api) return
    let alive = true
    const unsubscribe = api.onChanged(job => { if (alive) setJobs(previous => mergeJobs(previous, [job])) })
    api.list().then(next => { if (alive) setJobs(previous => mergeJobs(next, previous)) }).catch(reason => { if (alive) setError(errorText(reason)) })
    return () => { alive = false; unsubscribe() }
  }, [isPreview])
  useEffect(() => () => { generation.current += 1 }, [])

  function show(): void {
    generation.current += 1
    const selected = initialShopIds?.filter(id => shops.some(shop => shop.shopId === id)) ?? shops.map(shop => shop.shopId)
    const end = initialDateStart && initialDate ? initialDate : initialDate && initialDate >= minimum && initialDate <= maximum ? initialDate : maximum
    const start = initialDateStart ?? (shiftBusinessDate(end, -6) < minimum ? minimum : shiftBusinessDate(end, -6))
    setRequest({ ...defaultRequest(), shopIds: selected, dateEnd: end, dateStart: start })
    setPreview(null); setBusy(false)
    setError(start < minimum || end > maximum ? `所选范围包含不可补采日期；历史补采仅支持 ${minimum} 至 ${maximum}，请在此调整范围。` : null)
    setOpen(true)
  }
  function change(patch: Partial<HistoryBackfillRequest>): void {
    generation.current += 1; setRequest(previous => ({ ...previous, ...patch })); setPreview(null); setError(null)
  }
  async function inspect(): Promise<void> {
    const id = ++generation.current
    setBusy(true); setError(null)
    try {
      if (!window.desktopApi?.history || isPreview) throw new Error('请在 Electron 桌面程序中使用历史补采')
      const result = await window.desktopApi.history.preview(request)
      if (id === generation.current) setPreview(result)
    } catch (reason) { if (id === generation.current) setError(errorText(reason)) }
    finally { if (id === generation.current) setBusy(false) }
  }
  async function create(): Promise<void> {
    if (!preview || !window.desktopApi) return
    setBusy(true); setError(null)
    try {
      const job = await window.desktopApi.history.create(preview.request)
      setJobs(previous => mergeJobs(previous, [job])); setOpen(false); setDetail(job.jobId)
    } catch (reason) { setError(errorText(reason)) }
    finally { setBusy(false) }
  }
  async function action(job: HistoryBackfillJob, operation: 'pause' | 'resume' | 'cancel' | 'retryFailed'): Promise<void> {
    if (!window.desktopApi) return
    setBusy(true); setError(null)
    try { await window.desktopApi.history[operation](job.jobId) }
    catch (reason) { setError(errorText(reason)) }
    finally { setBusy(false) }
  }
  function actions(job: HistoryBackfillJob): React.JSX.Element {
    const active = ['running', 'queued', 'pausing'].includes(job.status)
    return <Space wrap size={4}>
      <Button size="small" disabled={busy || job.status === 'pausing' || !active} onClick={() => void action(job, 'pause')}>暂停</Button>
      <Button size="small" disabled={busy || active || job.status === 'completed' || job.status === 'completed_with_gaps'} onClick={() => void action(job, 'resume')}>继续</Button>
      <Button size="small" disabled={busy || active || !job.items.some(item => item.status === 'failed' || item.status === 'need_login' || item.coverage.some(field => field.retryable))} onClick={() => void action(job, 'retryFailed')}>重试失败项</Button>
      <Button size="small" danger disabled={busy || (!active && job.status !== 'paused' && job.status !== 'needs_attention')} onClick={() => void action(job, 'cancel')}>取消</Button>
    </Space>
  }
  const selectedJob = jobs.find(job => job.jobId === detail)
  const jobTable = <Table<HistoryBackfillJob> size="small" rowKey="jobId" dataSource={jobs} pagination={{ pageSize: 5 }} locale={{ emptyText: '暂无历史补采任务' }} columns={[
    { title: '范围', render: (_, job) => <span>{job.request.dateStart} 至 {job.request.dateEnd}<br/><small>{job.request.shopIds.length} 家店铺 · {job.total} 个店铺日</small></span> },
    { title: '状态与进度', render: (_, job) => <div><Tag color={job.status === 'needs_attention' ? 'warning' : 'blue'}>{statusLabels[job.status]}</Tag><Progress size="small" percent={progress(job)} format={() => `${processed(job)}/${job.total}`} /></div> },
    { title: '操作', render: (_, job) => <Space wrap><Button size="small" onClick={() => setDetail(job.jobId)}>明细</Button>{actions(job)}</Space> }
  ]} />
  return <>
    {compact ? <Button type={primary ? 'primary' : 'default'} disabled={disabled} onClick={show}>{buttonLabel}</Button> : <section className="history-panel">
      <div className="history-heading"><div><h3>历史数据补齐</h3><p>选择最近 30 个完整自然日。已完成日期自动跳过，中断后可继续。</p></div><Button type="primary" onClick={show}>补齐历史数据</Button></div>
      {error && !open && !detail ? <Alert type="error" showIcon title={error} /> : null}
      {jobTable}
    </section>}
    <Modal open={open} title="补齐店铺历史数据" width={960} onCancel={() => { if (!busy) { generation.current += 1; setOpen(false) } }} footer={<Space><Button disabled={busy} onClick={() => setOpen(false)}>关闭</Button><Button loading={busy && !preview} disabled={busy} onClick={() => void inspect()}>检查数据缺口</Button><Button type="primary" loading={busy && !!preview} disabled={!preview || busy} onClick={() => void create()}>开始补采</Button></Space>}>
      <div className="history-form">
        <label className="history-shop-select">店铺<Select aria-label="历史补采店铺" mode="multiple" value={request.shopIds} disabled={busy} options={shops.map(shop => ({ value: shop.shopId, label: shop.shopName }))} onChange={shopIds => change({ shopIds })} placeholder="选择天猫店铺" /></label>
        <label>开始日期<Input aria-label="补采开始日期" type="date" value={request.dateStart} min={minimum} max={maximum} disabled={busy} onChange={event => change({ dateStart: event.target.value })} /></label>
        <label>结束日期<Input aria-label="补采结束日期" type="date" value={request.dateEnd} min={minimum} max={maximum} disabled={busy} onChange={event => change({ dateEnd: event.target.value })} /></label>
        <label>补采方式<Select value={request.mode} disabled={busy} onChange={mode => change({ mode })} options={[{ value: 'missing_only', label: '仅补缺失与可恢复缺口' }, { value: 'refresh_selected', label: '重新采集所选范围' }]} /></label>
        <label>并行店铺数<InputNumber min={1} max={3} precision={0} value={request.concurrency} disabled={busy} onChange={value => change({ concurrency: value ?? 2 })} /></label>
      </div>
      <Space className="history-shortcuts">{[7, 15, 30].map(days => <Button key={days} size="small" disabled={busy} onClick={() => change({ dateStart: shiftBusinessDate(today, -days), dateEnd: maximum })}>近 {days} 天</Button>)}<Button size="small" disabled={busy} onClick={() => change({ shopIds: shops.map(shop => shop.shopId) })}>全部店铺</Button></Space>
      <Alert type="info" showIcon title="数据范围说明" description="按上海时间补采，今天不计入。历史全店退款可能缺少来源，商品/流量/搜索词为 Top 数据；30 天环比还需要此前 30 天数据。程序退出后任务暂停，重启可继续。" />
      {error ? <Alert type="error" showIcon title={error} /> : null}
      {preview ? <><p className="history-preview-summary">共 {preview.total} 个店铺日：已有可跳过 {preview.skip}，本地重建 {preview.rebuild}，需采集 {preview.collect}。</p><DayTable items={preview.items} preview /></> : <p>点击“检查数据缺口”后查看本次范围和预计任务量。</p>}
      {compact && jobs.length ? <details><summary>已有补采任务（{jobs.length}）</summary>{jobTable}</details> : null}
    </Modal>
    <Modal open={!!selectedJob} title="历史补采进度与覆盖明细" width={1120} onCancel={() => setDetail(null)} footer={<Button onClick={() => setDetail(null)}>关闭</Button>}>
      {selectedJob ? <>
        <div className="history-heading"><Tag color="blue">{statusLabels[selectedJob.status]}</Tag>{actions(selectedJob)}</div>
        <Progress percent={progress(selectedJob)} format={() => `${processed(selectedJob)}/${selectedJob.total} 店铺日`} />
        <p>采集 {selectedJob.items.filter(item => item.status === 'succeeded' && item.action === 'collect').length} · 重建 {selectedJob.items.filter(item => item.status === 'succeeded' && item.action === 'rebuild').length} · 跳过 {selectedJob.items.filter(item => item.status === 'skipped').length} · 失败 {selectedJob.items.filter(item => item.status === 'failed').length} · 待登录 {selectedJob.items.filter(item => item.status === 'need_login').length}</p>
        <p>支付金额覆盖 {selectedJob.items.filter(item => item.coverage.some(field => field.key === 'pay_amt' && field.status === 'available')).length}/{selectedJob.total} · 全店退款覆盖 {selectedJob.items.filter(item => item.coverage.some(field => field.key === 'refund_amt' && field.status === 'available')).length}/{selectedJob.total}</p>
        {selectedJob.lastError || error ? <Alert type="error" showIcon title={error ?? selectedJob.lastError} /> : null}
        <Alert type="info" showIcon title="待登录店铺：请在账号环境打开店铺并完成登录，再点击继续。任务处理完成不代表所有字段完整。" />
        <DayTable items={selectedJob.items} />
      </> : null}
    </Modal>
  </>
}

function DayTable({ items, preview = false }: { items: HistoryBackfillItem[]; preview?: boolean }): React.JSX.Element {
  return <Table<HistoryBackfillItem> size="small" rowKey="key" dataSource={items} pagination={{ pageSize: 10, showSizeChanger: true }} scroll={{ x: 760 }} columns={[
    { title: '店铺', dataIndex: 'shopName', width: 150 }, { title: '日期', dataIndex: 'bizDate', width: 115 },
    { title: '状态', width: 140, render: (_, item) => preview ? inspectionLabels[item.state] : itemLabels[item.status] },
    { title: '说明', render: (_, item) => <span>{preview ? item.reason : item.message}{item.nextRetryAt ? <small> · 下次尝试 {new Date(item.nextRetryAt).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai' })}</small> : null}</span> }
  ]} expandable={{ expandedRowRender: item => <div className="history-coverage">{item.coverage.length ? item.coverage.map(field => <div key={field.key}><Tag color={field.status === 'available' ? 'success' : 'warning'}>{field.label}</Tag><span>{field.reason}{field.retryable ? '（可重试）' : ''}</span></div>) : '尚无可验证数据'}</div> }} />
}
function defaultRequest(): HistoryBackfillRequest { const today = shanghaiBusinessDate(); return { platforms: ['tmall'], shopIds: [], dateStart: shiftBusinessDate(today, -7), dateEnd: shiftBusinessDate(today, -1), mode: 'missing_only', concurrency: 2 } }
function processed(job: HistoryBackfillJob): number { return job.items.filter(item => item.status !== 'queued' && item.status !== 'running').length }
function progress(job: HistoryBackfillJob): number { return job.total ? Math.round(processed(job) / job.total * 100) : 0 }
function errorText(value: unknown): string { return value instanceof Error ? value.message : String(value) }
function mergeJobs(previous: HistoryBackfillJob[], incoming: HistoryBackfillJob[]): HistoryBackfillJob[] {
  const jobs = new Map(previous.map(job => [job.jobId, job]))
  for (const job of incoming) if (!jobs.has(job.jobId) || jobs.get(job.jobId)!.updatedAt <= job.updatedAt) jobs.set(job.jobId, job)
  return [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function useHistoryRevision(): number {
  const [revision, setRevision] = useState(0)
  useEffect(() => window.desktopApi?.history?.onChanged(job => {
    if (!['queued', 'running', 'pausing'].includes(job.status)) setRevision(value => value + 1)
  }), [])
  return revision
}
