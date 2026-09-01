import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Input, Segmented, Select } from 'antd'
import type { AccountSummary, ReportDataset } from '@ecommerce/shared'
import type { NotificationInput } from './notifications.js'
import { buildProductReportModel, type ProductDiagnosis, type ProductReportItem } from './product-report-model.js'
import './product-report.css'

type ProductView = 'overview' | 'diagnosis' | 'matrix'

const demoRows: Array<Record<string, string | number | null>> = [
  { shop_id: 'DEMO_SHOP_A', shop_name: '示例店铺甲', item_id: 'DEMO_ITEM_01', item_title: '示例商品一 · 家居用品', pay_amt: 4000, refund_amt: 400, pay_item_count: 70, pay_buyer_count: 70, pay_rate: 0.05, visitor_count: 1400, page_view_count: 2800, cart_buyer_count: 100 },
  { shop_id: 'DEMO_SHOP_A', shop_name: '示例店铺甲', item_id: 'DEMO_ITEM_02', item_title: '示例商品二 · 日用套装', pay_amt: 1200, refund_amt: 10, pay_item_count: 36, pay_buyer_count: 35, pay_rate: 0.025, visitor_count: 1400, page_view_count: 3000, cart_buyer_count: 90 },
  { shop_id: 'DEMO_SHOP_A', shop_name: '示例店铺甲', item_id: 'DEMO_ITEM_03', item_title: '示例商品三 · 便携用品', pay_amt: 600, refund_amt: 50, pay_item_count: 2, pay_buyer_count: 2, pay_rate: 0.25, visitor_count: 8, page_view_count: 15, cart_buyer_count: 3 },
  { shop_id: 'DEMO_SHOP_A', shop_name: '示例店铺甲', item_id: 'DEMO_ITEM_04', item_title: '示例商品四 · 收纳用品', pay_amt: 300, refund_amt: 0, pay_item_count: 5, pay_buyer_count: 4, pay_rate: 0.01, visitor_count: 400, page_view_count: 600, cart_buyer_count: 20 },
  { shop_id: 'DEMO_SHOP_B', shop_name: '示例店铺乙', item_id: 'DEMO_ITEM_05', item_title: '示例商品五 · 组合装', pay_amt: 200, refund_amt: 10, pay_item_count: 10, pay_buyer_count: 10, pay_rate: 0.1, visitor_count: 100, page_view_count: 120, cart_buyer_count: 15 },
  { shop_id: 'DEMO_SHOP_C', shop_name: '示例店铺丙', item_id: 'DEMO_ITEM_06', item_title: '示例商品六 · 舒适用品', pay_amt: 50, refund_amt: null, pay_item_count: 1, pay_buyer_count: 1, pay_rate: 1, visitor_count: 1, page_view_count: 2, cart_buyer_count: 1 }
]

const diagnosisMeta: Record<ProductDiagnosis, { label: string; tone: string; advice: string }> = {
  'refund-risk': { label: '退款风险', tone: 'danger', advice: '优先核对退款原因、负面评价及商品描述是否与用户预期一致。' },
  'high-traffic-low-conversion': { label: '高流量低转化', tone: 'warning', advice: '检查价格力、主图首屏卖点、评价结构和优惠承接。' },
  potential: { label: '增长机会', tone: 'success', advice: '当前转化表现较好，可通过小预算扩流验证承接上限。' },
  'small-sample': { label: '样本较少', tone: 'muted', advice: '访客样本不足，继续积累数据后再做经营判断。' },
  stable: { label: '表现稳定', tone: 'info', advice: '维持当前经营策略，并持续观察流量、转化和退款变化。' }
}

