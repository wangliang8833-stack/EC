import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isWanxiangLoginUrl, resolveWorkspaceShortcut, shouldClickBackendEntry } from './workspace-shortcuts.js'

describe('workspace shortcuts', () => {
  it('maps Tmall shortcuts to fixed HTTPS entry pages', () => {
    expect(resolveWorkspaceShortcut('tmall', 'sycm')).toEqual({ title: '生意参谋', url: 'https://sycm.taobao.com/' })
    expect(resolveWorkspaceShortcut('tmall', 'wanxiang')).toEqual({ title: '万相台', url: 'https://one.alimama.com/index.html#!/login/index' })
    expect(resolveWorkspaceShortcut('tmall', 'seller')).toEqual({ title: '卖家首页', url: 'https://myseller.taobao.com/home.htm' })
    expect(resolveWorkspaceShortcut('tmall', 'dmp')).toEqual({ title: '达摩盘', url: 'https://dmp.taobao.com/' })
  })

  it('exposes DMP to Taobao while keeping Tmall-only shortcuts restricted', () => {
    expect(resolveWorkspaceShortcut('taobao', 'dmp')).toEqual({ title: '达摩盘', url: 'https://dmp.taobao.com/' })
    expect(() => resolveWorkspaceShortcut('taobao', 'sycm')).toThrow(/仅支持天猫/)
    expect(() => resolveWorkspaceShortcut('pinduoduo', 'sycm')).toThrow(/仅支持天猫/)
    expect(() => resolveWorkspaceShortcut('pinduoduo', 'dmp')).toThrow(/仅支持天猫\/淘宝/)
  })

  it('recognizes only the Wanxiang login route as requiring the entry click', () => {
    expect(isWanxiangLoginUrl('https://one.alimama.com/index.html#!/login/index')).toBe(true)
    expect(isWanxiangLoginUrl('https://one.alimama.com/index.html#!/home/index')).toBe(false)
    expect(isWanxiangLoginUrl('https://one.alimama.com/index.html')).toBe(false)
    expect(isWanxiangLoginUrl('https://one.alimama.com.evil.example/index.html#!/login/index')).toBe(false)
  })

  it('requires the backend entry click on the DMP landing page', () => {
    expect(shouldClickBackendEntry('dmp', 'https://dmp.taobao.com/')).toBe(true)
    expect(shouldClickBackendEntry('dmp', 'https://dmp.taobao.com/dashboard')).toBe(false)
    expect(shouldClickBackendEntry('dmp', 'https://dmp.taobao.com.evil.example/')).toBe(false)
    expect(shouldClickBackendEntry('seller', 'https://myseller.taobao.com/home.htm')).toBe(false)
  })

  it('keeps browser navigation in the flexible left toolbar area', () => {
    const cssPath = fileURLToPath(new URL('../../renderer/ui/styles.css', import.meta.url))
    const css = readFileSync(cssPath, 'utf8')
    expect(css).toMatch(/\.shop-workspace-toolbar\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+auto;/su)
    expect(css).toMatch(/\.shop-workspace-leading\s*\{[^}]*display:\s*flex;/su)
  })
})
