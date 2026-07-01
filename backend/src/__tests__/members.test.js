import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import app from '../app.js'
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

// ── Promote guards ────────────────────────────────────────────────────────────

describe('POST /api/members/:id/promote — role guards', () => {
  let superAdmin, admin, member, legend
  let superAdminToken, adminToken

  beforeAll(async () => {
    ;[superAdmin, admin, member, legend] = await Promise.all([
      createTestUser({ role: 'SUPER_ADMIN', firstName: 'Super', lastName: 'Admin' }),
      createTestUser({ role: 'ADMIN',       firstName: 'Test',  lastName: 'Admin' }),
      createTestUser({ role: 'MEMBER',      firstName: 'Test',  lastName: 'Member' }),
      createTestUser({ role: 'LEGEND',      firstName: 'Dev',   lastName: 'Legend' }),
    ])
    ;[{ accessToken: superAdminToken }, { accessToken: adminToken }] = await Promise.all([
      tokenFor(superAdmin),
      tokenFor(admin),
    ])
  })

  afterAll(() => cleanup(superAdmin.email, admin.email, member.email, legend.email))

  it('ADMIN can promote MEMBER to STAFF', async () => {
    const res = await api
      .post(`/api/members/${member.id}/promote`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'STAFF', permissions: { manageMembers: true } })
    expect(res.status).toBe(200)
    // Reset for subsequent tests
    await api
      .post(`/api/members/${member.id}/promote`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ role: 'MEMBER' })
  })

  it('ADMIN cannot promote to ADMIN', async () => {
    const res = await api
      .post(`/api/members/${member.id}/promote`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'ADMIN' })
    expect(res.status).toBe(403)
  })

  it('ADMIN cannot promote to SUPER_ADMIN', async () => {
    const res = await api
      .post(`/api/members/${member.id}/promote`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'SUPER_ADMIN' })
    expect(res.status).toBe(403)
  })

  it('cannot promote self', async () => {
    // ADMIN hits the "can't modify same-level account" check (403) before the self check.
    // Use SUPER_ADMIN token to reach the self-promotion guard (400).
    const res = await api
      .post(`/api/members/${superAdmin.id}/promote`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ role: 'MEMBER' })
    expect(res.status).toBe(400)
  })

  it('cannot promote a LEGEND account', async () => {
    const res = await api
      .post(`/api/members/${legend.id}/promote`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'MEMBER' })
    expect(res.status).toBe(403)
  })

  it('returns 400 for an invalid role', async () => {
    const res = await api
      .post(`/api/members/${member.id}/promote`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'PASTOR' })
    expect(res.status).toBe(400)
  })

  it('SUPER_ADMIN can promote member to ADMIN', async () => {
    const res = await api
      .post(`/api/members/${member.id}/promote`)
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({ role: 'ADMIN' })
    expect(res.status).toBe(200)
  })

  it('requires authentication', async () => {
    const res = await api
      .post(`/api/members/${member.id}/promote`)
      .send({ role: 'MEMBER' })
    expect(res.status).toBe(401)
  })
})

// ── Promote / deactivate revoke outstanding refresh tokens ─────────────────────

describe('role changes revoke outstanding refresh tokens', () => {
  let admin, adminToken

  beforeAll(async () => {
    admin = await createTestUser({ role: 'ADMIN', firstName: 'Revoke', lastName: 'Admin' })
    ;({ accessToken: adminToken } = await tokenFor(admin))
  })

  afterAll(() => cleanup(admin.email))

  it('promoting a member invalidates their existing refresh token', async () => {
    const member = await createTestUser({ role: 'MEMBER', firstName: 'Stale', lastName: 'Role' })
    const { refreshToken } = await tokenFor(member)

    const promoteRes = await api
      .post(`/api/members/${member.id}/promote`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'STAFF', permissions: {} })
    expect(promoteRes.status).toBe(200)

    const refreshRes = await api.post('/api/auth/refresh').send({ refreshToken })
    expect(refreshRes.status).toBe(401)

    await cleanup(member.email)
  })

  it('deactivating a member invalidates their existing refresh token', async () => {
    const member = await createTestUser({ role: 'MEMBER', firstName: 'Locked', lastName: 'Out' })
    const { refreshToken } = await tokenFor(member)

    const deactivateRes = await api
      .post(`/api/members/${member.id}/deactivate`)
      .set('Authorization', `Bearer ${adminToken}`)
    expect(deactivateRes.status).toBe(200)

    const refreshRes = await api.post('/api/auth/refresh').send({ refreshToken })
    expect(refreshRes.status).toBe(401)

    await cleanup(member.email)
  })
})

// ── Profile update requests — field whitelist ───────────────────────────────────

describe('POST /api/members/me/request-update — field whitelist', () => {
  let member, memberToken

  beforeAll(async () => {
    member = await createTestUser({ role: 'MEMBER', firstName: 'Update', lastName: 'Requester' })
    ;({ accessToken: memberToken } = await tokenFor(member))
  })

  afterAll(() => cleanup(member.email))

  it('rejects a request for a non-whitelisted field', async () => {
    const res = await api
      .post('/api/members/me/request-update')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ field: 'membershipStatus', proposedValue: 'ACTIVE', reason: 'please' })
    expect(res.status).toBe(400)
  })

  it('accepts a request for a whitelisted field', async () => {
    const res = await api
      .post('/api/members/me/request-update')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ field: 'phone', proposedValue: '+254700000000', reason: 'new number' })
    expect(res.status).toBe(201)
  })
})

// ── Admin direct-create member ────────────────────────────────────────────────

describe('POST /api/members — admin direct-create', () => {
  let admin, createdEmail
  let adminToken

  beforeAll(async () => {
    admin = await createTestUser({ role: 'ADMIN', firstName: 'Creator', lastName: 'Admin' })
    ;({ accessToken: adminToken } = await tokenFor(admin))
    createdEmail = testEmail('directcreate')
  })

  afterAll(() => cleanup(admin.email, createdEmail))

  it('201 — creates member and returns id + email', async () => {
    const res = await api
      .post('/api/members')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ firstName: 'Direct', lastName: 'Create', email: createdEmail, phone: testPhone() })
    expect(res.status).toBe(201)
    expect(res.body).toHaveProperty('id')
    expect(res.body.email).toBe(createdEmail)
  })

  it('409 — duplicate email', async () => {
    const res = await api
      .post('/api/members')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ firstName: 'Dup', lastName: 'User', email: createdEmail })
    expect(res.status).toBe(409)
  })

  it('403 — MEMBER cannot create members', async () => {
    const member = await createTestUser({ role: 'MEMBER' })
    const { accessToken } = await tokenFor(member)
    const res = await api
      .post('/api/members')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ firstName: 'X', lastName: 'Y', email: testEmail('unauth') })
    expect(res.status).toBe(403)
    await cleanup(member.email)
  })
})
