import { readdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type { AccountConfig, AccountSummary, CreateAccountInput, LoginState, UpdateAccountInput } from '@ecommerce/shared'
import { JsonStorageService } from '../storage/json-storage-service.js'
import { getPlatformPreset } from './platform-presets.js'
import { allocateShopId } from './shop-id.js'

export class AccountRepository {
  private readonly accountsDirectory: string
  private createQueue: Promise<void> = Promise.resolve()

  constructor(
    dataRoot: string,
    private readonly storage: JsonStorageService
  ) {
    this.accountsDirectory = resolve(dataRoot, 'config', 'accounts')
  }

  async list(): Promise<AccountConfig[]> {
    let fileNames: string[]
    try {
      fileNames = (await readdir(this.accountsDirectory, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => entry.name)
        .sort()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }

    return Promise.all(
      fileNames.map(async (fileName) => {
        const account = await this.storage.readJson<AccountConfig>(`config/accounts/${fileName}`, 'account-config-1.0.0')
        this.assertSessionIdentity(account)
        return account
      })
    )
  }

  async get(accountId: string): Promise<AccountConfig> {
    const account = await this.storage.readJson<AccountConfig>(
      `config/accounts/${accountId}.json`,
      'account-config-1.0.0'
    )
    this.assertSessionIdentity(account)
    if (account.account_id !== accountId) {
      throw new Error(`Account file identity mismatch for ${accountId}`)
    }
    return account
  }

  async create(input: CreateAccountInput): Promise<AccountConfig> {
    let release!: () => void
    const previous = this.createQueue
    this.createQueue = new Promise<void>((resolveQueue) => { release = resolveQueue })
    await previous
    try {
      return await this.createLocked(input)
    } finally {
      release()
    }
  }

  private async createLocked(input: CreateAccountInput): Promise<AccountConfig> {
    const existingAccounts = await this.list()
    const duplicate = existingAccounts.find(
      (account) =>
        account.platform === input.platform &&
        account.shop_name === input.shopName &&
        account.subaccount_name === input.subaccountName
    )
    if (duplicate) {
      throw new Error('该店铺的同名子账号环境已经存在')
    }

    const accountId = `acc_${randomUUID().replaceAll('-', '')}`
    const shopId = allocateShopId(input.platform, existingAccounts.map(({ shop_id }) => shop_id))
    const now = new Date().toISOString()
    const preset = getPlatformPreset(input.platform)
    const account: AccountConfig = {
      schema_version: '1.0.0',
      account_id: accountId,
      platform: input.platform,
      shop_id: shopId,
      shop_name: input.shopName,
      subaccount_name: input.subaccountName,
      owner: input.owner,
      session_partition: `persist:account-${accountId}`,
      credential_ref: null,
      login_url: preset.loginUrl,
      allowed_hosts: [...preset.allowedHosts],
      enabled: true,
      login_status: 'need_human_login',
      last_login_checked_at: null,
      created_at: now,
      updated_at: now
    }
    await this.storage.writeJson(`config/accounts/${accountId}.json`, account, 'account-config-1.0.0')
    return account
  }

  async updateLoginStatus(accountId: string, status: LoginState, checkedAt: string): Promise<AccountConfig> {
    const account = await this.get(accountId)
    const updated: AccountConfig = {
      ...account,
      login_status: status,
      last_login_checked_at: checkedAt,
      updated_at: checkedAt
    }
    await this.storage.writeJson(`config/accounts/${accountId}.json`, updated, 'account-config-1.0.0')
    return updated
  }

  async updateProfile(accountId: string, input: UpdateAccountInput): Promise<AccountConfig> {
    const account = await this.get(accountId)
    const duplicate = (await this.list()).find((candidate) =>
      candidate.account_id !== accountId &&
      candidate.platform === account.platform &&
      candidate.shop_id === account.shop_id &&
      candidate.subaccount_name === input.subaccountName
    )
    if (duplicate) throw new Error('该店铺的同名子账号环境已经存在')
    const updatedAt = new Date().toISOString()
    const updated: AccountConfig = {
      ...account,
      shop_name: input.shopName,
      subaccount_name: input.subaccountName,
      owner: input.owner,
      updated_at: updatedAt
    }
    await this.storage.writeJson(`config/accounts/${accountId}.json`, updated, 'account-config-1.0.0')
    return updated
  }

  async updateCredentialRef(accountId: string, credentialRef: string): Promise<AccountConfig> {
    const account = await this.get(accountId)
    const updatedAt = new Date().toISOString()
    const updated: AccountConfig = { ...account, credential_ref: credentialRef, updated_at: updatedAt }
    await this.storage.writeJson(`config/accounts/${accountId}.json`, updated, 'account-config-1.0.0')
    return updated
  }

  async updateEnabled(accountId: string, enabled: boolean): Promise<AccountConfig> {
    const account = await this.get(accountId)
    const updatedAt = new Date().toISOString()
    const updated: AccountConfig = {
      ...account,
      enabled,
      login_status: enabled && account.login_status === 'disabled' ? 'need_human_login' : enabled ? account.login_status : 'disabled',
      updated_at: updatedAt
    }
    await this.storage.writeJson(`config/accounts/${accountId}.json`, updated, 'account-config-1.0.0')
    return updated
  }

  async summaries(): Promise<AccountSummary[]> {
    return (await this.list()).map((account) => this.toSummary(account))
  }

  toSummary(account: AccountConfig): AccountSummary {
    return {
      accountId: account.account_id,
      platform: account.platform,
      shopId: account.shop_id,
      shopName: account.shop_name,
      subaccountName: account.subaccount_name,
      owner: account.owner,
      enabled: account.enabled,
      loginStatus: account.login_status,
      lastLoginCheckedAt: account.last_login_checked_at
    }
  }

  private assertSessionIdentity(account: AccountConfig): void {
    const expected = `persist:account-${account.account_id}`
    if (account.session_partition !== expected) {
      throw new Error(`Account ${account.account_id} must use session partition ${expected}`)
    }
  }
}
