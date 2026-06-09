import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import app from '../app.js'
import { testEmail, testPhone, createTestUser, tokenFor, getLatestOtp, cleanup, TEST_PASSWORD } from './helpers.js'

vi.mock('../services/email.js', () => ({
  sendOtpEmail:                   vi.fn().mockResolvedValue(undefined),
  sendAdminNewMemberNotification:  vi.fn().mockResolvedValue(undefined),
  sendApprovalEmail:               vi.fn().mockResolvedValue(undefined),
  sendRejectionEmail:              vi.fn().mockResolvedValue(undefined),
  sendInviteEmail:                 vi.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail:          vi.fn().mockResolvedValue(undefined),
}))

const api = request(app)

// ── Auth happy path ───────────────────────────────────────────────────────────

describe('auth happy path', () => {
  let email, phone, userId, accessToken, refreshToken

  beforeAll(() => {
    email = testEmail('happypath')
    phone = testPhone()
  })

  afterAll(() => cleanup(email))

  it('POST /api/auth/register — 201 with userId', async () => {
    const res = await api.post('/api/auth/register').send({
      firstName: 'Happy', lastName: 'Path',
      email, phone, password: TEST_PASSWORD,
    })
    expect(res.status).toBe(201)
    expect(res.body).toHaveProperty('userId')
    userId = res.body.userId
  })

  it('POST /api/auth/register — 409 on duplicate email', async () => {
    const res = await api.post('/api/auth/register').send({
      firstName: 'Dup', lastName: 'User',
      email, phone: testPhone(), password: TEST_PASSWORD,
    })
    expect(res.status).toBe(409)
  })

  it('POST /api/auth/register — 400 on missing required field', async () => {
    const res = await api.post('/api/auth/register').send({ email: testEmail('bad') })
    expect(res.status).toBe(400)
  })

  it('POST /api/auth/verify-otp — 400 on wrong code', async () => {
    const res = await api.post('/api/auth/verify-otp').send({ userId, code: '000000' })
    expect(res.status).toBe(400)
  })

  it('POST /api/auth/verify-otp — 200 on correct code', async () => {
    const code = await getLatestOtp(userId)
    expect(code).toBeTruthy()
    const res = await api.post('/api/auth/verify-otp').send({ userId, code })
    expect(res.status).toBe(200)
    expect(res.body.message).toMatch(/pending/i)
  })

  it('POST /api/auth/login — 403 while still PENDING', async () => {
    const res = await api.post('/api/auth/login').send({ identifier: email, password: TEST_PASSWORD })
    expect(res.status).toBe(403)
  })

  it('POST /api/auth/login — 200 with tokens after admin approves', async () => {
    // Promote via DB helper (avoids needing another admin account here)
    const { PrismaClient } = await import('@prisma/client')
    const prisma = new PrismaClient()
    await prisma.user.update({ where: { id: userId }, data: { role: 'MEMBER' } })
    await prisma.$disconnect()

    const res = await api.post('/api/auth/login').send({ identifier: email, password: TEST_PASSWORD })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('accessToken')
    expect(res.body).toHaveProperty('refreshToken')
    accessToken  = res.body.accessToken
    refreshToken = res.body.refreshToken
  })

  it('POST /api/auth/login — 401 on wrong password', async () => {
    const res = await api.post('/api/auth/login').send({ identifier: email, password: 'WrongPass1!' })
    expect(res.status).toBe(401)
  })

  it('POST /api/auth/refresh — 200 returns new tokens', async () => {
    const res = await api.post('/api/auth/refresh').send({ refreshToken })
    expect(res.status).toBe(200)
    expect(res.body).toHaveProperty('accessToken')
    refreshToken = res.body.refreshToken
  })

  it('POST /api/auth/refresh — 401 for invalid token', async () => {
    const res = await api.post('/api/auth/refresh').send({ refreshToken: 'not-a-real-token' })
    expect(res.status).toBe(401)
  })

  it('POST /api/auth/logout — 200', async () => {
    const res = await api.post('/api/auth/logout').send({ refreshToken })
    expect(res.status).toBe(200)
  })
})

