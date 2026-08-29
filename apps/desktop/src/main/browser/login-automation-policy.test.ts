import { describe, expect, it } from 'vitest'
import { isAllowedCredentialFrameUrl, selectCredentialFrame } from './login-automation-policy.js'

const credentialHosts = ['login.taobao.com', 'havanalogin.taobao.com']

describe('login automation policy', () => {
  it('accepts only HTTPS pages on an exact official credential host', () => {
    expect(isAllowedCredentialFrameUrl('https://login.taobao.com/member/login.jhtml', credentialHosts)).toBe(true)
    expect(isAllowedCredentialFrameUrl('https://havanalogin.taobao.com/mini_login.htm', credentialHosts)).toBe(true)
    expect(isAllowedCredentialFrameUrl('https://loginmyseller.taobao.com/', credentialHosts)).toBe(false)
    expect(isAllowedCredentialFrameUrl('http://login.taobao.com/member/login.jhtml', credentialHosts)).toBe(false)
    expect(isAllowedCredentialFrameUrl('https://login.taobao.com.evil.example/login', credentialHosts)).toBe(false)
    expect(isAllowedCredentialFrameUrl('not-a-url', credentialHosts)).toBe(false)
  })

  it('prefers an eligible child login frame over the eligible main frame', () => {
    const mainFrame = { url: 'https://login.taobao.com/' }
    const advertisingFrame = { url: 'https://ads.example/' }
    const loginFrame = { url: 'https://login.taobao.com/member/login.jhtml' }

    expect(selectCredentialFrame(mainFrame, [mainFrame, advertisingFrame, loginFrame], credentialHosts)).toBe(loginFrame)
  })

  it('falls back to an eligible main frame and rejects unrelated frames', () => {
    const mainFrame = { url: 'https://login.taobao.com/' }
    const unrelatedFrame = { url: 'https://example.com/' }

    expect(selectCredentialFrame(mainFrame, [mainFrame, unrelatedFrame], credentialHosts)).toBe(mainFrame)
    expect(selectCredentialFrame(unrelatedFrame, [unrelatedFrame], credentialHosts)).toBeUndefined()
  })
})
