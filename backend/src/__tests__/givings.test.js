import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import app from '../app.js'
import prisma from '../config/db.js'
import { testEmail, testPhone, createTestUser, tokenFor, cleanup } from './helpers.js'

vi.mock('../services/email.js', () => ({
  sendOtpEmail:                   vi.fn().mockResolvedValue(undefined),
  sendAdminNewMemberNotification: vi.fn().mockResolvedValue(undefined),
  sendApprovalEmail:              vi.fn().mockResolvedValue(undefined),
  sendRejectionEmail:             vi.fn().mockResolvedValue(undefined),
  sendInviteEmail:                vi.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail:         vi.fn().mockResolvedValue(undefined),
}))

const api = request(app)

// ─── Setup ──────────────────────────────────────────────────────────────────

let superAdmin, staffGivings, member
let superToken, staffToken, memberToken
let project
let priorFeatureSetting   // null = row was absent
const createdProjectIds = []

// Record a giving through the API (always recorded by a test user so cleanup
// can find them via recordedById) and return the response body.
async function recordGiving(overrides = {}, token = staffToken) {
  const res = await api.post('/api/givings')
    .set('Authorization', `Bearer ${token}`)
    .send({ projectId: project.id, amount: 1000, paymentMethod: 'CASH', ...overrides })
  return res
}

beforeAll(async () => {
  // The givings feature is gated by a site setting; ensure it's on for the run,
  // remembering the prior value so afterAll can restore it.
  priorFeatureSetting = await prisma.siteSetting.findUnique({ where: { key: 'givings_enabled' } })
  await prisma.siteSetting.upsert({
    where:  { key: 'givings_enabled' },
    update: { value: true },
    create: { key: 'givings_enabled', value: true },
  })

  ;[superAdmin, staffGivings, member] = await Promise.all([
    createTestUser({ role: 'SUPER_ADMIN', firstName: 'Giving', lastName: 'Super' }),
    createTestUser({ role: 'STAFF', firstName: 'Giving', lastName: 'Staff',
      email: testEmail('staff-givings'), phone: testPhone() }),
    createTestUser({ role: 'MEMBER', firstName: 'Giving', lastName: 'Member' }),
  ])

  await prisma.user.update({
    where: { id: staffGivings.id },
    data: { permissions: { manageGivings: true } },
  })
  staffGivings = await prisma.user.findUnique({ where: { id: staffGivings.id } })

  ;[{ accessToken: superToken }, { accessToken: staffToken }, { accessToken: memberToken }] =
    await Promise.all([tokenFor(superAdmin), tokenFor(staffGivings), tokenFor(member)])

  project = await prisma.givingProject.create({
    data: { name: `Test Project ${testPhone()}`, isActive: true },
  })
  createdProjectIds.push(project.id)
})

afterAll(async () => {
  const userIds = [superAdmin.id, staffGivings.id, member.id]
  await prisma.givingUpdateRequest.deleteMany({ where: { requestedById: { in: userIds } } })
  await prisma.giving.deleteMany({ where: { recordedById: { in: userIds } } })
  await prisma.givingProject.deleteMany({ where: { id: { in: createdProjectIds } } })
  await cleanup(superAdmin.email, staffGivings.email, member.email)

  if (priorFeatureSetting) {
    await prisma.siteSetting.update({
      where: { key: 'givings_enabled' },
      data:  { value: priorFeatureSetting.value },
    })
  } else {
    await prisma.siteSetting.delete({ where: { key: 'givings_enabled' } }).catch(() => {})
  }
})

// ─── Projects ─────────────────────────────────────────────────────────────────

describe('Giving projects', () => {
  it('201 — staff with manageGivings creates a project', async () => {
    const name = `Building Fund ${testPhone()}`
    const res = await api.post('/api/givings/projects')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ name, description: 'Sanctuary expansion' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ name, totalRaised: '0.00', givingCount: 0 })
    createdProjectIds.push(res.body.id)
  })

  it('409 — duplicate project name', async () => {
    const res = await api.post('/api/givings/projects')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ name: project.name })
    expect(res.status).toBe(409)
  })

  it('403 — member cannot create a project', async () => {
    const res = await api.post('/api/givings/projects')
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ name: 'Member Project' })
    expect(res.status).toBe(403)
  })

  it('GET /projects returns totalRaised and givingCount', async () => {
    const res = await api.get('/api/givings/projects')
      .set('Authorization', `Bearer ${staffToken}`)
    expect(res.status).toBe(200)
    const found = res.body.find(p => p.id === project.id)
    expect(found).toBeDefined()
    expect(found).toHaveProperty('totalRaised')
    expect(found).toHaveProperty('givingCount')
  })

  it('PATCH /projects/:id/deactivate sets isActive false', async () => {
    const p = await prisma.givingProject.create({ data: { name: `Throwaway ${testPhone()}` } })
    createdProjectIds.push(p.id)
    const res = await api.patch(`/api/givings/projects/${p.id}/deactivate`)
      .set('Authorization', `Bearer ${staffToken}`)
    expect(res.status).toBe(200)
    expect(res.body.isActive).toBe(false)
  })
})

