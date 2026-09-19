import type { AccountConfig } from '@ecommerce/shared'
import type { TmallDailySnapshot } from '../browser/browser-profile-manager.js'
import type { JsonStorageService } from '../storage/json-storage-service.js'

export function historyAccount(shopId = 'TEST_SHOP_5'): AccountConfig {
  return { schema_version: '1.0.0', account_id: `acc_${shopId}`, platform: 'tmall', shop_id: shopId, shop_name: `测试${shopId}`, subaccount_name: '测试', owner: '测试', session_partition: `persist:account-acc_${shopId}`, credential_ref: null, login_url: 'https://myseller.taobao.com/home.htm', allowed_hosts: ['taobao.com', 'tmall.com'], enabled: true, login_status: 'authenticated', last_login_checked_at: null, created_at: '2026-09-19T01:00:00Z', updated_at: '2026-09-19T01:00:00Z' }
}
export function historySnapshot(date = '2026-09-12', pay = 20): TmallDailySnapshot {
  const endpoint = (data: unknown) => ({ ok: true, status: 200, requestDate: date, capturedAt: '2026-09-19T01:00:00Z', body: { code: 0, data } })
  return { bizDate: date, capturedAt: '2026-09-19T01:00:00Z', pages: [
    { key: 'store', sourcePage: '概览', sourceUrl: 'https://sycm.taobao.com/portal/home.htm', endpoints: { '/portal/board/grow/factor/overview.json': endpoint({ totalPromoSpend: 3, clicks: 1 }) } },
    { key: 'trade', sourcePage: '昨日交易', sourceUrl: 'https://sycm.taobao.com/ipoll/index.htm', endpoints: {} },
    { key: 'flow', sourcePage: '流量', sourceUrl: 'https://sycm.taobao.com/flow/monitor/overview', endpoints: {
      '/flow/new/guide/trend/overview.json': endpoint({ payAmt: pay, uv: 2, pv: 5, payOrdCnt: 1, payByrCnt: 1 }),
      '/flow/v3/overview/shopFlowSourceTop/v4.json': endpoint([]), '/flow/new/overview/keywordTop.json': endpoint([])
    } },
    { key: 'item', sourcePage: '商品', sourceUrl: 'https://sycm.taobao.com/cc/item_rank', endpoints: { '/cc/item/view/top.json': endpoint([{ itemId: '1000', payAmt: pay, title: '测试商品' }]) } },
    { key: 'service', sourcePage: '客服', sourceUrl: 'https://sycm.taobao.com/qos/service/core_monitor/new', endpoints: { '/csp/api/core/monitor/overview/list': endpoint([]), '/csp/api/core/monitor/list': endpoint([]) } }
  ] }
}
export async function saveHistoryRaw(storage: JsonStorageService, account: AccountConfig, snapshot: TmallDailySnapshot, runId = 'run_fixture'): Promise<string[]> {
  const paths: string[] = []
  for (const page of snapshot.pages) {
    const path = `data/raw/tmall/${account.shop_id}/${account.account_id}/${page.key}/${snapshot.bizDate.replaceAll('-', '/')}/${runId}.json`
    await storage.writeJson(path, { run_id: runId, platform: 'tmall', account_id: account.account_id, shop_id: account.shop_id, data_type: `${page.key}_daily`, data_date: snapshot.bizDate, collected_at: snapshot.capturedAt, source: { page_url: page.sourceUrl, page_title: page.sourcePage }, payload: page.endpoints })
    paths.push(path)
  }
  return paths
}
