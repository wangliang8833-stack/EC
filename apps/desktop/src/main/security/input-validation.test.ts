import { describe, expect, it } from 'vitest'
import { assertAccountCredentialInput, assertCreateAccountInput, assertDataUpdateRequest, assertStorageDirectoryKind, assertUpdateAccountInput, assertUpdateStorageSettingsInput, assertWorkspaceBounds } from './input-validation.js'

describe('assertCreateAccountInput', () => {
  const valid = {
    platform: 'tmall',
    shopName: '测试旗舰店',
    subaccountName: '数据子账号',
    owner: '测试负责人',
    authorizationConfirmed: true
  }

  it.each(['tmall', 'pinduoduo', 'taobao', 'jd', 'douyin', 'kuaishou', 'wechat_channels', '1688'])('accepts an authorized %s configuration without credentials', (platform) => {
    expect(() => assertCreateAccountInput({ ...valid, platform })).not.toThrow()
  })

  it('rejects credential-like and unknown fields', () => {
    expect(() => assertCreateAccountInput({ ...valid, password: 'forbidden' })).toThrow(/credentials/)
    expect(() => assertCreateAccountInput({ ...valid, loginUrl: 'https://attacker.example' })).toThrow(/unsupported/)
  })

  it('requires explicit authorization and safe identifiers', () => {
    expect(() => assertCreateAccountInput({ ...valid, authorizationConfirmed: false })).toThrow(/authorized/)
    expect(() => assertCreateAccountInput({ ...valid, shopId: 'manual_id' })).toThrow(/unsupported/)
  })

  it('rejects platforms outside the fixed account platform list', () => {
    expect(() => assertCreateAccountInput({ ...valid, platform: 'unknown-marketplace' })).toThrow(/unsupported/)
  })
})

describe('assertAccountCredentialInput', () => {
  it('accepts an explicitly authorized credential payload', () => {
    expect(() => assertAccountCredentialInput({
      username: 'shop:user',
      password: 'not-a-real-password',
      authorizationConfirmed: true
    })).not.toThrow()
  })

  it('rejects missing authorization and extra fields', () => {
    expect(() => assertAccountCredentialInput({ username: 'user', password: 'password', authorizationConfirmed: false })).toThrow()
    expect(() => assertAccountCredentialInput({ username: 'user', password: 'password', authorizationConfirmed: true, token: 'forbidden' })).toThrow()
  })
})

describe('assertUpdateAccountInput', () => {
  it('accepts editable display fields and rejects identity or credential fields', () => {
    expect(() => assertUpdateAccountInput({ shopName: '新店铺名', subaccountName: '新子账号名', owner: '新负责人' })).not.toThrow()
    expect(() => assertUpdateAccountInput({ shopName: '新店铺名', subaccountName: '新子账号名', owner: '新负责人', shopId: 'changed' })).toThrow(/unsupported/)
    expect(() => assertUpdateAccountInput({ shopName: '新店铺名', subaccountName: '新子账号名', owner: '新负责人', password: 'forbidden' })).toThrow(/unsupported/)
  })
})

describe('workspace bounds validation', () => {
  it('accepts a visible integer rectangle and rejects unsafe values', () => {
    expect(() => assertWorkspaceBounds({ x: 244, y: 58, width: 1000, height: 720 })).not.toThrow()
    expect(() => assertWorkspaceBounds({ x: 244, y: 58, width: 100, height: 720 })).toThrow(/too small/)
    expect(() => assertWorkspaceBounds({ x: 244, y: 58, width: 1000, height: 720, url: 'https://attacker.example' })).toThrow(/unsupported/)
    expect(() => assertWorkspaceBounds({ x: -1, y: 58, width: 1000, height: 720 })).toThrow(/invalid/)
  })
})

describe('storage settings input validation', () => {
  it('accepts only the two whitelisted storage directory kinds', () => {
    expect(() => assertStorageDirectoryKind('local_data')).not.toThrow()
    expect(() => assertStorageDirectoryKind('environment_data')).not.toThrow()
    expect(() => assertStorageDirectoryKind('remote_data')).toThrow(/invalid/)
  })

  it('rejects missing, non-string and extra settings fields', () => {
    const valid = { localDataDirectory: 'D:\\ecommerce-data', environmentDataDirectory: 'D:\\ecommerce-session' }
    expect(() => assertUpdateStorageSettingsInput(valid)).not.toThrow()
    expect(() => assertUpdateStorageSettingsInput({ ...valid, remoteUrl: 'https://example.test' })).toThrow(/unsupported/)
    expect(() => assertUpdateStorageSettingsInput({ localDataDirectory: 123, environmentDataDirectory: 'D:\\session' })).toThrow(/strings/)
  })
})

describe('data update request validation', () => {
  it('accepts one exact ISO date and rejects ambiguous or expanded input', () => {
    expect(() => assertDataUpdateRequest({ bizDate: '2026-08-28', platforms: ['tmall'], shopIds: ['shop_a'] })).not.toThrow()
    expect(() => assertDataUpdateRequest({ bizDate: '2026-08-28', platforms: ['tmall'], shopIds: ['shop_a'], forceRefresh: true })).not.toThrow()
    expect(() => assertDataUpdateRequest({ bizDate: '昨日', platforms: ['tmall'], shopIds: ['shop_a'] })).toThrow(/bizDate/)
    expect(() => assertDataUpdateRequest({ bizDate: '2026-8-28', platforms: ['tmall'], shopIds: ['shop_a'] })).toThrow(/bizDate/)
    expect(() => assertDataUpdateRequest({ bizDate: '2026-08-28', platforms: ['tmall'], shopIds: [] })).toThrow(/shopIds/)
    expect(() => assertDataUpdateRequest({ bizDate: '2026-08-28', platforms: ['tmall'], shopIds: ['shop_a'], force: true })).toThrow(/unsupported fields/)
  })
})
