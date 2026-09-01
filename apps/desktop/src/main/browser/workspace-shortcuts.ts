import type { TmallWorkspaceShortcut } from '@ecommerce/shared'

export interface WorkspaceShortcutTarget {
  title: string
  url: string
}

const TMALL_SHORTCUTS: Readonly<Record<TmallWorkspaceShortcut, WorkspaceShortcutTarget>> = {
  sycm: { title: '生意参谋', url: 'https://sycm.taobao.com/' },
  wanxiang: { title: '万相台', url: 'https://one.alimama.com/index.html#!/login/index' },
  seller: { title: '卖家首页', url: 'https://myseller.taobao.com/home.htm' }
}

export function resolveWorkspaceShortcut(platform: string, shortcut: TmallWorkspaceShortcut): WorkspaceShortcutTarget {
  if (platform !== 'tmall') throw new Error('快捷入口目前仅支持天猫店铺')
  return TMALL_SHORTCUTS[shortcut]
}

export function isWanxiangLoginUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    return url.hostname === 'one.alimama.com' && /(?:^|\/)login(?:\/|$)/iu.test(url.hash.replace(/^#!?\/?/u, ''))
  } catch {
    return false
  }
}