export function ProductReport({ accounts, isPreview, onNotify }: { accounts: AccountSummary[]; isPreview: boolean; onNotify: (notification: NotificationInput) => void }): React.JSX.Element {
  const [dataset, setDataset] = useState<ReportDataset | null>(null)
  const [selectedDate, setSelectedDate] = useState(shanghaiYesterday)
  const [shopFilter, setShopFilter] = useState('all')
  const [view, setView] = useState<ProductView>('overview')
  const [search, setSearch] = useState('')
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(!isPreview)
  const [updating, setUpdating] = useState(false)
  const [reloadVersion, setReloadVersion] = useState(0)
  const [result, setResult] = useState<{ type: 'success' | 'info' | 'warning' | 'error'; title: string; description: string } | null>(null)
  const today = shanghaiToday()
  const effectiveAccounts = useMemo(() => [...new Map(accounts.filter(({ enabled }) => enabled).map((account) => [`${account.platform}/${account.shopId}`, account])).values()], [accounts])
  const filteredAccounts = shopFilter === 'all' ? effectiveAccounts : effectiveAccounts.filter(({ accountId }) => `shop:${accountId}` === shopFilter)
  const selectedPlatforms = [...new Set(filteredAccounts.map(({ platform }) => platform))]
  const selectedShopIds = [...new Set(filteredAccounts.map(({ shopId }) => shopId))]
  const accountSignature = filteredAccounts.map(({ accountId, platform, shopId }) => `${accountId}:${platform}:${shopId}`).sort().join('|')
  const filterOptions = [
    { value: 'all', label: `所有店铺（${effectiveAccounts.length} 家）` },
    ...effectiveAccounts.map((account) => ({ value: `shop:${account.accountId}`, label: `${platformLabel(account.platform)} · ${account.shopName}` }))
  ]

  useEffect(() => {
    if (shopFilter !== 'all' && filteredAccounts.length === 0) setShopFilter('all')
  }, [accountSignature, shopFilter])
  useEffect(() => setResult(null), [selectedDate, shopFilter])
  useEffect(() => {
    if (isPreview || !window.desktopApi || filteredAccounts.length === 0) {
      setDataset(null)
      setLoading(false)
      return
    }
    setLoading(true)
    window.desktopApi.reports.query({ reportType: 'tmall_daily_dashboard', dateStart: selectedDate, dateEnd: selectedDate, platforms: selectedPlatforms, shopIds: selectedShopIds, ownerIds: [] })
      .then((value) => { setDataset(value); setResult(null) })
      .catch((reason: unknown) => {
        const description = errorMessage(reason)
        setResult({ type: 'error', title: `商品数据读取失败 · ${selectedDate}`, description })
        onNotify({ id: `product-report:query:${selectedDate}:${shopFilter}`, tone: 'error', title: '商品报表读取失败', description })
      })
      .finally(() => setLoading(false))
  }, [accountSignature, isPreview, reloadVersion, selectedDate])

  const rows = isPreview ? demoRows : dataset?.shop_rows ?? []
  const fallbackAccount = filteredAccounts.length === 1 ? filteredAccounts[0] : null
  const model = useMemo(() => buildProductReportModel(rows, {
    shopId: dataset?.filters.shopIds[0] ?? fallbackAccount?.shopId ?? '',
    shopName: dataset?.meta.shop_name || fallbackAccount?.shopName || ''
  }), [dataset, fallbackAccount, rows])
  const visibleItems = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase('zh-CN')
    if (!keyword) return model.items
    return model.items.filter((item) => `${item.title} ${item.itemId} ${item.shopName}`.toLocaleLowerCase('zh-CN').includes(keyword))
  }, [model.items, search])
  const selectedItem = visibleItems.find(({ key }) => key === selectedItemKey) ?? visibleItems[0] ?? null

  async function updateSelectedStores(): Promise<void> {
    if (isPreview || !window.desktopApi || filteredAccounts.length === 0) return
    setUpdating(true)
    setResult(null)
    try {
      const update = await window.desktopApi.reports.update({ bizDate: selectedDate, platforms: selectedPlatforms, shopIds: selectedShopIds })
      const problemShops = update.shops.filter(({ status }) => status === 'FAILED' || status === 'NEED_HUMAN_LOGIN')
      const description = [`有效店铺 ${update.total} 家：更新 ${update.updated}、跳过 ${update.skipped}、待登录 ${update.needLogin}、失败 ${update.failed}。`, ...problemShops.map(({ shopName, warning }) => `${shopName}：${warning || '数据未更新'}`)].join(' ')
      const hasProblem = problemShops.length > 0
      const title = hasProblem ? `商品数据更新未完成 · ${selectedDate}` : update.skipped === update.total ? `商品数据已经是最新状态 · ${selectedDate}` : `商品数据更新完成 · ${selectedDate}`
      setResult({ type: hasProblem ? 'warning' : update.skipped === update.total ? 'info' : 'success', title, description })
      onNotify({ id: `product-report:update:${selectedDate}:${shopFilter}`, tone: hasProblem ? 'warning' : 'success', title, description })
      setReloadVersion((value) => value + 1)
    } catch (reason) {
      const description = errorMessage(reason)
      const title = `商品数据更新失败 · ${selectedDate}`
      setResult({ type: 'error', title, description })
      onNotify({ id: `product-report:update-error:${selectedDate}:${shopFilter}`, tone: 'error', title, description })
    } finally {
      setUpdating(false)
    }
  }

  const completeShops = isPreview ? 3 : dataset?.quality.complete_shop_count ?? 0
  const missingShops = isPreview ? 1 : dataset?.quality.missing_shop_count ?? Math.max(0, filteredAccounts.length - completeShops)
  const coverageText = `数据覆盖：${completeShops}/${completeShops + missingShops || filteredAccounts.length} 家店铺、${model.items.length} 个商品。商品数据为生意参谋 Top 列表，不代表全量商品明细。`

  return <div className="product-report-page">
    <section className="product-report-toolbar">
      <div className="product-report-filter"><label htmlFor="product-report-shop">店铺筛选</label><Select id="product-report-shop" value={shopFilter} options={filterOptions} disabled={updating || effectiveAccounts.length === 0} onChange={setShopFilter} /></div>
      <div className="product-report-filter product-report-date"><label htmlFor="product-report-date">数据日期</label><input id="product-report-date" type="date" value={selectedDate} max={today} disabled={updating} onChange={(event) => event.target.value && setSelectedDate(event.target.value)} /><Button size="small" disabled={updating || selectedDate === today} onClick={() => setSelectedDate(today)}>今天</Button><Button size="small" disabled={updating || selectedDate === shanghaiYesterday()} onClick={() => setSelectedDate(shanghaiYesterday())}>昨天</Button></div>
      <div className="product-report-filter product-report-search"><label htmlFor="product-report-search">商品搜索</label><Input id="product-report-search" allowClear value={search} placeholder="商品名称 / ID / 店铺" onChange={(event) => setSearch(event.target.value)} /></div>
      <Button type="primary" loading={updating} disabled={isPreview || filteredAccounts.length === 0} onClick={() => void updateSelectedStores()}>更新商品数据</Button>
    </section>
    {result ? <Alert className="product-report-alert" type={result.type} showIcon closable message={result.title} description={result.description} onClose={() => setResult(null)} /> : null}
    <div className={`product-report-coverage ${missingShops > 0 ? 'partial' : ''}`}>{coverageText}</div>
    <Segmented<ProductView> className="product-report-switch" block value={view} options={[{ label: '经营总览', value: 'overview' }, { label: '单品诊断', value: 'diagnosis' }, { label: '经营矩阵', value: 'matrix' }]} onChange={setView} />
    {loading ? <ProductEmpty title={`正在读取 ${selectedDate} 商品数据…`} description="数据仅从本地 Report Dataset 加载。" /> : effectiveAccounts.length === 0 && !isPreview ? <ProductEmpty title="尚未配置可用店铺" description="请先在“系统 → 账号环境”添加并启用账号。" /> : rows.length === 0 ? <ProductEmpty title={`${selectedDate} 尚无商品数据`} description="请点击“更新商品数据”采集所选店铺数据。" /> : view === 'overview' ? <OverviewView model={model} items={visibleItems} /> : view === 'diagnosis' ? <DiagnosisView items={visibleItems} selected={selectedItem} onSelect={setSelectedItemKey} /> : <MatrixView items={visibleItems} />}
  </div>
}

