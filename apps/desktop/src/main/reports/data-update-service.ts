import type { AccountConfig, CollectionProgress, DataUpdateRequest, DataUpdateResult, DataUpdateShopResult } from '@ecommerce/shared'
import type { AccountRepository } from '../accounts/account-repository.js'
import { CollectionCancelledError } from '../adapters/tmall/collection-execution.js'
import { shanghaiToday, type TmallProbeRunOptions, type TmallProbeService } from '../adapters/tmall/tmall-probe-service.js'

export interface DataUpdateOptions {
  signal?: AbortSignal | undefined
  onProgress?: (progress: CollectionProgress) => void | Promise<void>
  concurrency?: number | undefined
  batchIntervalMs?: number | undefined
}

export class DataUpdateService {
  constructor(
    private readonly accounts: Pick<AccountRepository, 'list' | 'updateLoginStatus'>,
    private readonly tmallProbe: Pick<TmallProbeService, 'run'>
  ) {}

  async run(request: DataUpdateRequest, options: DataUpdateOptions = {}): Promise<DataUpdateResult> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(request.bizDate)) throw new TypeError('bizDate must use YYYY-MM-DD')
    const today = shanghaiToday()
    if (request.bizDate > today) throw new RangeError(`不能更新未来日期 ${request.bizDate}`)
    const startedAt = new Date().toISOString()
    const requestedPlatforms = new Set(request.platforms)
    const requestedShopIds = new Set(request.shopIds)
    const effectiveAccounts = selectEffectiveAccounts(await this.accounts.list()).filter((account) =>
      requestedPlatforms.has(account.platform) && requestedShopIds.has(account.shop_id)
    )
    const concurrency = Math.max(1, Math.min(10, Math.trunc(options.concurrency ?? 1)))
    const batchIntervalMs = Math.max(0, Math.min(24 * 60 * 60 * 1_000, Math.trunc(options.batchIntervalMs ?? 0)))
    const shops: DataUpdateShopResult[] = []
    const collectAccount = async (account: AccountConfig): Promise<DataUpdateShopResult> => {
      if (options.signal?.aborted) throw new CollectionCancelledError('collection')
      try {
        const runOptions: TmallProbeRunOptions = {
          bizDate: request.bizDate,
          background: true,
          forceRefresh: request.forceRefresh === true,
          ...(options.signal ? { signal: options.signal } : {}),
          ...(options.onProgress ? { onProgress: options.onProgress } : {})
        }
        const result = await this.tmallProbe.run(account, runOptions)
        if (result.status === 'NEED_HUMAN_LOGIN') {
          await this.accounts.updateLoginStatus(account.account_id, 'need_human_login', new Date().toISOString())
        }
        return {
          accountId: account.account_id,
          shopId: account.shop_id,
          shopName: account.shop_name,
          platform: account.platform,
          status: result.status,
          warning: result.warning
        }
      } catch (error) {
        if (error instanceof CollectionCancelledError) throw error
        return {
          accountId: account.account_id,
          shopId: account.shop_id,
          shopName: account.shop_name,
          platform: account.platform,
          status: 'FAILED',
          warning: error instanceof Error ? error.message : String(error)
        }
      }
    }
    for (let index = 0; index < effectiveAccounts.length; index += concurrency) {
      if (options.signal?.aborted) throw new CollectionCancelledError('collection')
      const batch = effectiveAccounts.slice(index, index + concurrency)
      shops.push(...await Promise.all(batch.map(collectAccount)))
      if (index + concurrency < effectiveAccounts.length && batchIntervalMs > 0) {
        await waitForNextBatch(batchIntervalMs, options.signal)
      }
    }
    return {
      bizDate: request.bizDate,
      timezone: 'Asia/Shanghai',
      startedAt,
      completedAt: new Date().toISOString(),
      total: shops.length,
      updated: shops.filter(({ status }) => status === 'SUCCESS').length,
      skipped: shops.filter(({ status }) => status === 'ALREADY_COLLECTED').length,
      needLogin: shops.filter(({ status }) => status === 'NEED_HUMAN_LOGIN').length,
      failed: shops.filter(({ status }) => status === 'FAILED').length,
      shops
    }
  }
}

async function waitForNextBatch(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new CollectionCancelledError('collection')
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, milliseconds)
    const abort = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      reject(new CollectionCancelledError('collection'))
    }
    function done(): void {
      signal?.removeEventListener('abort', abort)
      resolve()
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

export function selectEffectiveAccounts(accounts: AccountConfig[]): AccountConfig[] {
  const selected = new Map<string, AccountConfig>()
  for (const account of accounts.filter(({ enabled, platform }) => enabled && platform === 'tmall')) {
    const key = `${account.platform}/${account.shop_id}`
    const current = selected.get(key)
    if (!current || (current.login_status !== 'authenticated' && account.login_status === 'authenticated')) selected.set(key, account)
  }
  return [...selected.values()].sort((left, right) => left.shop_id.localeCompare(right.shop_id, 'zh-CN'))
}
