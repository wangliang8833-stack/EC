import { describe, expect, it } from 'vitest'
import { isWanxiangLoginUrl, resolveWorkspaceShortcut } from './workspace-shortcuts.js'

describe('workspace shortcuts', () => {
  it('maps Tmall shortcuts to fixed HTTPS entry pages', () => {
    expect(resolveWorkspaceShortcut('tmall', 'sycm')).toEqual({ title: '生意参谋', url: 'https://sycm.taobao.com/' })
    expect(resolveWorkspaceShortcut('tmall', 'wanxiang')).toEqual({ title: '万相台', url: 'https://one.alimama.com/index.html#!/login/index' })
    expect(resolveWorkspaceShortcut('tmall', 'seller')).toEqual({ title: '卖家首页', url: 'https://myseller.taobao.com/home.htm' })
  })

  it('does not expose Tmall shortcuts to other platform workspaces', () => {
    expect(() => resolveWorkspaceShortcut('pinduoduo', 'sycm')).toThrow(/仅支持天猫/)
  })

  it('recognizes only the Wanxiang login route as requiring the entry click', () => {
    expect(isWanxiangLoginUrl('https://one.alimama.com/index.html#!/login/index')).toBe(true)
    expect(isWanxiangLoginUrl('https://one.alimama.com/index.html#!/home/index')).toBe(false)
    expect(isWanxiangLoginUrl('https://one.alimama.com/index.html')).toBe(false)
    expect(isWanxiangLoginUrl('https://one.alimama.com.evil.example/index.html#!/login/index')).toBe(false)
  })
})
