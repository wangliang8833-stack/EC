import { _electron as electron } from '@playwright/test'
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'

// Uses an isolated userData directory and synthetic Raw only. Never opens a real store.
const root = await mkdtemp(join(tmpdir(), 'ecommerce-history-ui-'))
const output = resolve('output/playwright')
await mkdir(output, { recursive: true })
const now = new Date().toISOString()
const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(part => [part.type, part.value]))
const today = `${parts.year}-${parts.month}-${parts.day}`
const date = new Date(Date.parse(`${today}T00:00:00Z`) - 3 * 86400000).toISOString().slice(0, 10)
const account = { schema_version: '1.0.0', account_id: 'acc_history_smoke', platform: 'tmall', shop_id: 'T9999', shop_name: '历史补采测试店', subaccount_name: '隔离测试', owner: '测试', session_partition: 'persist:account-acc_history_smoke', credential_ref: null, login_url: 'https://myseller.taobao.com/home.htm', allowed_hosts: ['taobao.com', 'tmall.com'], enabled: true, login_status: 'authenticated', last_login_checked_at: null, created_at: now, updated_at: now }
async function save(path, value) { const target = join(root, 'app-data', path); await mkdir(resolve(target, '..'), { recursive: true }); await writeFile(target, JSON.stringify(value)) }
await save(`config/accounts/${account.account_id}.json`, account)
const endpoint = data => ({ ok: true, status: 200, requestDate: date, capturedAt: now, body: { code: 0, data } })
const pages = {
  store: { '/portal/board/grow/factor/overview.json': endpoint({ totalPromoSpend: 3, clicks: 1 }) }, trade: {},
  flow: { '/flow/new/guide/trend/overview.json': endpoint({ payAmt: 123.45, uv: 22, pv: 30, payOrdCnt: 3, payByrCnt: 2 }), '/flow/v3/overview/shopFlowSourceTop/v4.json': endpoint([]), '/flow/new/overview/keywordTop.json': endpoint([]) },
  item: { '/cc/item/view/top.json': endpoint([{ itemId: '100', title: '测试商品', payAmt: 123.45 }]) },
  service: { '/csp/api/core/monitor/overview/list': endpoint([]), '/csp/api/core/monitor/list': endpoint([]) }
}
for (const [key, payload] of Object.entries(pages)) await save(`data/raw/tmall/T9999/${account.account_id}/${key}/${date.replaceAll('-', '/')}/run_smoke.json`, { run_id: 'run_smoke', platform: 'tmall', shop_id: 'T9999', account_id: account.account_id, data_type: `${key}_daily`, data_date: date, collected_at: now, source: { page_url: 'https://sycm.taobao.com/', page_title: key }, payload })
const bootstrap = join(root, 'bootstrap.cjs')
await writeFile(bootstrap, `const { app } = require('electron'); app.setPath('userData', ${JSON.stringify(root)}); app.setPath('sessionData', ${JSON.stringify(root)}); import(${JSON.stringify(pathToFileURL(resolve('apps/desktop/out/main/index.js')).href)});`)
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
const packaged = process.argv.find(value => value.startsWith('--executable='))?.slice('--executable='.length)
const app = await electron.launch({ executablePath: packaged ? resolve(packaged) : resolve('apps/desktop/node_modules/electron/dist/electron.exe'), args: packaged ? [`--user-data-dir=${root}`] : [bootstrap], env })
const failures = []
try {
  const page = await app.firstWindow()
  page.on('pageerror', error => failures.push(error.message))
  await page.waitForFunction(() => !!window.desktopApi?.history)
  const health = await page.evaluate(() => window.desktopApi.system.getHealth())
  assert.equal(resolve(health.dataRoot), resolve(root, 'app-data'))
  await page.getByRole('button', { name: '补齐历史数据', exact: true }).click()
  await page.getByLabel('补采开始日期', { exact: true }).fill(date)
  await page.getByLabel('补采结束日期', { exact: true }).fill(date)
  await page.getByRole('button', { name: '检查数据缺口', exact: true }).click()
  await page.getByText('共 1 个店铺日：已有可跳过 0，本地重建 1，需采集 0。', { exact: true }).waitFor()
  await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().iterations)).map(animation => animation.finished.catch(() => undefined))) })
  await page.screenshot({ path: join(output, 'history-backfill-preview.png') })
  await page.getByRole('button', { name: '开始补采', exact: true }).click()
  await page.getByText('已处理，仍有数据缺口', { exact: true }).first().waitFor()
  await page.getByText('已从本地 Raw 重建；覆盖情况见明细', { exact: true }).waitFor()
  await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(animation => Number.isFinite(animation.effect?.getComputedTiming().iterations)).map(animation => animation.finished.catch(() => undefined))) })
  await page.screenshot({ path: join(output, 'history-backfill-complete.png') })
  const saved = await page.evaluate(() => window.desktopApi.history.list())
  assert.equal(saved[0].items[0].action, 'rebuild')
  assert.equal(saved[0].items[0].attempts, 0)
  const report = JSON.parse(await readFile(join(root, 'app-data/data/report-datasets/tmall/T9999', `${date}.json`), 'utf8'))
  assert.equal(report.summary.pay_amt, 123.45)
  assert.equal(report.summary.refund_amt, null)
  const query = await page.evaluate(async date => window.desktopApi.reports.query({ reportType: 'tmall_daily_dashboard', dateStart: date, dateEnd: date, platforms: ['tmall'], shopIds: ['T9999'], ownerIds: [] }), date)
  assert.equal(query.summary.pay_amt, 123.45)
  const preview = await page.evaluate(async date => window.desktopApi.history.preview({ platforms: ['tmall'], shopIds: ['T9999'], dateStart: date, dateEnd: date, mode: 'missing_only', concurrency: 2 }), date)
  assert.equal(preview.skip, 1)
  const invalid = await page.evaluate(async today => { try { await window.desktopApi.history.preview({ platforms: ['tmall'], shopIds: ['T9999'], dateStart: today, dateEnd: today, mode: 'missing_only', concurrency: 2 }); return false } catch { return true } }, today)
  assert.equal(invalid, true)
  assert.deepEqual(failures, [])
  await writeFile(join(output, 'history-backfill-smoke.json'), JSON.stringify({ passed: true, fixtureRoot: root, date, checks: ['isolated desktop preload', 'date/store preview', 'local Raw rebuild without network', 'persisted progress and gaps', 'report readback', 'idempotent second preview', 'today rejected'], pageErrors: failures }, null, 2))
  console.log(JSON.stringify({ passed: true, output, fixtureRoot: root }))
} finally { await app.close() }