// ── Invite flow ───────────────────────────────────────────────────────────────

describe('invite flow', () => {
  let admin, inviteToken, registeredEmail, registeredUserId

  beforeAll(async () => {
    admin = await createTestUser({ role: 'ADMIN', firstName: 'Invite', lastName: 'Admin' })
    registeredEmail = testEmail('invited')
  })

  afterAll(() => cleanup(admin.email, registeredEmail))

  it('POST /api/auth/invites — admin creates individual invite', async () => {
    const { accessToken } = await tokenFor(admin)
    const res = await api
      .post('/api/auth/invites')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ type: 'INDIVIDUAL', targetEmail: registeredEmail, expiresInMinutes: 1440 })
    expect(res.status).toBe(201)
    expect(res.body).toHaveProperty('token')
    inviteToken = res.body.token
  })

  it('GET /api/auth/invites/:token — validates correctly', async () => {
    const res = await api.get(`/api/auth/invites/${inviteToken}`)
    expect(res.status).toBe(200)
    expect(res.body.type).toBe('INDIVIDUAL')
    expect(res.body.targetEmail).toBe(registeredEmail)
  })

  it('POST /api/auth/register — registers with invite token', async () => {
    const res = await api.post('/api/auth/register').send({
      firstName: 'Invited', lastName: 'User',
      email: registeredEmail, phone: testPhone(),
      password: TEST_PASSWORD,
      inviteToken,
    })
    expect(res.status).toBe(201)
    registeredUserId = res.body.userId
  })

  it('POST /api/auth/verify-otp — auto-approves on individual invite', async () => {
    const code = await getLatestOtp(registeredUserId)
    const res = await api.post('/api/auth/verify-otp').send({ userId: registeredUserId, code })
    expect(res.status).toBe(200)
    expect(res.body.autoApproved).toBe(true)
  })

  it('POST /api/auth/login — invited user can log in immediately', async () => {
    const res = await api.post('/api/auth/login').send({ identifier: registeredEmail, password: TEST_PASSWORD })
    expect(res.status).toBe(200)
    expect(res.body.role).toBe('MEMBER')
  })

  it('GET /api/auth/invites/:token — 410 after invite is used', async () => {
    const res = await api.get(`/api/auth/invites/${inviteToken}`)
    expect(res.status).toBe(410)
  })
})

// ── Invite revoke ─────────────────────────────────────────────────────────────

describe('invite revoke', () => {
  let admin, inviteId, inviteToken

  beforeAll(async () => {
    admin = await createTestUser({ role: 'ADMIN', firstName: 'Revoke', lastName: 'Admin' })
  })

  afterAll(() => cleanup(admin.email))

  it('DELETE /api/auth/invites/:id — revokes an unused invite', async () => {
    const { accessToken } = await tokenFor(admin)
    // Create invite first
    const create = await api
      .post('/api/auth/invites')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ type: 'MASS', expiresInMinutes: 1440 })
    expect(create.status).toBe(201)
    inviteToken = create.body.token
    // Look up the id from the list
    const list = await api
      .get('/api/auth/invites')
      .set('Authorization', `Bearer ${accessToken}`)
    inviteId = list.body.invites.find(i => i.token === inviteToken)?.id
    expect(inviteId).toBeTruthy()

    const del = await api
      .delete(`/api/auth/invites/${inviteId}`)
      .set('Authorization', `Bearer ${accessToken}`)
    expect(del.status).toBe(200)
  })

  it('GET /api/auth/invites/:token — 404 after deletion', async () => {
    const res = await api.get(`/api/auth/invites/${inviteToken}`)
    expect(res.status).toBe(404)
  })
})
