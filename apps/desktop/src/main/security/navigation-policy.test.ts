import { describe, expect, it } from 'vitest'
import { isAllowedAccountUrl } from './navigation-policy.js'

describe('isAllowedAccountUrl', () => {
  const hosts = ['pinduoduo.com']

  it('allows HTTPS pages on the configured host and subdomains', () => {
    expect(isAllowedAccountUrl('https://mms.pinduoduo.com/home', hosts)).toBe(true)
    expect(isAllowedAccountUrl('https://pinduoduo.com/', hosts)).toBe(true)
  })

  it('rejects lookalike domains, credentials and unsafe protocols', () => {
    expect(isAllowedAccountUrl('https://pinduoduo.com.attacker.example/', hosts)).toBe(false)
    expect(isAllowedAccountUrl('https://user:pass@pinduoduo.com/', hosts)).toBe(false)
    expect(isAllowedAccountUrl('javascript:alert(1)', hosts)).toBe(false)
    expect(isAllowedAccountUrl('http://pinduoduo.com/', hosts)).toBe(false)
  })
})