// ─── Record + list ledger ───────────────────────────────────────────────────

describe('Recording givings', () => {
  it('201 — records a member-linked giving', async () => {
    const res = await recordGiving({ memberId: member.profile.id, amount: 2500 })
    expect(res.status).toBe(201)
    expect(parseFloat(res.body.amount)).toBe(2500)
    expect(res.body.memberName).toBe('Giving Member')
  })

  it('400 — unknown project', async () => {
    const res = await api.post('/api/givings')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ projectId: 'does-not-exist', amount: 100 })
    expect(res.status).toBe(400)
  })

  it('400 — non-positive amount', async () => {
    const res = await recordGiving({ amount: -50 })
    expect(res.status).toBe(400)
  })

  it('403 — member cannot record a giving', async () => {
    const res = await recordGiving({}, memberToken)
    expect(res.status).toBe(403)
  })

  it('GET / returns paginated ledger with totalAmount', async () => {
    const res = await api.get('/api/givings')
      .set('Authorization', `Bearer ${staffToken}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.items)).toBe(true)
    expect(res.body).toHaveProperty('total')
    expect(res.body).toHaveProperty('totalAmount')
  })
})

// ─── Anonymous masking ──────────────────────────────────────────────────────

describe('Anonymous giving masking', () => {
  let anonId

  beforeAll(async () => {
    const res = await recordGiving({ memberId: member.profile.id, isAnonymous: true, amount: 5000 })
    anonId = res.body.id
  })

  it('recorder (staff) sees only "Anonymous", no real name', async () => {
    const res = await api.get(`/api/givings/${anonId}`)
      .set('Authorization', `Bearer ${staffToken}`)
    expect(res.status).toBe(200)
    expect(res.body.memberName).toBe('Anonymous')
    expect(res.body.memberNameActual).toBeUndefined()
  })

  it('SUPER_ADMIN sees the real name via memberNameActual', async () => {
    const res = await api.get(`/api/givings/${anonId}`)
      .set('Authorization', `Bearer ${superToken}`)
    expect(res.status).toBe(200)
    expect(res.body.memberName).toBe('Anonymous')
    expect(res.body.memberNameActual).toBe('Giving Member')
  })
})

// ─── Void ───────────────────────────────────────────────────────────────────

describe('Voiding givings', () => {
  it('DELETE /:id voids, and a voided giving is excluded from totals', async () => {
    const before = await api.get('/api/givings').set('Authorization', `Bearer ${staffToken}`)
    const beforeTotal = parseFloat(before.body.totalAmount)

    const created = await recordGiving({ amount: 9999 })
    const voidRes = await api.delete(`/api/givings/${created.body.id}`)
      .set('Authorization', `Bearer ${staffToken}`)
    expect(voidRes.status).toBe(200)
    expect(voidRes.body.voided).toBe(true)

    const after = await api.get('/api/givings').set('Authorization', `Bearer ${staffToken}`)
    // Record then void of 9999 nets out — total must not include it
    expect(parseFloat(after.body.totalAmount)).toBe(beforeTotal)
  })

  it('409 — voiding an already-voided giving', async () => {
    const created = await recordGiving({ amount: 100 })
    await api.delete(`/api/givings/${created.body.id}`).set('Authorization', `Bearer ${staffToken}`)
    const res = await api.delete(`/api/givings/${created.body.id}`)
      .set('Authorization', `Bearer ${staffToken}`)
    expect(res.status).toBe(409)
  })
})

// ─── Update ─────────────────────────────────────────────────────────────────

describe('Editing givings', () => {
  it('PUT /:id updates the amount', async () => {
    const created = await recordGiving({ amount: 100 })
    const res = await api.put(`/api/givings/${created.body.id}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ amount: 750 })
    expect(res.status).toBe(200)
    expect(parseFloat(res.body.amount)).toBe(750)
  })

  it('409 — cannot edit a voided giving', async () => {
    const created = await recordGiving({ amount: 100 })
    await api.delete(`/api/givings/${created.body.id}`).set('Authorization', `Bearer ${staffToken}`)
    const res = await api.put(`/api/givings/${created.body.id}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ amount: 200 })
    expect(res.status).toBe(409)
  })
})

// ─── Member: my givings ─────────────────────────────────────────────────────

describe('GET /api/givings/mine', () => {
  it('returns the member’s own totals and per-project breakdown, excluding voided', async () => {
    const keep = await recordGiving({ memberId: member.profile.id, amount: 1200 })
    const drop = await recordGiving({ memberId: member.profile.id, amount: 8000 })
    await api.delete(`/api/givings/${drop.body.id}`).set('Authorization', `Bearer ${staffToken}`)

    const res = await api.get('/api/givings/mine')
      .set('Authorization', `Bearer ${memberToken}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.items)).toBe(true)
    expect(res.body.items.some(g => g.id === keep.body.id)).toBe(true)
    expect(res.body.items.some(g => g.id === drop.body.id)).toBe(false)
    expect(parseFloat(res.body.totalGiven)).toBeGreaterThanOrEqual(1200)
    expect(Array.isArray(res.body.byProject)).toBe(true)
  })
})

