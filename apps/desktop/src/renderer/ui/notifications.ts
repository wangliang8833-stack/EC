export type NotificationTone = 'success' | 'info' | 'warning' | 'error'

export interface AppNotification {
  id: string
  tone: NotificationTone
  title: string
  description: string
  createdAt: string
  read: boolean
}

export type NotificationInput = Omit<AppNotification, 'createdAt' | 'read'>

export function upsertNotification(previous: AppNotification[], input: NotificationInput, createdAt = new Date().toISOString()): AppNotification[] {
  const existing = previous.find(({ id }) => id === input.id)
  if (existing && existing.tone === input.tone && existing.title === input.title && existing.description === input.description) return previous
  const notification: AppNotification = { ...input, createdAt, read: false }
  return [notification, ...previous.filter(({ id }) => id !== input.id)].slice(0, 50)
}

export function markNotificationsRead(notifications: AppNotification[]): AppNotification[] {
  if (notifications.every(({ read }) => read)) return notifications
  return notifications.map((notification) => notification.read ? notification : { ...notification, read: true })
}