function OverviewView({ model, items }: { model: ReturnType<typeof buildProductReportModel>; items: ProductReportItem[] }): React.JSX.Element {
  const topItem = model.items[0]
  const refundRate = model.totals.refundAmt !== null && model.totals.payAmt > 0 ? model.totals.refundAmt / model.totals.payAmt : null
  return <>
    <section className="product-kpi-grid">
      <ProductKpi label="商品支付金额" value={money(model.totals.payAmt)} note={`${model.items.length} 个有数据商品`} accent />
      <ProductKpi label="支付件数" value={integer(model.totals.payItemCount)} note="支付商品件数合计" />
      <ProductKpi label="商品访客合计" value={integer(model.totals.visitorCount)} note="商品维度相加，非店铺去重访客" />
      <ProductKpi label="支付买家合计" value={integer(model.totals.payBuyerCount)} note="商品维度买家相加" />
      <ProductKpi label={model.totals.refundKnownCount < model.items.length ? '已知商品退款金额' : '成功退款金额'} value={moneyNullable(model.totals.refundAmt)} note={refundRate === null ? '退款字段缺失' : `占商品支付 ${rate(refundRate)}`} danger={(model.totals.refundAmt ?? 0) > 0} />
      <ProductKpi label="头部商品集中度" value={rate(model.totals.topOneShare)} note="TOP1 支付金额占比" />
    </section>
    <section className="product-overview-grid">
      <article className="product-panel"><PanelHead title="店铺商品销售贡献" note="按商品支付金额" /><div className="product-shop-bars">{model.shops.map((shop) => <div className="product-shop-bar" key={shop.shopId}><span title={shop.shopName}>{shop.shopName}</span><div><i style={{ width: `${Math.max(shop.share * 100, shop.payAmt > 0 ? 1 : 0)}%` }} /></div><b>{money(shop.payAmt)}</b></div>)}</div></article>
      <article className="product-panel"><PanelHead title="经营提示" note="根据当前可见商品数据生成" /><div className="product-findings"><Finding tone="success" title="头部商品贡献" text={topItem ? `${topItem.title} 贡献 ${money(topItem.payAmt)}，占当前商品支付 ${rate(model.totals.topOneShare)}。` : '暂无商品数据。'} /><Finding tone="danger" title="退款风险" text={`${model.diagnosisCounts['refund-risk']} 个商品达到退款风险阈值，建议优先核对退款原因。`} /><Finding tone="warning" title="转化优化" text={`${model.diagnosisCounts['high-traffic-low-conversion']} 个商品属于高流量低转化。`} /><Finding tone="success" title="增长机会" text={`${model.diagnosisCounts.potential} 个商品转化较好且流量仍有放大空间。`} /></div></article>
    </section>
    <article className="product-panel"><PanelHead title="商品明细" note={`按支付金额降序 · 当前显示 ${items.length} 项`} /><ProductTable items={items} /></article>
  </>
}

