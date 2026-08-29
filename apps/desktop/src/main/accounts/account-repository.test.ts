import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { JsonStorageService } from '../storage/json-storage-service.js'
import { AccountRepository } from './account-repository.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function repository(): Promise<AccountRepository> {
  const root = await mkdtemp(join(tmpdir(), 'tmall-account-'))
  roots.push(root)
  const storage = new JsonStorageService(root)
  await storage.initialize()
  return new AccountRepository(root, storage)
}

describe('AccountRepository', () => {
  const input = {
    platform: 'tmall' as const,
    shopName: '测试旗舰店',
    subaccountName: '数据子账号',
    owner: '测试负责人',
    authorizationConfirmed: true
  }

  it('creates a schema-valid isolated tmall account without credentials', async () => {
    const accounts = await repository()
    const created = await accounts.create(input)

    expect(created.account_id).toMatch(/^acc_[a-f0-9]{32}$/)
    expect(created.shop_id).toMatch(/^T\d{4}$/)
    expect(Number(created.shop_id.slice(1))).toBe(1)
    expect(created.session_partition).toBe(`persist:account-${created.account_id}`)
    expect(created.login_status).toBe('need_human_login')
    expect(created.login_url).toBe('https://myseller.taobao.com/home.htm')
    expect(JSON.stringify(created)).not.toMatch(/password|cookie|token/i)
    await expect(accounts.get(created.account_id)).resolves.toEqual(created)
  })

  it('rejects a duplicate shop and subaccount pair', async () => {
    const accounts = await repository()
    await accounts.create(input)
    await expect(accounts.create(input)).rejects.toThrow(/已经存在/)
  })

  it('allocates the next platform shop identifier without accepting user input', async () => {
    const accounts = await repository()
    await accounts.create(input)
    const second = await accounts.create({ ...input, shopName: '第二家店铺', subaccountName: '第二子账号' })
    expect(second.shop_id).toMatch(/^T\d{4}$/)
    expect(Number(second.shop_id.slice(1))).toBe(2)
  })

  it('creates a non-Tmall account from its server-owned platform preset', async () => {
    const accounts = await repository()
    const created = await accounts.create({ ...input, platform: 'pinduoduo', shopName: '拼多多测试店' })
    expect(created.shop_id).toBe('P0001')
    expect(created.login_url).toBe('https://mms.pinduoduo.com/')
    expect(created.allowed_hosts).toEqual(['pinduoduo.com'])
  })

  it('serializes concurrent allocations so two accounts cannot receive the same shop identifier', async () => {
    const accounts = await repository()
    const [first, second] = await Promise.all([
      accounts.create({ ...input, shopName: '并发店铺一', subaccountName: '并发子账号一' }),
      accounts.create({ ...input, shopName: '并发店铺二', subaccountName: '并发子账号二' })
    ])
    expect([first.shop_id, second.shop_id].map(id => Number(id.slice(1))).sort()).toEqual([1, 2])
  })

  it('persists login inspection status and timestamp', async () => {
    const accounts = await repository()
    const created = await accounts.create(input)
    const checkedAt = '2026-08-27T08:00:00.000Z'
    await accounts.updateLoginStatus(created.account_id, 'authenticated', checkedAt)

    const summary = (await accounts.summaries())[0]
    expect(summary?.loginStatus).toBe('authenticated')
    expect(summary?.lastLoginCheckedAt).toBe(checkedAt)
  })

  it('stores only an opaque credential reference in account JSON', async () => {
    const accounts = await repository()
    const created = await accounts.create(input)
    const credentialRef = `credential_${'a'.repeat(64)}`
    const updated = await accounts.updateCredentialRef(created.account_id, credentialRef)
    expect(updated.credential_ref).toBe(credentialRef)
    expect(JSON.stringify(updated)).not.toMatch(/password|not-a-real-password/i)
  })

  it('persists the sidebar enable switch and restores a login-required state', async () => {
    const accounts = await repository()
    const created = await accounts.create(input)

    await accounts.updateEnabled(created.account_id, false)
    expect((await accounts.summaries())[0]).toMatchObject({ enabled: false, loginStatus: 'disabled' })

    await accounts.updateEnabled(created.account_id, true)
    expect((await accounts.summaries())[0]).toMatchObject({ enabled: true, loginStatus: 'need_human_login' })
  })

  it('updates editable profile fields without changing account identity or session', async () => {
    const accounts = await repository()
    const created = await accounts.create(input)
    const updated = await accounts.updateProfile(created.account_id, { shopName: '新店铺名称', subaccountName: '新子账号', owner: '新负责人' })

    expect(updated).toMatchObject({ shop_name: '新店铺名称', subaccount_name: '新子账号', owner: '新负责人' })
    expect(updated.account_id).toBe(created.account_id)
    expect(updated.shop_id).toBe(created.shop_id)
    expect(updated.session_partition).toBe(created.session_partition)
  })
})
