import type { TmallWorkspaceShortcut } from '@ecommerce/shared'

export interface WorkspaceShortcutTarget {
  title: string
  url: string
}

const TAOBAO_ECOSYSTEM_SHORTCUTS: Readonly<Record<TmallWorkspaceShortcut, WorkspaceShortcutTarget>> = {
  sycm: { title: '生意参谋', url: 'https://sycm.taobao.com/' },
  wanxiang: { title: '万相台', url: 'https://one.alimama.com/index.html#!/login/index' },
  seller: { title: '卖家首页', url: 'https://myseller.taobao.com/home.htm' },
  dmp: { title: '达摩盘', url: 'https://dmp.taobao.com/' }
}

export function resolveWorkspaceShortcut(platform: string, shortcut: TmallWorkspaceShortcut): WorkspaceShortcutTarget {
  if (platform !== 'tmall' && !(platform === 'taobao' && shortcut === 'dmp')) {
    throw new Error(shortcut === 'dmp' ? '达摩盘快捷入口仅支持天猫/淘宝店铺' : '快捷入口目前仅支持天猫店铺')
  }
  return TAOBAO_ECOSYSTEM_SHORTCUTS[shortcut]
}

export function isWanxiangLoginUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    return url.hostname === 'one.alimama.com' && /(?:^|\/)login(?:\/|$)/iu.test(url.hash.replace(/^#!?\/?/u, ''))
  } catch {
    return false
  }
}

export function shouldClickBackendEntry(shortcut: TmallWorkspaceShortcut, rawUrl: string): boolean {
  if (shortcut === 'wanxiang') return isWanxiangLoginUrl(rawUrl)
  if (shortcut !== 'dmp') return false
  try {
    const url = new URL(rawUrl)
    return url.hostname === 'dmp.taobao.com' && (url.pathname === '/' || url.pathname === '/index.html')
  } catch {
    return false
  }
}