function DiagnosisView({ items, selected, onSelect }: { items: ProductReportItem[]; selected: ProductReportItem | null; onSelect: (key: string) => void }): React.JSX.Element {
  if (!selected) return <ProductEmpty title="没有匹配的商品" description="请调整搜索条件。" />
  const meta = diagnosisMeta[selected.diagnosis]
  return <section className="product-diagnosis-layout">
    <article className="product-panel product-diagnosis-list"><PanelHead title="待诊断商品" note={`当前 ${items.length} 项`} /><div>{items.slice(0, 30).map((item) => <button type="button" key={item.key} className={item.key === selected.key ? 'active' : ''} onClick={() => onSelect(item.key)}><strong>{item.title}</strong><span>{money(item.payAmt)} · {diagnosisMeta[item.diagnosis].label}</span></button>)}</div></article>
    <article className="product-panel product-detail"><div className="product-detail-title"><DiagnosisBadge diagnosis={selected.diagnosis} /><h2>{selected.title}</h2><p>{selected.shopName} · 商品 ID {selected.itemId}</p></div><div className="product-funnel"><FunnelStep label="浏览量" value={selected.pageViewCount} /><FunnelStep label="访客数" value={selected.visitorCount} /><FunnelStep label="加购买家" value={selected.cartBuyerCount} /><FunnelStep label="支付买家" value={selected.payBuyerCount} /></div><div className="product-detail-metrics"><ProductKpi label="支付金额" value={money(selected.payAmt)} note={`当前排名第 ${items.findIndex(({ key }) => key === selected.key) + 1}`} accent /><ProductKpi label="支付件数" value={integer(selected.payItemCount)} note="商品支付件数" /><ProductKpi label="支付转化率" value={rateNullable(selected.payRate)} note={`${integer(selected.payBuyerCount)} 买家 / ${integer(selected.visitorCount)} 访客`} /><ProductKpi label="成功退款" value={moneyNullable(selected.refundAmt)} note={selected.refundAmt === null ? '源数据未返回' : selected.payAmt > 0 ? `占支付 ${rate(selected.refundAmt / selected.payAmt)}` : '无支付金额'} danger={(selected.refundAmt ?? 0) > 0} /></div><Finding tone={meta.tone} title={meta.label} text={meta.advice} /></article>
  </section>
}

