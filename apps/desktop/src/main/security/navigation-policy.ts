export function isAllowedAccountUrl(rawUrl: string, allowedHosts: readonly string[]): boolean {
  try {
    const url = new URL(rawUrl)
    const protocolAllowed = url.protocol === 'https:' || (url.protocol === 'http:' && isLocalhost(url.hostname))
    if (!protocolAllowed || url.username || url.password) return false
    return allowedHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))
  } catch {
    return false
  }
}

function isLocalhost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}

