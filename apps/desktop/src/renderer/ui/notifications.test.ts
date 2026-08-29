import { describe, expect, it } from 'vitest'
import { markNotificationsRead, upsertNotification } from './notifications.js'

describe('notification center state', () => {
  it('deduplicates unchanged notifications and marks changed content unread', () => {
    const input = { id: 'quality:shop_a:2026-08-27', tone: 'warning' as const, title: '部分完整', description: '缺少退款数据' }
    const initial = upsertNotification([], input, '2026-08-28T01:00:00.000Z')
    expect(upsertNotification(initial, input, '2026-08-28T02:00:00.000Z')).toBe(initial)
    const changed = upsertNotification(markNotificationsRead(initial), { ...input, description: '数据已补齐', tone: 'success' }, '2026-08-28T03:00:00.000Z')
    expect(changed).toMatchObject([{ description: '数据已补齐', read: false, createdAt: '2026-08-28T03:00:00.000Z' }])
  })

  it('marks all unread notifications as read', () => {
    const notifications = upsertNotification([], { id: 'one', tone: 'info', title: '通知', description: '内容' })
    expect(markNotificationsRead(notifications).every(({ read }) => read)).toBe(true)
  })
})