function MatrixView({ items }: { items: ProductReportItem[] }): React.JSX.Element {
  const matrixItems = items.filter(({ payAmt }) => payAmt > 0).slice(0, 20)
  const maxPay = Math.max(...matrixItems.map(({ payAmt }) => payAmt), 1)
  const maxVisitors = Math.max(...matrixItems.map(({ visitorCount }) => visitorCount), 1)
  const actionItems = [...items].sort((left, right) => diagnosisPriority(left.diagnosis) - diagnosisPriority(right.diagnosis) || right.payAmt - left.payAmt).slice(0, 8)
  return <section className="product-matrix-layout"><article className="product-panel product-matrix-panel"><PanelHead title="商品经营矩阵" note="横轴转化率 · 纵轴支付金额 · 气泡大小为访客" /><div className="product-matrix"><span className="matrix-y">支付金额</span><span className="matrix-x">支付转化率</span><div className="matrix-plot"><span className="matrix-quadrant q1">明星商品</span><span className="matrix-quadrant q2">高销售待提效</span><span className="matrix-quadrant q3">观察区</span><span className="matrix-quadrant q4">潜力商品</span>{matrixItems.map((item) => { const x = Math.min(94, 7 + normalizedRate(item.payRate) * 87); const y = Math.min(92, 8 + Math.sqrt(item.payAmt / maxPay) * 84); const size = 24 + Math.sqrt(item.visitorCount / maxVisitors) * 34; return <button type="button" className={`matrix-bubble tone-${diagnosisMeta[item.diagnosis].tone}`} key={item.key} title={`${item.title}\n${money(item.payAmt)} · ${rateNullable(item.payRate)}`} style={{ left: `${x}%`, bottom: `${y}%`, width: size, height: size }}>{shortTitle(item.title)}</button> })}</div></div></article><article className="product-panel"><PanelHead title="运营动作清单" note="按风险和机会排序" /><div className="product-actions">{actionItems.map((item) => <div className="product-action" key={item.key}><div><strong>{item.title}</strong><DiagnosisBadge diagnosis={item.diagnosis} /></div><p>{diagnosisMeta[item.diagnosis].advice}</p><small>{item.shopName} · {money(item.payAmt)} · {rateNullable(item.payRate)}</small></div>)}</div></article></section>
}

