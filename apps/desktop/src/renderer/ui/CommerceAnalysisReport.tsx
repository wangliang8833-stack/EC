import type { ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ANALYSIS_TEMPLATES, analysisFormat as f, type CommerceAnalysis } from './commerce-analysis-model.js'
import reportCss from './commerce-analysis-report.css?raw'
import './commerce-analysis-report.css'

const number = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) ? v : null
const ratio = (a: unknown, b: unknown): number | null => { const x = number(a), y = number(b); return x !== null && y !== null && y > 0 ? x / y : null }
function DataTable({ headings, rows }: { headings: string[]; rows: ReactNode[][] }): React.JSX.Element {
  return <div className="commerce-table"><table><thead><tr>{headings.map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.length ? rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j}>{v}</td>)}</tr>) : <tr><td colSpan={headings.length}>所选日期没有该维度的有效数据。</td></tr>}</tbody></table></div>
}
function Chapter({ number, title, children }: { number: string; title: string; children: ReactNode }): React.JSX.Element {
  return <section className="commerce-chapter"><h2><small>{number}</small>{title}</h2>{children}</section>
}

export function CommerceAnalysisReport({ report: r }: { report: CommerceAnalysis }): React.JSX.Element {
  const merchandise = r.scope.template !== 'advertising', advertising = r.scope.template !== 'merchandise'
  const period = `${r.dates[0]} — ${r.scope.endDate}`, prior = `${r.previousDates[0]} — ${r.previousDates.at(-1)}`
  const title = ANALYSIS_TEMPLATES.find(t => t.id === r.scope.template)!.name
  const comparable = r.comparison
  const headline = r.available === 0 ? '暂无有效数据，先补齐采集。' : r.findings.some(f => f.id.startsWith('spend:')) ? '先核查消耗压力，再决定投入。' : r.findings.some(f => f.id.startsWith('traffic:')) ? '流量与成交分开看，先定位转化变化。' : '以可比数据复盘，让每项行动都有依据。'
  return <article className="commerce-report">
    <header><p className="commerce-eyebrow">经营分析 / {title} / 本地模板生成</p><h1>{headline}</h1><p>{period} · {r.scope.shops.length} 家所选天猫店铺 · 中国内地 · 人民币元 · Asia/Shanghai</p><p className="commerce-note">模板 {r.version} · 生成时间 {new Date(r.generatedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })} · 数据更新时间 {r.dataAsOf ? new Date(r.dataAsOf).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '未知'}</p></header>
    <div className="commerce-notice">本期有效日报 {r.available}/{r.expected} 个店铺日。金额合计仅含已知值；“—”代表未知或不可计算。数据不发送至模型，结论由版本化规则与模板生成；不自动执行投放、商品或订单操作。</div>
    <div className="commerce-metrics">{r.metrics.map(m => <div key={m.key}><span>{m.label}</span><strong>{f(m.value, m.format)}</strong><small>字段覆盖 {m.reported}/{m.expected} 店铺日</small><small>{m.definition}</small></div>)}</div>
    <Chapter number="01" title="经营判断与证据">
      <p>对比周期：{prior}。支付字段两期完整的可比店铺 <b>{comparable.shopCount}/{r.scope.shops.length}</b> 家；可比支付 {f(comparable.previous)} → {f(comparable.current)}，变化 <b>{f(comparable.delta)}</b>，变化率 <b>{f(comparable.ratio, 'percent')}</b>。</p>
      <p className="commerce-note">增长率基期为 0 时不计算。上方指标带使用本期所选范围，此处只用两期都完整的固定店铺集合，范围可能不同。1 天比较前一日；7 / 30 天比较前一等长周期，未控制星期结构、活动阶段或库存变化。</p>
      {!r.available ? <p>当前没有可用于经营诊断的有效日报；不生成经营好坏判断。</p> : r.findings.length === 0 ? <p>当前模板未产生可验证的经营发现；这不代表经营健康，仍需补齐成本、退款及更长观察周期。</p> : r.findings.map(item => <div className="commerce-finding" key={item.id}>
        <h3><span>{item.priority}</span> {item.title}</h3>
        <dl><dt>证据 · 已观察 / 计算</dt><dd>{item.evidence}</dd><dt>解释 · 待验证</dt><dd>{item.interpretation}</dd><dt>经营影响</dt><dd>{item.impact}</dd><dt>建议动作</dt><dd>{item.action}</dd><dt>验证 / 停止条件</dt><dd>{item.validation}</dd></dl>
        <details><summary>证据引用 · {item.refs.length} 项</summary><ul>{item.refs.map(ref => <li key={ref}><code>{ref}</code></li>)}</ul></details>
      </div>)}
    </Chapter>
    <Chapter number="02" title="店铺贡献与日期覆盖">
      <DataTable headings={['店铺', '日报覆盖', '已知支付', '已知访客', '已知买家', '转化率', '客单价', '已知消耗', '全店投产', '可比支付变化']} rows={r.shops.map(s => [s.shopName, `${s.availableDays}/${r.scope.days} 天`, f(s.pay), f(s.visitors, 'count'), f(s.buyers, 'count'), f(s.conversion, 'percent'), f(s.ticket), f(s.spend), f(s.roi, 'ratio'), f(s.delta)])} />
      <p className="commerce-note">店铺金额、人数为已知合计；日报存在不保证每个字段齐全。转化、客单价和投产仅在该店本期相关字段完整时计算；可比支付变化要求该店两期支付完整。跨日访客和买家不去重。</p>
      <DataTable headings={['日期', '已知支付金额', '支付字段覆盖']} rows={r.trend.map(d => [d.date, f(d.pay), `${d.coverage}/${d.expected} 家`])} />
      <p className="commerce-note">缺失日明确展示，不补零、不连接趋势。日期覆盖不同的行不能直接解释为经营增长或下滑。</p>
    </Chapter>
    {merchandise ? <Chapter number="03" title="商品与流量诊断">
      <p>以下明细仅取截止日 <b>{r.scope.endDate}</b>，不是整个周期的商品或来源汇总。Top 列表未证明全分页覆盖；来源可能重叠，访客、买家不可直接相加构成全店漏斗。</p>
      <h3>已采集商品中的支付额前 20 项</h3>
      <DataTable headings={['店铺 / 商品', '支付金额', '占当日全店支付', '买家 / 件数', '访客', '平台商品转化率', '同日退款']} rows={r.products.slice(0, 20).map(p => {
        const store = r.cells.find(c => c.shopId === p.shopId && c.date === p.date)?.report
        return [<><b>{p.shopName}</b><br />{p.values['item_title']}<small>{p.values['item_id']}</small></>, f(number(p.values['pay_amt'])), f(ratio(p.values['pay_amt'], store?.summary['pay_amt']), 'percent'), `${f(number(p.values['pay_buyer_count']), 'count')} / ${f(number(p.values['pay_item_count']), 'count')}`, f(number(p.values['visitor_count']), 'count'), f(number(p.values['pay_rate']), 'percent'), f(number(p.values['refund_amt']))]
      })} />
      <p className="commerce-note">此排名只针对已抓取样本。件数集中只提示核验订单性质，不认定批发或异常交易。商品同日退款不一定归属于同日支付。</p>
      <h3>来源 Top 样本 · 保留店铺维度</h3>
      <DataTable headings={['店铺', '来源', '访客', '支付买家', '来源买家转化率']} rows={r.channels.map(p => [p.shopName, p.values['source_name'], f(number(p.values['visitor_count']), 'count'), f(number(p.values['pay_buyer_count']), 'count'), f(ratio(p.values['pay_buyer_count'], p.values['visitor_count']), 'percent')])} />
    </Chapter> : null}
    {advertising ? <Chapter number="04" title="广告与退款口径核查">
      <p>以下口径核查针对截止日 {r.scope.endDate}。平台 ROI 原值与“归因成交字段 / 消耗”分别展示；统计范围和归因窗未核实时不平均、不跨店排名，也不用较高值证明投放有效。</p>
      <DataTable headings={['店铺', '消耗', '归因成交字段', '字段成交 / 消耗', '平台 ROI 原值', '全店支付 / 消耗', '成功退款', '当日退款支付比', '平台退款率原值']} rows={r.advertisements.map(p => [p.shopName, f(number(p.values['ad_spend'])), f(number(p.values['ad_pay_amt'])), f(ratio(p.values['ad_pay_amt'], p.values['ad_spend']), 'ratio'), f(number(p.values['platform_ad_roi']), 'ratio'), f(ratio(p.values['pay_amt'], p.values['ad_spend']), 'ratio'), f(number(p.values['refund_amt'])), f(ratio(p.values['refund_amt'], p.values['pay_amt']), 'percent'), f(number(p.values['platform_refund_rate']), 'percent')])} />
      <p>成功退款来自店铺级汇总。退款可能跨支付周期，当日退款支付比可以超过 100%，不能解释为该日订单的真实退款率。Top 商品退款不能补作全店退款。</p>
    </Chapter> : null}
    <Chapter number="05" title="7 / 14 / 30 天执行计划">
      <p>以下负责人、时间和验收条件为建议；未触发的经营规则不生成处方。置信度说明证据强弱，不是统计概率。</p>
      <DataTable headings={['优先级 / 动作', '建议负责人', '时间', '影响 / 置信 / 工作量', '验收与停止条件']} rows={r.findings.map(a => [<><b>{a.priority} · {a.title}</b><p>{a.action}</p></>, a.owner, a.horizon, `${a.impact} / ${a.confidence} / ${a.effort}`, a.validation])} />
      <div className="commerce-plan"><div><h3>14 天：获得连续可比基线</h3><p>建议运营负责人持续记录完整自然日，区分集中成交、常态订单与不同流量来源；验收为每天覆盖状态明确、所有解释可追溯。不以缺失日作为零成交。</p></div><div><h3>30 天：补齐贡献与供货证据</h3><p>建议经营负责人补齐商品成本、平台费、履约、原订单退款归因与库存。只有同口径成本后贡献为正、库存及履约允许时，才进入预算或补货评估。</p></div></div>
    </Chapter>
    <Chapter number="06" title="数据质量、未知项与追溯">
      <p>数据版本：{r.normalizerVersions.join('、') || '无有效数据'}。分析版本：{r.version}。复用本地 ReportDataset；生成过程中不请求平台重新采集。</p>
      <ul><li>缺少商品成本、履约费、佣金及结算，无法给出利润、保本预算或净收入结论。</li><li>缺少订单与客户归因，不能判断复购、批量订单性质及原支付周期退款率。</li><li>缺少库存、在途和供货周期，不能计算补货数量或库存周转。</li><li>阈值属于模板观察规则，不是行业基准；比较仅为描述性变化，不证明因果。</li></ul>
      {r.warnings.length ? <details open><summary>来源警告 · {r.warnings.length} 项</summary><ul>{r.warnings.map(w => <li key={w}>{w}</li>)}</ul></details> : null}
      <details><summary>店铺日覆盖与字段状态 · 两个周期</summary><DataTable headings={['日期', '店铺', '状态', '支付', '访客', '买家', '消耗', '退款']} rows={r.cells.map(c => [c.date, r.scope.shops.find(s => s.shopId === c.shopId)?.shopName ?? c.shopId, c.error ?? (c.report ? '已采集' : '未采集 / 无有效报表'), ...['pay_amt', 'visitor_count', 'pay_buyer_count', 'ad_spend', 'refund_amt'].map(k => f(number(c.report?.summary[k]), k.includes('count') ? 'count' : 'money'))])} /></details>
      <details><summary>数据集与来源引用 · {r.sources.length} 项</summary><ul>{r.sources.map(s => <li key={s}><code>{s}</code></li>)}</ul></details>
      <p className="commerce-note">分析方法参照 omnichannel-commerce-assistant：观察 / 计算 → 解释 → 影响 → 动作 → 验证。模板与生成逻辑随应用发布，不依赖本机 skill 目录、模型服务或 API Key。</p>
    </Chapter>
  </article>
}

export function renderCommerceAnalysisHtml(report: CommerceAnalysis): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>店铺数据分析 · ${report.scope.endDate}</title><style>${reportCss}</style></head><body>${renderToStaticMarkup(<CommerceAnalysisReport report={report} />)}</body></html>`
}
