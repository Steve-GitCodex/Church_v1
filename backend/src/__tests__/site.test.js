import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import app from '../app.js'
import prisma from '../config/db.js'
import { createTestUser, tokenFor, cleanup } from './helpers.js'

let adminToken, memberToken
let adminEmail, memberEmail
let _savedAbout  // original row value (if any) — restored in afterAll
let _superAdminEmail

beforeAll(async () => {
  // Preserve any live 'about' data so tests don't wipe it
  const existing = await prisma.siteSetting.findUnique({ where: { key: 'about' } })
  _savedAbout = existing?.value ?? null
  await prisma.siteSetting.deleteMany({ where: { key: 'about' } })

  const admin  = await createTestUser({ role: 'ADMIN' })
  const member = await createTestUser({ role: 'MEMBER' })
  adminEmail  = admin.email
  memberEmail = member.email
  adminToken  = (await tokenFor(admin)).accessToken
  memberToken = (await tokenFor(member)).accessToken
})

afterAll(async () => {
  // Remove test-written row, then restore original if there was one
  await prisma.siteSetting.deleteMany({ where: { key: 'about' } })
  if (_savedAbout !== null) {
    await prisma.siteSetting.create({ data: { key: 'about', value: _savedAbout } })
  }
  await cleanup(adminEmail, memberEmail)
})

describe('GET /api/site/about', () => {
  it('returns defaults when nothing is stored', async () => {
    const res = await request(app).get('/api/site/about').expect(200)
    expect(res.body).toHaveProperty('hero')
    expect(res.body).toHaveProperty('mission')
    expect(res.body).toHaveProperty('serviceTimes')
    expect(Array.isArray(res.body.serviceTimes)).toBe(true)
  })
})

describe('PUT /api/site/about', () => {
  const payload = {
    hero: { heading: 'Test Heading', subheading: 'Test sub' },
    mission: 'Test mission',
    vision: 'Test vision',
    story: 'Test story',
    beliefs: ['Belief one', 'Belief two'],
    leaders: [{ name: 'Pastor Test', role: 'Lead Pastor', imageUrl: '' }],
    serviceTimes: [{ day: 'Sunday', time: '10:00 AM', label: 'Morning Service' }],
    location: { address: 'Test Addr', phone: '', email: '', mapEmbed: '' },
  }

  it('returns 401 without a token', async () => {
    await request(app).put('/api/site/about').send(payload).expect(401)
  })

  it('returns 403 for a MEMBER', async () => {
    await request(app)
      .put('/api/site/about')
      .set('Authorization', `Bearer ${memberToken}`)
      .send(payload)
      .expect(403)
  })

  it('saves the document as ADMIN and GET returns it', async () => {
    await request(app)
      .put('/api/site/about')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(payload)
      .expect(200)

    const res = await request(app).get('/api/site/about').expect(200)
    expect(res.body.hero.heading).toBe('Test Heading')
    expect(res.body.mission).toBe('Test mission')
    expect(res.body.beliefs).toHaveLength(2)
    expect(res.body.leaders[0].name).toBe('Pastor Test')
    expect(res.body.serviceTimes[0].day).toBe('Sunday')
  })

  it('returns 400 for invalid payload (missing hero heading)', async () => {
    await request(app)
      .put('/api/site/about')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ...payload, hero: { heading: '', subheading: '' } })
      .expect(400)
  })
})

describe('GET/PUT /api/site/security-review-schedule', () => {
  let superAdminToken

  beforeAll(async () => {
    const superAdmin = await createTestUser({ role: 'SUPER_ADMIN' })
    superAdminToken = (await tokenFor(superAdmin)).accessToken
    _superAdminEmail = superAdmin.email
  })

  afterAll(async () => {
    await prisma.siteSetting.deleteMany({ where: { key: 'security_review_schedule' } })
    await cleanup(_superAdminEmail)
  })

  it('returns 401 without a token', async () => {
    await request(app).get('/api/site/security-review-schedule').expect(401)
  })

  it('returns 403 for an ADMIN (SUPER_ADMIN only)', async () => {
    await request(app)
      .get('/api/site/security-review-schedule')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(403)
  })

  it('GET returns defaults when nothing is stored', async () => {
    const res = await request(app)
      .get('/api/site/security-review-schedule')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(200)
    expect(res.body).toEqual({ enabled: true, dayOfMonth: 1, hour: 8 })
  })

  it('PUT saves the schedule as SUPER_ADMIN and GET returns it', async () => {
    await request(app)
      .put('/api/site/security-review-schedule')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ enabled: false, dayOfMonth: 15, hour: 3 })
      .expect(200)

    const res = await request(app)
      .get('/api/site/security-review-schedule')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .expect(200)
    expect(res.body).toEqual({ enabled: false, dayOfMonth: 15, hour: 3 })
  })

  it('returns 400 for an out-of-range dayOfMonth', async () => {
    await request(app)
      .put('/api/site/security-review-schedule')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ enabled: true, dayOfMonth: 31, hour: 8 })
      .expect(400)
  })

  describe('POST /api/site/security-review/run-now', () => {
    it('returns 401 without a token', async () => {
      await request(app).post('/api/site/security-review/run-now').expect(401)
    })

    it('returns 403 for an ADMIN (SUPER_ADMIN only)', async () => {
      await request(app)
        .post('/api/site/security-review/run-now')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(403)
    })

    it('sends immediately to a specific Super Admin as SUPER_ADMIN', async () => {
      const res = await request(app)
        .post('/api/site/security-review/run-now')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ to: _superAdminEmail })
        .expect(200)
      expect(res.body).toEqual({ sent: true })
    })

    it('returns 400 when the recipient is not an active Super Admin', async () => {
      await request(app)
        .post('/api/site/security-review/run-now')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ to: memberEmail })
        .expect(400)
    })
  })
})
