import { describe, expect, it } from 'vitest'
import { getPlatformPreset } from './platform-presets.js'

const platforms = ['tmall', 'pinduoduo', 'taobao', 'jd', 'douyin', 'kuaishou', 'wechat_channels', '1688'] as const

describe('platform account presets', () => {
  it.each(platforms)('provides a fixed HTTPS environment for %s', (platform) => {
    const preset = getPlatformPreset(platform)
    const loginUrl = new URL(preset.loginUrl)
    expect(preset.platform).toBe(platform)
    expect(loginUrl.protocol).toBe('https:')
    expect(preset.allowedHosts.some((host) => loginUrl.hostname === host || loginUrl.hostname.endsWith(`.${host}`))).toBe(true)
  })

  it('fails closed for an unknown platform', () => {
    expect(() => getPlatformPreset('unknown-marketplace')).toThrow(/Unsupported platform preset/)
  })
})
