import { _electron as electron, expect } from '@playwright/test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

// Isolated synthetic store/day reports and matching Raw. Never reads business data.
const root = await mkdtemp(join(tmpdir(), 'ecommerce-dashboard-range-'))
const output = resolve('output/playwright')
await mkdir(output, { recursive: true })
const now = new Date().toISOString()
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const shift = (date, count) => new Date(Date.parse(`${date}T00:00:00Z`) + count * 86400000).toISOString().slice(0, 10)
const yesterday = shift(today, -1), earlier = shift(today, -2)
async function save(path, data) { const target = join(root, 'app-data', path); await mkdir(resolve(target, '..'), { recursive: true }); await writeFile(target, JSON.stringify(data)) }
for (const [index, shopId] of ['T9001', 'T9002'].entries()) {
  const account = { schema_version: '1.0.0', account_id: `acc_${shopId}`, platform: 'tmall', shop_id: shopId, shop_name: index === 0 ? '完整示例店' : '缺日报示例店', subaccount_name: '隔离测试', owner: '测试', session_partition: `persist:account-acc_${shopId}`, credential_ref: null, login_url: 'https://myseller.taobao.com/home.htm', allowed_hosts: ['taobao.com', 'tmall.com'], enabled: true, login_status: 'authenticated', last_login_checked_at: null, created_at: now, updated_at: now }
  await save(`config/accounts/${account.account_id}.json`, account)
  for (const date of index === 0 ? [earlier, yesterday] : [yesterday]) {
    const pay = (index + 1) * 100
    const endpoint = data => ({ ok: true, status: 200, requestDate: date, capturedAt: now, body: { code: 0, data } })
    const pages = {
      store: { '/portal/board/grow/factor/overview.json': endpoint({ totalPromoSpend: 10, clicks: 2 }) }, trade: {},
      flow: { '/flow/new/guide/trend/overview.json': endpoint({ payAmt: pay, uv: 20, pv: 30, payOrdCnt: 3, payByrCnt: 2 }), '/flow/v3/overview/shopFlowSourceTop/v4.json': endpoint([]), '/flow/new/overview/keywordTop.json': endpoint([]) },
      item: { '/cc/item/view/top.json': endpoint([{ itemId: '100', title: '示例商品', payAmt: pay }]) },
      service: { '/csp/api/core/monitor/overview/list': endpoint([]), '/csp/api/core/monitor/list': endpoint([]) }
    }
    const paths = []
    for (const [key, payload] of Object.entries(pages)) {
      const path = `data/raw/tmall/${shopId}/${account.account_id}/${key}/${date.replaceAll('-', '/')}/run_smoke.json`
      paths.push(path)
      await save(path, { run_id: 'run_smoke', platform: 'tmall', shop_id: shopId, account_id: account.account_id, data_type: `${key}_daily`, data_date: date, collected_at: now, source: { page_url: 'https://sycm.taobao.com/', page_title: key }, payload })
    }
    for (let n = 0; n < 7; n++) { const path = `data/normalized/tmall/${shopId}/${date}/${n}.json`; paths.push(path); await save(path, { synthetic: true }) }
    const summary = { pay_amt: pay, pay_order_count: 3, pay_buyer_count: 2, pay_item_count: 3, visitor_count: 20, page_view_count: 30, refund_amt: 0, ad_spend: 10, ad_pay_amt: 20, pay_rate: 0.1 }
    await save(`data/report-datasets/tmall/${shopId}/${date}.json`, {
      schema_version: '1.0.0', report_type: 'tmall_daily_dashboard', dataset_id: `${shopId}_${date}`,
      filters: { reportType: 'tmall_daily_dashboard', dateStart: date, dateEnd: date, platforms: ['tmall'], shopIds: [shopId], ownerIds: [] },
      meta: { shop_name: account.shop_name, date_range: date, updated_at: now, biz_date: date, data_status: 'real', collection_status: 'completed', normalizer_version: 'tmall-0.7.0', data_finality: 'final' },
      summary, trend: [{ date, ...summary }], shop_rows: [{ item_title: '示例商品', pay_amt: pay }],
      sections: { channels: [], keywords: [], campaigns: [], alerts: [], service: [] },
      quality: { complete_shop_count: 1, missing_shop_count: 0, warning_count: 0, status: 'complete', dataset_count: 7, warnings: [] }, source_paths: paths, generated_at: now
    })
  }
}
const bootstrap = join(root, 'bootstrap.cjs')
await writeFile(bootstrap, `const {app}=require('electron'); app.setPath('userData',${JSON.stringify(root)}); app.setPath('sessionData',${JSON.stringify(root)}); import(${JSON.stringify(pathToFileURL(resolve('apps/desktop/out/main/index.js')).href)});`)
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
const packaged = process.argv.find(value => value.startsWith('--executable='))?.slice('--executable='.length)
const app = await electron.launch({ executablePath: packaged ? resolve(packaged) : resolve('apps/desktop/node_modules/electron/dist/electron.exe'), args: packaged ? [`--user-data-dir=${root}`] : [bootstrap], env })
const pageErrors = []
try {
  const page = await app.firstWindow()
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.waitForFunction(() => !!window.desktopApi?.reports)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1500, height: 1000 }))
  const health = await page.evaluate(() => window.desktopApi.system.getHealth())
  assert.equal(resolve(health.dataRoot), resolve(root, 'app-data'))
  const notice = page.locator('.dashboard-date-shortcuts')
  await expect(notice.locator('.dashboard-coverage-complete')).toBeVisible()
  await expect(notice.locator('summary')).toHaveText('数据完整▼')
  const actions = page.locator('.dashboard-heading-actions').locator(':scope > .demo-badge, :scope > button')
  await expect(actions).toHaveText(['本地数据', '导出 CSV', '补齐历史数据', '更新全部有效店铺'])
  for (const width of [1280, 1500]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setBounds({ width, height: 1000 }), width)
    await expect(async () => {
      const boxes = await actions.evaluateAll(elements => elements.map(element => { const rect = element.getBoundingClientRect(); return { x: rect.x, right: rect.right, centerY: rect.y + rect.height / 2 } }))
      assert.equal(boxes.length, 4)
      assert.ok(boxes.every(box => Math.abs(box.centerY - boxes[0].centerY) < 2))
      assert.ok(boxes.slice(1).every((box, index) => box.x >= boxes[index].right))
    }).toPass()
  }
  const monthBox = await page.getByRole('button', { name: '月', exact: true }).boundingBox()
  const noticeBox = await notice.locator('summary').boundingBox()
  assert.ok(noticeBox.x >= monthBox.x + monthBox.width)
  assert.ok(Math.abs(noticeBox.y + noticeBox.height / 2 - monthBox.y - monthBox.height / 2) < 2)
  await notice.locator('summary').click()
  await expect(notice.locator('.dashboard-coverage-details')).toContainText('所选店铺各日总览核心指标完整')
  await notice.locator('summary').click()
  await expect(page.locator('.metric-card').first()).toContainText('¥300.00')
  await page.screenshot({ path: join(output, 'dashboard-range-complete.png') })
  await page.getByLabel('销售总览开始日期', { exact: true }).fill(earlier)
  await expect(notice.locator('summary')).toHaveText('数据有缺失▼')
  await expect(page.locator('.metric-card').first()).toContainText('¥400.00')
  await notice.locator('summary').click()
  await expect(notice.locator('.dashboard-coverage-details')).toContainText(earlier)
  await expect(notice.locator('.dashboard-coverage-details')).toContainText('缺日报示例店')
  await page.screenshot({ path: join(output, 'dashboard-range-missing.png') })
  await page.getByRole('button', { name: '补齐历史数据', exact: true }).click()
  await expect(page.getByLabel('补采开始日期', { exact: true })).toHaveValue(earlier)
  await expect(page.getByLabel('补采结束日期', { exact: true })).toHaveValue(yesterday)
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.locator('#dashboard-shop-filter').click()
  await page.locator('.ant-select-item-option').filter({ hasText: '天猫 · 完整示例店' }).click()
  await expect(notice.locator('.dashboard-coverage-complete')).toBeVisible()
  await expect(page.locator('.metric-card').first()).toContainText('¥200.00')
  await page.locator('#dashboard-shop-filter').click()
  await page.locator('.ant-select-item-option').filter({ hasText: '所有店铺（2 家）' }).click()
  await page.getByRole('button', { name: '周', exact: true }).click()
  const weekStart = shift(yesterday, -((new Date(`${yesterday}T00:00:00Z`).getUTCDay() + 6) % 7))
  await expect(page.getByLabel('销售总览开始日期', { exact: true })).toHaveValue(weekStart)
  await expect(page.getByRole('button', { name: /^周（/ })).toBeVisible()
  await expect(page.locator('.metric-card').first()).toContainText(earlier >= weekStart ? '¥400.00' : '¥300.00')
  await page.getByRole('button', { name: '月', exact: true }).click()
  await expect(page.getByLabel('销售总览开始日期', { exact: true })).toHaveValue(`${yesterday.slice(0, 7)}-01`)
  await expect(page.getByRole('button', { name: /^月（/ })).toBeVisible()
  await expect(page.locator('.metric-card').first()).toContainText(earlier >= `${yesterday.slice(0, 7)}-01` ? '¥400.00' : '¥300.00')
  await page.getByLabel('销售总览开始日期', { exact: true }).fill(shift(today, -31))
  await page.getByRole('button', { name: '补齐所选范围', exact: true }).click()
  await expect(page.locator('.ant-modal:visible').getByLabel('补采开始日期', { exact: true })).toHaveValue(shift(today, -31))
  await expect(page.getByText(/所选范围包含不可补采日期/)).toBeVisible()
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await page.getByRole('button', { name: '昨日', exact: true }).click()
  await expect(notice.locator('.dashboard-coverage-complete')).toBeVisible()
  await page.getByLabel('销售总览开始日期', { exact: true }).fill(today)
  await expect(page.getByText('请调整日期范围', { exact: true })).toBeVisible()
  await expect(notice.locator('.dashboard-coverage-complete')).toHaveCount(0)
  await page.getByRole('button', { name: '昨日', exact: true }).click()
  const checks = await page.evaluate(async ({ earlier, yesterday, today }) => {
    const base = { reportType: 'tmall_daily_dashboard', dateStart: earlier, dateEnd: yesterday, platforms: ['tmall'], shopIds: ['T9001', 'T9002'], ownerIds: [] }
    const report = await window.desktopApi.reports.query(base)
    const failures = []
    for (const patch of [{ dateStart: '2026-02-30' }, { dateStart: '2020-01-01' }, { dateEnd: `${Number(today.slice(0, 4)) + 1}${today.slice(4)}` }]) {
      try { await window.desktopApi.reports.query({ ...base, ...patch }); failures.push(false) } catch { failures.push(true) }
    }
    return { pay: report.summary.pay_amt, coverage: report.dashboard_coverage, shopTotals: report.sections.shop_overview.map(row => row.pay_amt), failures }
  }, { earlier, yesterday, today })
  assert.equal(checks.pay, 400)
  assert.equal(checks.coverage.completeShopCount, 1)
  assert.deepEqual(checks.shopTotals, [200, 200])
  assert.deepEqual(checks.failures, [true, true, true])
  assert.deepEqual(pageErrors, [])
  await writeFile(join(output, 'dashboard-range-smoke.json'), JSON.stringify({ passed: true, packaged: packaged ?? false, root, checks, pageErrors }, null, 2))
  console.log(JSON.stringify({ passed: true, root, checks }))
} finally { await app.close() }
