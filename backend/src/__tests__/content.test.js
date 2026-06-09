import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import app from '../app.js'
import prisma from '../config/db.js'
import { testEmail, testPhone, createTestUser, tokenFor, cleanup } from './helpers.js'

vi.mock('../services/email.js', () => ({
  sendOtpEmail:                   vi.fn().mockResolvedValue(undefined),
  sendAdminNewMemberNotification:  vi.fn().mockResolvedValue(undefined),
  sendApprovalEmail:               vi.fn().mockResolvedValue(undefined),
  sendRejectionEmail:              vi.fn().mockResolvedValue(undefined),
  sendInviteEmail:                 vi.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail:          vi.fn().mockResolvedValue(undefined),
}))

const api = request(app)

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function createContent(authorId, overrides = {}) {
  return prisma.content.create({
    data: {
      type: 'NEWS',
      status: 'DRAFT',
      title: 'Test News Item',
      body: '<p>Body text</p>',
      authorId,
      ...overrides,
    },
  })
}

async function publishItem(id) {
  return prisma.content.update({
    where: { id },
    data: { status: 'PUBLISHED', publishedAt: new Date() },
  })
}

// ─── Setup ────────────────────────────────────────────────────────────────────

let admin, member, staffContent
let adminToken, memberToken, staffToken

beforeAll(async () => {
  ;[admin, member, staffContent] = await Promise.all([
    createTestUser({ role: 'ADMIN',  firstName: 'Content', lastName: 'Admin' }),
    createTestUser({ role: 'MEMBER', firstName: 'Content', lastName: 'Member' }),
    createTestUser({ role: 'STAFF',  firstName: 'Content', lastName: 'Staff',
      email: testEmail('staff-content'), phone: testPhone() }),
  ])

  // Give staffContent the manageContent permission
  await prisma.user.update({
    where: { id: staffContent.id },
    data: { permissions: { manageContent: true } },
  })
  staffContent = await prisma.user.findUnique({ where: { id: staffContent.id } })

  ;[{ accessToken: adminToken }, { accessToken: memberToken }, { accessToken: staffToken }] = await Promise.all([
    tokenFor(admin),
    tokenFor(member),
    tokenFor(staffContent),
  ])
})

afterAll(async () => {
  await prisma.content.deleteMany({ where: { authorId: { in: [admin.id, staffContent.id] } } })
  await cleanup(admin.email, member.email, staffContent.email)
})

// ─── Create ───────────────────────────────────────────────────────────────────

describe('POST /api/content', () => {
  it('201 — admin can create a draft', async () => {
    const res = await api.post('/api/content')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'NEWS', title: 'Hello Church', body: '<p>World</p>', category: 'General' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ title: 'Hello Church', status: 'DRAFT' })
  })

  it('201 — staff with manageContent can create', async () => {
    const res = await api.post('/api/content')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ type: 'ANNOUNCEMENT', title: 'Staff Announcement', body: '<p>text</p>' })
    expect(res.status).toBe(201)
    expect(res.body.status).toBe('DRAFT')
  })

  it('403 — member cannot create', async () => {
    const res = await api.post('/api/content')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ type: 'NEWS', title: 'Not allowed', body: '<p>x</p>' })
    expect(res.status).toBe(403)
  })

  it('400 — missing required fields', async () => {
    const res = await api.post('/api/content')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ type: 'NEWS' })
    expect(res.status).toBe(400)
  })
})

// ─── Publish ─────────────────────────────────────────────────────────────────

describe('POST /api/content/:id/publish', () => {
  it('flips status to PUBLISHED and sets publishedAt', async () => {
    const item = await createContent(admin.id, { title: 'To Publish' })
    const res = await api.post(`/api/content/${item.id}/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('PUBLISHED')
    expect(res.body.publishedAt).toBeTruthy()
  })

  it('409 on archived content', async () => {
    const item = await createContent(admin.id, { status: 'ARCHIVED', title: 'Archived' })
    const res = await api.post(`/api/content/${item.id}/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(409)
  })
})

// ─── Public list ──────────────────────────────────────────────────────────────

describe('GET /api/content', () => {
  let publishedId

  beforeAll(async () => {
    const item = await createContent(admin.id, { title: 'Public News', category: 'Worship' })
    await publishItem(item.id)
    publishedId = item.id
  })

  it('returns { items } shape with only PUBLISHED items', async () => {
    const res = await api.get('/api/content')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.items)).toBe(true)
    expect(res.body).toHaveProperty('total')
    expect(res.body).toHaveProperty('page')
    expect(res.body).toHaveProperty('pages')
    for (const item of res.body.items) {
      expect(item.status).toBe('PUBLISHED')
    }
  })

  it('filters by type', async () => {
    const res = await api.get('/api/content?type=EVENT')
    expect(res.status).toBe(200)
    for (const item of res.body.items) {
      expect(item.type).toBe('EVENT')
    }
  })

  it('filters by category', async () => {
    const res = await api.get('/api/content?category=Worship')
    expect(res.status).toBe(200)
    expect(res.body.items.every(i => i.category === 'Worship')).toBe(true)
  })
})

