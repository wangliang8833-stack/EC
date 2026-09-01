import type { AccountConfig, CollectionProbeResult } from '@ecommerce/shared'
import { describe, expect, it, vi } from 'vitest'
import { DataUpdateService, selectEffectiveAccounts } from './data-update-service.js'

function account(id: string, shopId: string, enabled = true, loginStatus: AccountConfig['login_status'] = 'authenticated'): AccountConfig {
  return {
    schema_version: '1.0.0', account_id: id, platform: 'tmall', shop_id: shopId, shop_name: `店铺${shopId}`,
    subaccount_name: id, owner: '负责人', session_partition: `persist:account-${id}`, credential_ref: null,
    login_url: 'https://myseller.taobao.com/home.htm', allowed_hosts: ['taobao.com', 'tmall.com'], enabled,
    login_status: loginStatus, last_login_checked_at: null, created_at: '2026-08-28T00:00:00.000Z', updated_at: '2026-08-28T00:00:00.000Z'
  }
}

describe('DataUpdateService', () => {
  it('updates each enabled shop once in the background for the exact requested date', async () => {
    const accounts = [account('acc_a1', 'shop_a'), account('acc_a2', 'shop_a', true, 'need_human_login'), account('acc_b', 'shop_b'), account('acc_off', 'shop_off', false)]
    const calls: Array<{ accountId: string; bizDate: string | undefined; background: boolean | undefined; forceRefresh: boolean | undefined }> = []
    const service = new DataUpdateService(
      { list: async () => accounts, updateLoginStatus: async () => accounts[0]! },
      { run: async (value, options) => {
        calls.push({ accountId: value.account_id, bizDate: options?.bizDate, background: options?.background, forceRefresh: options?.forceRefresh })
        return { status: value.shop_id === 'shop_b' ? 'ALREADY_COLLECTED' : 'SUCCESS', warning: null } as CollectionProbeResult
      } }
    )

    const result = await service.run({ bizDate: '2026-08-27', platforms: ['tmall'], shopIds: ['shop_a', 'shop_b'], forceRefresh: true })

    expect(calls).toEqual([
      { accountId: 'acc_a1', bizDate: '2026-08-27', background: true, forceRefresh: true },
      { accountId: 'acc_b', bizDate: '2026-08-27', background: true, forceRefresh: true }
    ])
    expect(result).toMatchObject({ total: 2, updated: 1, skipped: 1, needLogin: 0, failed: 0, bizDate: '2026-08-27' })
  })

  it('prefers the authenticated subaccount when a shop has more than one enabled account', () => {
    expect(selectEffectiveAccounts([account('waiting', 'same', true, 'need_human_login'), account('ready', 'same')]).map(({ account_id }) => account_id)).toEqual(['ready'])
  })

  it('updates only shops included in the requested dashboard scope', async () => {
    const accounts = [account('acc_a', 'shop_a'), account('acc_b', 'shop_b')]
    const calls: string[] = []
    const service = new DataUpdateService(
      { list: async () => accounts, updateLoginStatus: async () => accounts[0]! },
      { run: async (value) => {
        calls.push(value.shop_id)
        return { status: 'SUCCESS', warning: null } as CollectionProbeResult
      } }
    )

    const result = await service.run({ bizDate: '2026-08-27', platforms: ['tmall'], shopIds: ['shop_b'] })

    expect(calls).toEqual(['shop_b'])
    expect(result).toMatchObject({ total: 1, updated: 1 })
  })

  it('runs stores in bounded concurrent batches', async () => {
    const accounts = [account('acc_a', 'shop_a'), account('acc_b', 'shop_b'), account('acc_c', 'shop_c')]
    let inFlight = 0
    let maximumInFlight = 0
    const releases: Array<() => void> = []
    const service = new DataUpdateService(
      { list: async () => accounts, updateLoginStatus: async () => accounts[0]! },
      { run: async () => {
        inFlight += 1
        maximumInFlight = Math.max(maximumInFlight, inFlight)
        await new Promise<void>((resolve) => releases.push(resolve))
        inFlight -= 1
        return { status: 'SUCCESS', warning: null } as CollectionProbeResult
      } }
    )

    const running = service.run({ bizDate: '2026-08-28', platforms: ['tmall'], shopIds: ['shop_a', 'shop_b', 'shop_c'] }, { concurrency: 2 })
    await vi.waitFor(() => expect(releases).toHaveLength(2))
    releases.splice(0).forEach((release) => release())
    await vi.waitFor(() => expect(releases).toHaveLength(1))
    releases.splice(0).forEach((release) => release())
    const completed = await running

    expect(maximumInFlight).toBe(2)
    expect(completed.updated).toBe(3)
  })
})