// ─── Receipts (PDF) ─────────────────────────────────────────────────────────

function binaryParser(res, cb) {
  res.setEncoding('binary')
  let data = ''
  res.on('data', chunk => { data += chunk })
  res.on('end', () => cb(null, Buffer.from(data, 'binary')))
}

describe('GET /api/givings/:id/receipt', () => {
  it('manager downloads a PDF receipt for a giving', async () => {
    const created = await recordGiving({ memberId: member.profile.id, amount: 1500 })
    const res = await api.get(`/api/givings/${created.body.id}/receipt`)
      .set('Authorization', `Bearer ${staffToken}`)
      .buffer().parse(binaryParser)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/pdf/)
    expect(res.body.slice(0, 5).toString()).toBe('%PDF-')
  })

  it('409 — cannot issue a receipt for a voided giving', async () => {
    const created = await recordGiving({ amount: 200 })
    await api.delete(`/api/givings/${created.body.id}`).set('Authorization', `Bearer ${staffToken}`)
    const res = await api.get(`/api/givings/${created.body.id}/receipt`)
      .set('Authorization', `Bearer ${staffToken}`)
    expect(res.status).toBe(409)
  })

  it('404 — unknown giving', async () => {
    const res = await api.get('/api/givings/does-not-exist/receipt')
      .set('Authorization', `Bearer ${staffToken}`)
    expect(res.status).toBe(404)
  })

  it('member can download a receipt for their own giving', async () => {
    const created = await recordGiving({ memberId: member.profile.id, amount: 1750 })
    const res = await api.get(`/api/givings/${created.body.id}/receipt`)
      .set('Authorization', `Bearer ${memberToken}`)
      .buffer().parse(binaryParser)
    expect(res.status).toBe(200)
    expect(res.body.slice(0, 5).toString()).toBe('%PDF-')
  })

  it('404 — member cannot download a receipt for a giving that is not theirs', async () => {
    const created = await recordGiving({ amount: 900 }) // memberId null
    const res = await api.get(`/api/givings/${created.body.id}/receipt`)
      .set('Authorization', `Bearer ${memberToken}`)
    expect(res.status).toBe(404)
  })
})

// ─── Reports ────────────────────────────────────────────────────────────────

describe('GET /api/givings/summary', () => {
  it('returns an annual summary for a member with 12-month breakdown', async () => {
    const year = new Date().getUTCFullYear()
    await recordGiving({ memberId: member.profile.id, amount: 400 })

    const res = await api.get(`/api/givings/summary?memberId=${member.profile.id}&year=${year}`)
      .set('Authorization', `Bearer ${staffToken}`)
    expect(res.status).toBe(200)
    expect(res.body.year).toBe(year)
    expect(res.body.byMonth).toHaveLength(12)
    expect(parseFloat(res.body.total)).toBeGreaterThan(0)
    // The giving just recorded lands in the current month
    const thisMonth = res.body.byMonth[new Date().getUTCMonth()]
    expect(parseFloat(thisMonth.total)).toBeGreaterThan(0)
  })

  it('403 — member cannot access summary', async () => {
    const res = await api.get('/api/givings/summary')
      .set('Authorization', `Bearer ${memberToken}`)
    expect(res.status).toBe(403)
  })
})

