import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import app from '../app.js'
import prisma from '../config/db.js'
import { createTestUser, tokenFor, testEmail, cleanup } from './helpers.js'

let member, memberToken
let other, otherToken
let adminUser, adminToken

beforeAll(async () => {
  member    = await createTestUser({ email: testEmail('notif-member'), role: 'MEMBER' })
  other     = await createTestUser({ email: testEmail('notif-other'),  role: 'MEMBER' })
  adminUser = await createTestUser({ email: testEmail('notif-admin'),  role: 'ADMIN'  })
  ;({ accessToken: memberToken } = await tokenFor(member))
  ;({ accessToken: otherToken  } = await tokenFor(other))
  ;({ accessToken: adminToken  } = await tokenFor(adminUser))
})

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { userId: { in: [member.id, other.id, adminUser.id] } } })
  await cleanup(member.email, other.email, adminUser.email)
})

describe('Notifications', () => {
  let notifId

  it('returns empty list for a new user', async () => {
    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200)
    expect(res.body.notifications).toEqual([])
    expect(res.body.unreadCount).toBe(0)
  })

  it('creates a notification and it appears in the list', async () => {
    const notif = await prisma.notification.create({
      data: { userId: member.id, title: 'Hello', body: 'Test notification body' },
    })
    notifId = notif.id

    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200)
    expect(res.body.notifications).toHaveLength(1)
    expect(res.body.notifications[0].title).toBe('Hello')
    expect(res.body.unreadCount).toBe(1)
  })

  it('markRead sets readAt and decrements unreadCount', async () => {
    await request(app)
      .post(`/api/notifications/${notifId}/read`)
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200)

    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200)
    expect(res.body.unreadCount).toBe(0)
    expect(res.body.notifications[0].readAt).toBeTruthy()
  })

  it('cannot mark another user\'s notification as read', async () => {
    await request(app)
      .post(`/api/notifications/${notifId}/read`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(403)
  })

  it('markAllRead clears all unread', async () => {
    await prisma.notification.createMany({
      data: [
        { userId: member.id, title: 'N1', body: 'body 1' },
        { userId: member.id, title: 'N2', body: 'body 2' },
      ],
    })

    await request(app)
      .post('/api/notifications/read-all')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200)

    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200)
    expect(res.body.unreadCount).toBe(0)
  })

  it('other user\'s notifications are not visible to member', async () => {
    await prisma.notification.create({ data: { userId: other.id, title: 'Other', body: 'Other body' } })

    const res = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${memberToken}`)
      .expect(200)
    const ids = res.body.notifications.map(n => n.userId)
    expect(ids.every(id => id === member.id)).toBe(true)
  })

  it('requires authentication', async () => {
    await request(app).get('/api/notifications').expect(401)
  })

  it('approve member triggers a notification', async () => {
    const pending = await createTestUser({ email: testEmail('notif-pending'), role: 'PENDING' })
    await prisma.user.update({ where: { id: pending.id }, data: { otpVerifiedAt: new Date() } })

    await request(app)
      .post(`/api/auth/approve/${pending.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200)

    const notifs = await prisma.notification.findMany({ where: { userId: pending.id } })
    expect(notifs).toHaveLength(1)
    expect(notifs[0].title).toBe('Account Approved')

    await prisma.notification.deleteMany({ where: { userId: pending.id } })
    await cleanup(pending.email)
  })
})
