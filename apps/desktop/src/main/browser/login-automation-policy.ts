export interface CredentialFrameLike {
  url: string
}

export function isAllowedCredentialFrameUrl(value: string, credentialHosts: readonly string[]): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && credentialHosts.includes(url.hostname)
  } catch {
    return false
  }
}

export function selectCredentialFrame<T extends CredentialFrameLike>(
  mainFrame: T,
  frames: readonly T[],
  credentialHosts: readonly string[]
): T | undefined {
  const eligibleFrames = frames.filter((frame) => isAllowedCredentialFrameUrl(frame.url, credentialHosts))
  return eligibleFrames.find((frame) => frame !== mainFrame) ?? eligibleFrames.find((frame) => frame === mainFrame)
}