describe('GET /api/givings/report', () => {
  it('returns a date-range report broken down by project and method', async () => {
    const from = new Date(Date.UTC(2000, 0, 1)).toISOString()
    const to   = new Date(Date.UTC(2100, 0, 1)).toISOString()
    const res = await api.get(`/api/givings/report?from=${from}&to=${to}&projectId=${project.id}`)
      .set('Authorization', `Bearer ${staffToken}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.byProject)).toBe(true)
    expect(Array.isArray(res.body.byMethod)).toBe(true)
    // Scoped to our project, every project row must be that project
    expect(res.body.byProject.every(p => p.projectId === project.id)).toBe(true)
    expect(parseFloat(res.body.total)).toBeGreaterThan(0)
  })

  it('403 — member cannot access report', async () => {
    const res = await api.get('/api/givings/report')
      .set('Authorization', `Bearer ${memberToken}`)
    expect(res.status).toBe(403)
  })
})

// ─── Correction requests ────────────────────────────────────────────────────

describe('Correction requests', () => {
  let ownGivingId

  beforeAll(async () => {
    const res = await recordGiving({ memberId: member.profile.id, amount: 300 })
    ownGivingId = res.body.id
  })

  it('201 — member requests a correction on their own giving', async () => {
    const res = await api.post(`/api/givings/${ownGivingId}/request-update`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ reason: 'Amount was wrong', proposedData: { amount: 350 } })
    expect(res.status).toBe(201)
    expect(res.body.status).toBe('PENDING')
  })

  it('409 — a second pending request on the same giving', async () => {
    const res = await api.post(`/api/givings/${ownGivingId}/request-update`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ reason: 'Again', proposedData: { amount: 400 } })
    expect(res.status).toBe(409)
  })

  it('404 — member cannot request a correction on a giving that is not theirs', async () => {
    const other = await recordGiving({ amount: 500 }) // memberId null
    const res = await api.post(`/api/givings/${other.body.id}/request-update`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ reason: 'Not mine', proposedData: { amount: 1 } })
    expect(res.status).toBe(404)
  })

  it('403 — member cannot view the correction queue', async () => {
    const res = await api.get('/api/givings/requests')
      .set('Authorization', `Bearer ${memberToken}`)
    expect(res.status).toBe(403)
  })

  it('admin sees the queue with PENDING first', async () => {
    const res = await api.get('/api/givings/requests')
      .set('Authorization', `Bearer ${staffToken}`)
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body.requests)).toBe(true)
    expect(res.body.requests[0].status).toBe('PENDING')
  })

  it('approve applies proposedData to the giving and marks APPROVED', async () => {
    const list = await api.get('/api/givings/requests').set('Authorization', `Bearer ${staffToken}`)
    const pending = list.body.requests.find(r => r.givingId === ownGivingId && r.status === 'PENDING')
    expect(pending).toBeDefined()

    const res = await api.post(`/api/givings/requests/${pending.id}/approve`)
      .set('Authorization', `Bearer ${staffToken}`)
    expect(res.status).toBe(200)

    const giving = await api.get(`/api/givings/${ownGivingId}`).set('Authorization', `Bearer ${staffToken}`)
    expect(parseFloat(giving.body.amount)).toBe(350)
  })

  it('reject marks a request REJECTED without changing the giving', async () => {
    const created = await recordGiving({ memberId: member.profile.id, amount: 600 })
    const reqRes = await api.post(`/api/givings/${created.body.id}/request-update`)
      .set('Authorization', `Bearer ${memberToken}`)
      .send({ reason: 'typo', proposedData: { amount: 9 } })

    const res = await api.post(`/api/givings/requests/${reqRes.body.id}/reject`)
      .set('Authorization', `Bearer ${staffToken}`)
      .send({ reason: 'No proof provided' })
    expect(res.status).toBe(200)

    const giving = await api.get(`/api/givings/${created.body.id}`).set('Authorization', `Bearer ${staffToken}`)
    expect(parseFloat(giving.body.amount)).toBe(600)
  })
})
