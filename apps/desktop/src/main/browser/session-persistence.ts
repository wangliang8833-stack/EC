import type { Session } from 'electron'

type PersistentSession = Pick<Session, 'cookies' | 'flushStorageData'>

export async function flushPersistentSession(accountSession: PersistentSession): Promise<void> {
  await accountSession.cookies.flushStore()
  accountSession.flushStorageData()
}