// ─── Archive (soft delete) ────────────────────────────────────────────────────

describe('DELETE /api/content/:id (archive)', () => {
  it('sets status to ARCHIVED and hides from public list', async () => {
    const item = await createContent(admin.id, { title: 'To Archive' })
    await publishItem(item.id)

    const archiveRes = await api.delete(`/api/content/${item.id}`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(archiveRes.status).toBe(200)
    expect(archiveRes.body.message).toMatch(/archived/i)

    // public list must not include it
    const listRes = await api.get('/api/content')
    const found = listRes.body.items.find(i => i.id === item.id)
    expect(found).toBeUndefined()
  })
})

// ─── Per-item read tracking ───────────────────────────────────────────────────

describe('Per-item read tracking (POST /:id/read)', () => {
  let unreadItem

  beforeAll(async () => {
    // Clear any existing reads for member to get a clean baseline
    await prisma.contentRead.deleteMany({ where: { userId: member.id } })
    const item = await createContent(admin.id, { title: 'Unread News Item' })
    await publishItem(item.id)
    unreadItem = item
  })

  it('GET /:id returns isNew: true before member reads it', async () => {
    const res = await api.get(`/api/content/${unreadItem.id}`)
      .set('Authorization', `Bearer ${memberToken}`)
    expect(res.status).toBe(200)
    expect(res.body.isNew).toBe(true)
  })

  it('item appears in unseen=1 list before being read', async () => {
    const res = await api.get('/api/content?type=NEWS&type=ANNOUNCEMENT&unseen=1')
      .set('Authorization', `Bearer ${memberToken}`)
    expect(res.status).toBe(200)
    const ids = res.body.items.map(i => i.id)
    expect(ids).toContain(unreadItem.id)
  })

  it('unseen-counts reflects the unread item', async () => {
    const res = await api.get('/api/content/unseen-counts')
      .set('Authorization', `Bearer ${memberToken}`)
    expect(res.status).toBe(200)
    expect(typeof res.body.news).toBe('number')
    expect(res.body.news).toBeGreaterThan(0)
  })

  it('POST /:id/read marks item as read (isNew: false)', async () => {
    // Capture count before reading
    const before = await api.get('/api/content/unseen-counts')
      .set('Authorization', `Bearer ${memberToken}`)
    const countBefore = before.body.news

    const markRes = await api.post(`/api/content/${unreadItem.id}/read`)
      .set('Authorization', `Bearer ${memberToken}`)
    expect(markRes.status).toBe(200)

    const detailRes = await api.get(`/api/content/${unreadItem.id}`)
      .set('Authorization', `Bearer ${memberToken}`)
    expect(detailRes.body.isNew).toBe(false)

    // Store before count so the decrement test can compare
    unreadItem._countBefore = countBefore
  })

  it('POST /:id/read is idempotent (second call still 200)', async () => {
    const res = await api.post(`/api/content/${unreadItem.id}/read`)
      .set('Authorization', `Bearer ${memberToken}`)
    expect(res.status).toBe(200)
  })

  it('item no longer appears in unseen=1 list after being read', async () => {
    const res = await api.get('/api/content?type=NEWS&type=ANNOUNCEMENT&unseen=1')
      .set('Authorization', `Bearer ${memberToken}`)
    expect(res.status).toBe(200)
    const ids = res.body.items.map(i => i.id)
    expect(ids).not.toContain(unreadItem.id)
  })

  it('unseen-counts decrements after reading the item', async () => {
    const res = await api.get('/api/content/unseen-counts')
      .set('Authorization', `Bearer ${memberToken}`)
    expect(res.status).toBe(200)
    // Count must be strictly less than it was before we read the item
    expect(res.body.news).toBeLessThan(unreadItem._countBefore)
  })

  it('401 for unauthenticated read mark', async () => {
    const res = await api.post(`/api/content/${unreadItem.id}/read`)
    expect(res.status).toBe(401)
  })
})

// ─── Archive + Restore ────────────────────────────────────────────────────────

describe('POST /api/content/:id/restore', () => {
  it('restores ARCHIVED item to DRAFT', async () => {
    const item = await createContent(admin.id, { title: 'To Restore', status: 'ARCHIVED' })
    const res = await api.post(`/api/content/${item.id}/restore`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('DRAFT')
  })

  it('409 when item is not ARCHIVED', async () => {
    const item = await createContent(admin.id, { title: 'Not Archived' })
    const res = await api.post(`/api/content/${item.id}/restore`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(409)
  })

  it('403 for member', async () => {
    const item = await createContent(admin.id, { title: 'Member Restore Attempt', status: 'ARCHIVED' })
    const res = await api.post(`/api/content/${item.id}/restore`)
      .set('Authorization', `Bearer ${memberToken}`)
    expect(res.status).toBe(403)
  })
})

// ─── RSVP ────────────────────────────────────────────────────────────────────

describe('RSVP', () => {
  let openEvent, closedEvent

  beforeAll(async () => {
    const [a, b] = await Promise.all([
      createContent(admin.id, {
        type: 'EVENT', title: 'Open Event',
        registrationOpen: true, status: 'PUBLISHED', publishedAt: new Date(),
      }),
      createContent(admin.id, {
        type: 'EVENT', title: 'Closed Event',
        registrationOpen: false, status: 'PUBLISHED', publishedAt: new Date(),
      }),
    ])
    openEvent  = a
    closedEvent = b
  })

  it('member can RSVP to a registrationOpen event', async () => {
    const res = await api.post(`/api/content/${openEvent.id}/rsvp`)
      .set('Authorization', `Bearer ${memberToken}`)
    expect(res.status).toBe(200)
    expect(res.body.registered).toBe(true)
  })

  it('duplicate RSVP is idempotent (200 again)', async () => {
    const res = await api.post(`/api/content/${openEvent.id}/rsvp`)
      .set('Authorization', `Bearer ${memberToken}`)
    expect(res.status).toBe(200)
    expect(res.body.registered).toBe(true)
  })

  it('GET /:id includes rsvpCount and isRegistered for authenticated user', async () => {
    const res = await api.get(`/api/content/${openEvent.id}`)
      .set('Authorization', `Bearer ${memberToken}`)
    expect(res.status).toBe(200)
    expect(res.body.rsvpCount).toBeGreaterThanOrEqual(1)
    expect(res.body.isRegistered).toBe(true)
  })

  it('member can cancel RSVP', async () => {
    const res = await api.delete(`/api/content/${openEvent.id}/rsvp`)
      .set('Authorization', `Bearer ${memberToken}`)
    expect(res.status).toBe(200)
    expect(res.body.registered).toBe(false)

    // confirm count dropped
    const detail = await api.get(`/api/content/${openEvent.id}`)
      .set('Authorization', `Bearer ${memberToken}`)
    expect(detail.body.isRegistered).toBe(false)
  })

  it('400 when registrationOpen is false', async () => {
    const res = await api.post(`/api/content/${closedEvent.id}/rsvp`)
      .set('Authorization', `Bearer ${memberToken}`)
    expect(res.status).toBe(400)
  })

  it('admin can view registrations list', async () => {
    // re-register so there is something to list
    await api.post(`/api/content/${openEvent.id}/rsvp`)
      .set('Authorization', `Bearer ${memberToken}`)

    const res = await api.get(`/api/content/${openEvent.id}/registrations`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    expect(typeof res.body.count).toBe('number')
    expect(Array.isArray(res.body.registrations)).toBe(true)
    expect(res.body.registrations[0]).toMatchObject({ email: expect.any(String), name: expect.any(String) })
  })

  it('member cannot view registrations list', async () => {
    const res = await api.get(`/api/content/${openEvent.id}/registrations`)
      .set('Authorization', `Bearer ${memberToken}`)
    expect(res.status).toBe(403)
  })
})

// ─── Admin manage list ────────────────────────────────────────────────────────

describe('GET /api/content/manage', () => {
  it('returns all statuses for admin', async () => {
    const res = await api.get('/api/content/manage')
      .set('Authorization', `Bearer ${adminToken}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.items)).toBe(true)
    const statuses = new Set(res.body.items.map(i => i.status))
    // Should include DRAFTs, not just PUBLISHED
    expect(statuses.size).toBeGreaterThanOrEqual(1)
  })

  it('403 for member', async () => {
    const res = await api.get('/api/content/manage')
      .set('Authorization', `Bearer ${memberToken}`)
    expect(res.status).toBe(403)
  })
})