function ProductTable({ items }: { items: ProductReportItem[] }): React.JSX.Element {
  if (items.length === 0) return <div className="product-table-empty">没有匹配的商品</div>
  return <div className="product-table-wrap"><table className="product-table"><thead><tr><th>排名</th><th>店铺</th><th>商品</th><th>支付金额</th><th>支付件数</th><th>访客</th><th>转化率</th><th>退款金额</th><th>诊断</th></tr></thead><tbody>{items.map((item, index) => <tr key={item.key}><td><span className="product-rank">{index + 1}</span></td><td title={item.shopName}>{item.shopName}</td><td title={item.title}>{item.title}</td><td className="number strong">{money(item.payAmt)}</td><td className="number">{integer(item.payItemCount)}</td><td className="number">{integer(item.visitorCount)}</td><td className="number">{rateNullable(item.payRate)}</td><td className="number">{moneyNullable(item.refundAmt)}</td><td><DiagnosisBadge diagnosis={item.diagnosis} /></td></tr>)}</tbody></table></div>
}

function ProductKpi({ label, value, note, accent = false, danger = false }: { label: string; value: string; note: string; accent?: boolean; danger?: boolean }): React.JSX.Element { return <article className={`product-kpi ${accent ? 'accent' : ''} ${danger ? 'danger' : ''}`}><span>{label}</span><strong>{value}</strong><small>{note}</small></article> }
function PanelHead({ title, note }: { title: string; note: string }): React.JSX.Element { return <div className="product-panel-head"><h2>{title}</h2><span>{note}</span></div> }
function Finding({ tone, title, text }: { tone: string; title: string; text: string }): React.JSX.Element { return <div className={`product-finding tone-${tone}`}><strong>{title}</strong><p>{text}</p></div> }
function FunnelStep({ label, value }: { label: string; value: number }): React.JSX.Element { return <div><strong>{integer(value)}</strong><span>{label}</span></div> }
function DiagnosisBadge({ diagnosis }: { diagnosis: ProductDiagnosis }): React.JSX.Element { const meta = diagnosisMeta[diagnosis]; return <span className={`product-diagnosis-badge tone-${meta.tone}`}>{meta.label}</span> }
function ProductEmpty({ title, description }: { title: string; description: string }): React.JSX.Element { return <div className="product-report-empty"><h2>{title}</h2><p>{description}</p></div> }

function normalizedRate(value: number | null): number { if (value === null) return 0; const decimal = Math.abs(value) > 1 ? value / 100 : value; return Math.min(1, decimal / 0.25) }
function diagnosisPriority(value: ProductDiagnosis): number { return value === 'refund-risk' ? 0 : value === 'high-traffic-low-conversion' ? 1 : value === 'potential' ? 2 : value === 'stable' ? 3 : 4 }
function shortTitle(title: string): string { return title.replace(/[\s·，,。]/g, '').slice(0, 4) || '商品' }
function money(value: number): string { return `¥${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` }
function moneyNullable(value: number | null): string { return value === null ? '—' : money(value) }
function integer(value: number): string { return Math.round(value).toLocaleString('zh-CN') }
function rate(value: number): string { return `${(Math.abs(value) <= 1 ? value * 100 : value).toFixed(2)}%` }
function rateNullable(value: number | null): string { return value === null ? '—' : rate(value) }
function platformLabel(platform: string): string { return platform === 'tmall' ? '天猫' : platform === 'pinduoduo' ? '拼多多' : platform === 'jd' ? '京东' : platform }
function errorMessage(reason: unknown): string { return reason instanceof Error ? reason.message : String(reason) }
function shanghaiYesterday(): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() - 86_400_000)) }
function shanghaiToday(): string { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) }
