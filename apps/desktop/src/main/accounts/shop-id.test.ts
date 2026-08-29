import { describe, expect, it } from 'vitest'
import { allocateShopId, shopIdPrefix } from './shop-id.js'

describe('shop identifier allocation', () => {
  it.each([
    ['tmall', 'T'], ['taobao', 'T'], ['taogongchang', 'T'],
    ['pinduoduo', 'P'], ['jd', 'J'], ['1688', 'A'],
    ['douyin', 'D'], ['kuaishou', 'K'], ['wechat_channels', 'Q']
  ])('maps %s to the required prefix', (platform, prefix) => {
    expect(shopIdPrefix(platform)).toBe(prefix)
  })

  it('uses a four-digit sequence and shares the sequence across identical prefixes', () => {
    expect(allocateShopId('tmall', ['T8101', 'T8102', 'tmall_legacy', 'P0099'])).toBe('T8103')
    expect(allocateShopId('pinduoduo', [])).toBe('P0001')
  })

  it('fails closed for unsupported platforms and exhausted sequences', () => {
    expect(() => shopIdPrefix('unknown')).toThrow(/尚未配置/)
    expect(() => allocateShopId('jd', ['J9999'])).toThrow(/已用尽/)
  })
})
